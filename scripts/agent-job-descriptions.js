#!/usr/bin/env node
/**
 * agent-job-descriptions.js
 *
 * Backfills the `description` field on job records by visiting each job URL and
 * extracting the posting body. ~89% of scraped jobs carry only title+url because
 * most scrapers read a listing page and never open the detail page; this fills
 * that gap and improves both the UI and downstream AI enrichment.
 *
 * Uses Playwright (many job detail pages — Workday, Taleo, etc. — are JS-rendered).
 * Idempotent: a `descriptionFetchedAt` marker is set on every attempt so a page
 * that yields nothing (404, paywall, JS we can't parse) is not retried forever.
 * Saves after each batch so partial runs are never lost.
 *
 * Usage:
 *   node scripts/agent-job-descriptions.js [--dry-run] [--max <n>] [--concurrency <n>] [--timeout-ms <n>] [--min-len <n>]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PUBLIC_JOBS = path.join(ROOT, "public", "jobs.json");
const DOCS_JOBS = path.join(ROOT, "docs", "jobs.json");
const REPORT_PATH = path.join(ROOT, "generated", "job-descriptions-report.json");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const DRY_RUN = Boolean(args["dry-run"]);
// --redate: re-visit pages already fetched (descriptionFetchedAt set) that still
// have no datePosted, to pick up labeled "Open Date" fields added since the last
// fetch. Targets only the already-fetched-but-undated set, not the whole corpus.
const REDATE = Boolean(args["redate"]);
const MAX = Number(args["max"] || process.env.DESC_MAX || 300);
const CONCURRENCY = Math.min(Number(args["concurrency"] || process.env.DESC_CONCURRENCY || 6), 12);
const TIMEOUT_MS = Math.max(8000, Number(args["timeout-ms"] || 30000));
const MIN_LEN = Math.max(80, Number(args["min-len"] || 200));
const MAX_LEN = 6000;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n", "utf8");
}

// Normalize a JSON-LD datePosted (ISO date or datetime) to YYYY-MM-DD; reject
// anything that doesn't parse to a plausible year.
function normalizeDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 2000 || y > 2100) return null;
  return d.toISOString().slice(0, 10);
}

async function main() {
  const payload = readJson(PUBLIC_JOBS);
  if (!payload?.jobs?.length) {
    console.error("  Cannot read public/jobs.json");
    process.exit(1);
  }

  const needs = REDATE
    ? payload.jobs.filter(
        (j) => !j.datePosted && j.descriptionFetchedAt !== undefined && /^https?:\/\//i.test(j.url || "")
      )
    : payload.jobs.filter(
        (j) => (!j.description || !String(j.description).trim()) && j.descriptionFetchedAt === undefined && /^https?:\/\//i.test(j.url || "")
      );
  const toProcess = needs.slice(0, MAX);

  const haveDesc = payload.jobs.filter((j) => j.description && String(j.description).trim()).length;
  if (REDATE) console.log("\n  *** REDATE MODE — re-scanning fetched pages missing datePosted ***");
  console.log(`\n  Total jobs        : ${payload.jobs.length.toLocaleString()}`);
  console.log(`  With description  : ${haveDesc.toLocaleString()}`);
  console.log(`  Missing (unfetched): ${needs.length.toLocaleString()}`);
  console.log(`  To process now    : ${toProcess.length.toLocaleString()} (max ${MAX})`);
  console.log(`  Concurrency       : ${CONCURRENCY}`);

  if (toProcess.length === 0) {
    console.log("\n  Nothing to do.");
    writeJson(REPORT_PATH, {
      generatedAt: new Date().toISOString(),
      totalJobs: payload.jobs.length,
      filledThisRun: 0,
      totalWithDescription: haveDesc,
      remaining: 0,
    });
    return;
  }

  if (DRY_RUN) {
    console.log("\n  Sample jobs that would be fetched:");
    for (const j of toProcess.slice(0, 5)) console.log(`    ${j.college} — ${(j.title || "").slice(0, 60)} → ${j.url}`);
    console.log(`\n  Would fetch ${toProcess.length} pages. No files written.`);
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: "Mozilla/5.0 FacultyJobsDescBot/1.0" });
  const jobIndex = new Map(payload.jobs.map((j) => [j.canonicalJobId, j]));

  let filled = 0;
  let datedFilled = 0;
  let openDateFilled = 0;
  let deadlineFilled = 0;
  let attempted = 0;
  let nextIdx = 0;
  let sinceSave = 0;

  async function worker() {
    while (nextIdx < toProcess.length) {
      const job = toProcess[nextIdx++];
      const target = jobIndex.get(job.canonicalJobId) || job;
      const page = await context.newPage();
      let desc = "";
      let datePosted = "";
      let validThrough = "";
      let datePostedFromOpenDate = false;
      try {
        await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
        await page.waitForTimeout(1500);
        const result = await page.evaluate(
          ([minLen, maxLen]) => {
            const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
            // schema.org JobPosting.datePosted (posting date) + validThrough
            // (application deadline) — embedded for Google for Jobs SEO. Walk
            // JSON-LD (incl. @graph arrays).
            const findJobDates = () => {
              const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
              for (const b of blocks) {
                let data;
                try { data = JSON.parse(b.textContent); } catch { continue; }
                const nodes = Array.isArray(data) ? data : (Array.isArray(data["@graph"]) ? data["@graph"] : [data]);
                for (const node of nodes) {
                  if (!node || typeof node !== "object") continue;
                  const t = node["@type"];
                  const isJob = t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
                  if (isJob && (node.datePosted || node.validThrough)) {
                    return { datePosted: String(node.datePosted || ""), validThrough: String(node.validThrough || "") };
                  }
                }
              }
              return { datePosted: "", validThrough: "" };
            };
            // Fallback when JSON-LD has no datePosted: many ATS detail pages
            // (PeopleAdmin, Interfolio, Oracle/Taleo, Workday) render the posting
            // date as a labeled field — most commonly "Open Date", also "Posting
            // Date" / "Date Posted" / "Posted On". Scan the page text for one of
            // those labels followed by a date and return the date string. Labels
            // are anchored so "Application Deadline"/"Close Date" aren't matched.
            const findLabeledOpenDate = () => {
              const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
              const DATE =
                "(" +
                MONTH + "\\s+\\d{1,2},?\\s+\\d{4}" +          // May 1, 2026
                "|\\d{1,2}\\s+" + MONTH + ",?\\s+\\d{4}" +    // 1 May 2026
                "|\\d{4}-\\d{2}-\\d{2}" +                      // 2026-05-01
                "|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}" +          // 05/01/2026
                ")";
              const LABEL =
                "(?:open(?:ing)?\\s*date|posting\\s*date|date\\s*posted|posted\\s*date|posted\\s*on|date\\s*opened|initial\\s*posting\\s*date|first\\s*posted)";
              const re = new RegExp(LABEL + "\\s*[:\\-]?\\s*" + DATE, "i");
              // Prefer a labeled field rendered as a label/value pair (dt/dd, th/td,
              // or [class*=label]/sibling) to avoid grabbing a date from prose.
              const labelNodes = Array.from(
                document.querySelectorAll("dt, th, label, [class*='label' i], strong, b, span")
              );
              for (const el of labelNodes) {
                const lt = (el.textContent || "").replace(/\s+/g, " ").trim();
                if (!/^(?:open(?:ing)?\s*date|posting\s*date|date\s*posted|posted\s*date|posted\s*on|date\s*opened|initial\s*posting\s*date|first\s*posted)\s*:?\s*$/i.test(lt)) continue;
                // Value is in the next sibling, the parent's next cell, or the parent text.
                const cand = [
                  el.nextElementSibling && el.nextElementSibling.textContent,
                  el.parentElement && el.parentElement.textContent,
                ];
                for (const c of cand) {
                  const m = new RegExp(DATE, "i").exec((c || "").replace(/\s+/g, " "));
                  if (m) return m[1];
                }
              }
              // Fallback: scan the whole body text for "label: date".
              const body = (document.body && document.body.innerText ? document.body.innerText : "").replace(/\s+/g, " ");
              const m = re.exec(body);
              return m ? m[1] : "";
            };
            // Read an element's text with page chrome (nav/header/footer/forms)
            // removed, so we keep the posting body and drop "Skip to Main Content…"
            // and application-form boilerplate.
            const textOf = (el) => {
              const c = el.cloneNode(true);
              c.querySelectorAll(
                "header, nav, footer, script, style, noscript, form, button, [role='navigation'], [class*='breadcrumb' i], [class*='skip' i], [class*='cookie' i], [class*='site-header' i], [class*='site-footer' i]"
              ).forEach((n) => n.remove());
              return clean(c.innerText);
            };
            const findDesc = () => {
              const selectors = [
                '[data-automation-id="jobPostingDescription"]',
                '[class*="job-description" i]',
                '[id*="job-description" i]',
                '[class*="jobdescription" i]',
                '[class*="posting-description" i]',
                '[class*="position-description" i]',
                ".job-details",
                "#job_details",
                "[class*='description' i]",
                "main",
                "article",
                "[role='main']",
              ];
              for (const sel of selectors) {
                let el;
                try { el = document.querySelector(sel); } catch { el = null; }
                if (el) {
                  const t = textOf(el);
                  if (t.length >= minLen) return t.slice(0, maxLen);
                }
              }
              let best = "";
              for (const el of Array.from(document.querySelectorAll("div, section, td"))) {
                const t = textOf(el);
                if (t.length > best.length && t.length < 25000) best = t;
              }
              return best.length >= minLen ? best.slice(0, maxLen) : "";
            };
            return { desc: findDesc(), ...findJobDates(), openDate: findLabeledOpenDate() };
          },
          [MIN_LEN, MAX_LEN]
        );
        desc = result?.desc || "";
        // JSON-LD datePosted wins; fall back to a labeled "Open Date" field.
        datePosted = result?.datePosted || result?.openDate || "";
        datePostedFromOpenDate = !result?.datePosted && !!result?.openDate;
        validThrough = result?.validThrough || "";
      } catch {
        desc = "";
      } finally {
        await page.close().catch(() => {});
      }

      // Strip a leading "Skip to Main Content" link that some ATS pages render
      // inside the content region (not in a <nav>, so the DOM strip misses it).
      if (desc) desc = desc.replace(/^\s*skip to (main )?content\s*/i, "").trim();

      attempted++;
      target.descriptionFetchedAt = new Date().toISOString();
      // Only fill an empty description — a redate re-scan must not clobber a
      // description captured on the original fetch.
      if (desc && !String(target.description || "").trim()) {
        target.description = desc;
        filled++;
      }
      if (datePosted && !target.datePosted) {
        const nd = normalizeDate(datePosted);
        if (nd) {
          target.datePosted = nd;
          datedFilled++;
          if (datePostedFromOpenDate) openDateFilled++;
        }
      }
      // validThrough = application deadline → closeDate (the field the card's
      // DEADLINE column already renders). Only fill if not already set.
      if (validThrough && target.closeDate === undefined) {
        const nd = normalizeDate(validThrough);
        if (nd) { target.closeDate = nd; deadlineFilled++; }
      }

      // Persist periodically so a long run's progress survives interruption.
      if (++sinceSave >= 25) {
        writeJson(PUBLIC_JOBS, payload);
        if (fs.existsSync(DOCS_JOBS)) writeJson(DOCS_JOBS, payload);
        sinceSave = 0;
      }
      if (attempted % 25 === 0) console.log(`  ...attempted ${attempted}/${toProcess.length} (filled ${filled})`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await browser.close();

  writeJson(PUBLIC_JOBS, payload);
  if (fs.existsSync(DOCS_JOBS)) writeJson(DOCS_JOBS, payload);

  const totalWithDescription = payload.jobs.filter((j) => j.description && String(j.description).trim()).length;
  const remaining = payload.jobs.filter(
    (j) => (!j.description || !String(j.description).trim()) && j.descriptionFetchedAt === undefined && /^https?:\/\//i.test(j.url || "")
  ).length;

  writeJson(REPORT_PATH, {
    generatedAt: new Date().toISOString(),
    totalJobs: payload.jobs.length,
    attemptedThisRun: attempted,
    filledThisRun: filled,
    datePostedFilledThisRun: datedFilled,
    openDateFilledThisRun: openDateFilled,
    deadlineFilledThisRun: deadlineFilled,
    mode: REDATE ? "redate" : "normal",
    totalWithDatePosted: payload.jobs.filter((j) => j.datePosted).length,
    totalWithDeadline: payload.jobs.filter((j) => j.closeDate).length,
    totalWithDescription,
    remaining,
    config: { max: MAX, concurrency: CONCURRENCY, timeoutMs: TIMEOUT_MS, minLen: MIN_LEN },
  });

  console.log(`\n  Attempted this run : ${attempted}`);
  console.log(`  Filled this run    : ${filled} (${attempted ? ((filled / attempted) * 100).toFixed(0) : 0}%)`);
  console.log(`  datePosted found   : ${datedFilled} (${attempted ? ((datedFilled / attempted) * 100).toFixed(0) : 0}%)  [${openDateFilled} via labeled Open Date]`);
  console.log(`  deadlines found    : ${deadlineFilled} (${attempted ? ((deadlineFilled / attempted) * 100).toFixed(0) : 0}%)`);
  console.log(`  Total w/ description: ${totalWithDescription.toLocaleString()} / ${payload.jobs.length.toLocaleString()}`);
  console.log(`  Remaining unfetched: ${remaining.toLocaleString()}`);
  console.log(`  Report saved       : generated/job-descriptions-report.json\n`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
