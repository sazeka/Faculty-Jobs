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
 * A `descriptionFetchedAt` marker and attempt count are saved. Empty results get
 * one delayed retry after 14 days, then stop so broken pages are not retried
 * forever.
 * Saves after each batch so partial runs are never lost.
 *
 * Usage:
 *   node scripts/agent-job-descriptions.js [--dry-run] [--platform <name>] [--max <n>] [--concurrency <n>] [--timeout-ms <n>] [--min-len <n>]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { extractStartDate } from "./lib/start-date.js";
import {
  DESCRIPTION_FETCH_VERSION,
  descriptionAttemptCount,
  isUnsupportedDescriptionUrl,
  matchesDescriptionPlatform,
  needsDescriptionFetch,
  prioritizeDescriptionCandidates,
} from "./lib/description-backfill.js";
import { createDescriptionFetchReport } from "./lib/description-fetch-report.js";
import { buildWorkdayCxsUrl, fetchWorkdayPosting } from "./lib/workday-description.js";
import { fetchPaycomPosting, parsePaycomJobUrl } from "./lib/paycom-description.js";
import { fetchAdpPosting, parseAdpJobUrl } from "./lib/adp-description.js";

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
const PLATFORM = String(args.platform || process.env.DESC_PLATFORM || "").trim().toLowerCase();
if (PLATFORM && !/^[a-z0-9-]+$/.test(PLATFORM)) {
  throw new Error(`Invalid description platform: ${PLATFORM}`);
}
// --redate: re-visit pages already fetched (descriptionFetchedAt set) that still
// have no datePosted, to pick up labeled "Open Date" fields added since the last
// fetch. Targets only the already-fetched-but-undated set, not the whole corpus.
const REDATE = Boolean(args["redate"]);
// --reclose: re-visit already-fetched pages that have no deadline signal yet
// (no closeDate and not openUntilFilled) to pick up labeled "Close Date" /
// "Applications Close" fields.
const RECLOSE = Boolean(args["reclose"]);
const MAX = Number(args["max"] || process.env.DESC_MAX || 300);
const CONCURRENCY = Math.min(Number(args["concurrency"] || process.env.DESC_CONCURRENCY || 6), 12);
const TIMEOUT_MS = Math.max(8000, Number(args["timeout-ms"] || 30000));
const PAGE_CREATE_TIMEOUT_MS = 10000;
const PAGE_CLOSE_TIMEOUT_MS = 5000;
const MIN_LEN = Math.max(80, Number(args["min-len"] || 200));
const MAX_LEN = 6000;

// page.goto/waitForLoadState below all carry their own timeout, but
// page.evaluate() doesn't — Playwright never bounds it, so a page whose
// renderer wedges (an unhandled alert(), a broken CDP round-trip, a crashed
// frame) hangs this call forever. Since every worker shares one
// Promise.all(workers), ONE stuck evaluate() blocks the entire batch
// indefinitely — this is exactly what stalled the Jetson's nightly run for 5
// days (2026-07-27 onward) with zero further log output. Racing it against a
// timer turns that into an ordinary caught error the existing try/catch
// already handles as "no description found for this job," and the worker
// moves on to the next one.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // A workflow timeout can terminate the process between any two instructions.
  // Write checkpoints atomically so the following recovery step sees either the
  // previous complete JSON file or the new one, never a truncated document.
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
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

  const needs = RECLOSE
    ? payload.jobs.filter(
        (j) => !j.closeDate && !j.openUntilFilled && j.descriptionFetchedAt !== undefined && /^https?:\/\//i.test(j.url || "") && matchesDescriptionPlatform(j, PLATFORM)
      )
    : REDATE
    ? payload.jobs.filter(
        (j) => !j.datePosted && j.descriptionFetchedAt !== undefined && /^https?:\/\//i.test(j.url || "") && matchesDescriptionPlatform(j, PLATFORM)
      )
    : prioritizeDescriptionCandidates(payload.jobs, Date.now(), { platform: PLATFORM });
  const toProcess = needs.slice(0, MAX);

  const haveDesc = payload.jobs.filter((j) => j.description && String(j.description).trim()).length;
  if (REDATE) console.log("\n  *** REDATE MODE — re-scanning fetched pages missing datePosted ***");
  if (RECLOSE) console.log("\n  *** RECLOSE MODE — re-scanning fetched pages missing a deadline ***");
  console.log(`\n  Total jobs        : ${payload.jobs.length.toLocaleString()}`);
  console.log(`  With description  : ${haveDesc.toLocaleString()}`);
  console.log(`  Missing (unfetched): ${needs.length.toLocaleString()}`);
  console.log(`  To process now    : ${toProcess.length.toLocaleString()} (max ${MAX})`);
  if (PLATFORM) console.log(`  Platform filter   : ${PLATFORM}`);
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

  // Direct Workday and Paycom API routes do not need Chromium. Start it lazily
  // only when a selected posting needs DOM rendering; this keeps focused API
  // backfills fast and avoids downloading a browser in their workflows.
  let browser;
  let context;
  let contextPromise;
  async function ensureBrowserContext() {
    if (!contextPromise) {
      contextPromise = (async () => {
        browser = await chromium.launch({ headless: true });
        // Keep Chromium's normal identity. A custom bot user agent prevents
        // several Workday-style SPAs from rendering.
        context = await browser.newContext();
        return context;
      })();
    }
    return contextPromise;
  }
  const jobIndex = new Map(payload.jobs.map((j) => [j.canonicalJobId, j]));

  let filled = 0;
  let datedFilled = 0;
  let openDateFilled = 0;
  let deadlineFilled = 0;
  let rollingFilled = 0;
  let startFilled = 0;
  let attempted = 0;
  let nextIdx = 0;
  let sinceSave = 0;
  const fetchReport = createDescriptionFetchReport();

  async function worker() {
    while (nextIdx < toProcess.length) {
      const job = toProcess[nextIdx++];
      const target = jobIndex.get(job.canonicalJobId) || job;
      let page;
      let desc = "";
      let datePosted = "";
      let validThrough = "";
      let closeRolling = false;
      let datePostedFromOpenDate = false;
      let fetchErrored = false;
      try {
        if (buildWorkdayCxsUrl(job.url)) {
          // Workday detail pages are SPAs and frequently remain on "Loading" in
          // hosted Chromium. Their public CXS endpoint returns the same posting
          // body and exact posting-window dates without browser rendering.
          const result = await fetchWorkdayPosting(job.url, {
            timeoutMs: TIMEOUT_MS,
            minLen: MIN_LEN,
            maxLen: MAX_LEN,
          });
          desc = result.desc;
          datePosted = result.datePosted;
          validThrough = result.validThrough;
        } else if (parsePaycomJobUrl(job.url)) {
          // Paycom's SPA obtains the complete posting from a public JSON API.
          // Fetch it directly using the short-lived session token embedded in
          // the public landing page, avoiding unreliable browser rendering.
          const result = await fetchPaycomPosting(job.url, {
            timeoutMs: TIMEOUT_MS,
            // This is the structured description field from Paycom's API, not
            // a guessed DOM region, so short legitimate adjunct-pool postings
            // are safe to keep without the generic page-chrome threshold.
            minLen: Math.min(MIN_LEN, 80),
            maxLen: MAX_LEN,
          });
          desc = result.desc;
          datePosted = result.datePosted;
          validThrough = result.validThrough;
        } else if (parseAdpJobUrl(job.url)) {
          // ADP Workforce Now exposes each public requisition as structured
          // JSON, including the complete description and exact post date.
          const result = await fetchAdpPosting(job.url, {
            timeoutMs: TIMEOUT_MS,
            minLen: Math.min(MIN_LEN, 80),
            maxLen: MAX_LEN,
          });
          desc = result.desc;
          datePosted = result.datePosted;
          validThrough = result.validThrough;
        } else {
          // newPage() and close() have no Playwright timeout of their own. The
          // 2026-08-20 Actions run completed 1,575/1,600 pages in 11 minutes, then
          // all workers waited here or in close() until GitHub killed the job at
          // six hours. Bound both lifecycle calls so one wedged CDP round-trip
          // becomes an ordinary failed attempt and the worker keeps moving.
          await ensureBrowserContext();
          page = await withTimeout(context.newPage(), PAGE_CREATE_TIMEOUT_MS, "context.newPage");
          await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
        // Cornerstone (csod) is a single-page app that renders the "Posted on …"
        // date client-side well after DOMContentLoaded; the default 1.5s wait
        // fires before it paints, so the date (and full body) is missed. Give
        // those pages longer and let the network settle.
        if (/\.csod\.com/i.test(job.url)) {
          await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
          await page.waitForTimeout(3500);
        } else {
          await page.waitForTimeout(1500);
        }
        const result = await withTimeout(
          page.evaluate(
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
              // Posting-date label variants observed across ATS platforms:
              //   PeopleAdmin/Taleo → "Open Date"; Buffalo → "Posted"; PageUp
              //   (UF/CSU) → "Advertised"; UMich → "Posting Begin/End Date".
              // Deliberately EXCLUDED: "date published" (UW renders a stale template
              // value), "start date"/"available" (a start date, not posting),
              // "apply by"/"close"/"deadline" (that's the deadline → closeDate).
              const LABEL =
                "(?:open(?:ing)?\\s*date|posting\\s*date|posting\\s*begin(?:[\\s/]*end)?\\s*date|date\\s*posted|posted\\s*date|posted\\s*on|date\\s*opened|initial\\s*posting\\s*date|first\\s*posted|advertised|posted)";
              const re = new RegExp("\\b" + LABEL + "\\s*[:\\-]?\\s*" + DATE, "i");
              const labelAnchored = new RegExp("^" + LABEL + "\\s*:?\\s*$", "i");
              // Prefer a labeled field rendered as a label/value pair (dt/dd, th/td,
              // or [class*=label]/sibling) to avoid grabbing a date from prose.
              const labelNodes = Array.from(
                document.querySelectorAll("dt, th, label, [class*='label' i], strong, b, span")
              );
              for (const el of labelNodes) {
                const lt = (el.textContent || "").replace(/\s+/g, " ").trim();
                if (!labelAnchored.test(lt)) continue;
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
            // Application DEADLINE from a labeled field, when JSON-LD validThrough
            // is absent: PeopleAdmin "Close Date", PageUp "Applications Close",
            // also "Application Deadline" / "Deadline to Apply" / "Apply By". The
            // value is either a date OR an "open until filled" phrase (→ rolling).
            // Anchored on close/deadline/apply-by labels so "priority review date"
            // and "review will begin" (a review START, not a deadline) are skipped.
            const findLabeledCloseDate = () => {
              const M = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
              const D = "(" + M + "\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+" + M + ",?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})";
              const LBL = "(?:clos(?:e|ing)\\s*date|applications?\\s*clos(?:e|ing)|application\\s*deadline|deadline(?:\\s*(?:to\\s*apply|for\\s*application?s?))?|apply\\s*by|posting\\s*end\\s*date)";
              const body = (document.body && document.body.innerText ? document.body.innerText : "").replace(/\s+/g, " ");
              // A close/deadline label followed by "open until filled" → rolling.
              if (new RegExp(LBL + "\\s*[:\\-]?\\s*(?:open\\s+)?(?:until\\s+filled|continuous(?:ly)?|ongoing)", "i").test(body)) {
                return { rolling: true };
              }
              const m = new RegExp("\\b" + LBL + "\\s*[:\\-]?\\s*" + D, "i").exec(body);
              return m ? { date: m[1] } : {};
            };
            return { desc: findDesc(), ...findJobDates(), openDate: findLabeledOpenDate(), close: findLabeledCloseDate() };
          },
          [MIN_LEN, MAX_LEN]
          ),
          20000,
          "page.evaluate"
        );
          desc = result?.desc || "";
          // JSON-LD datePosted wins; fall back to a labeled "Open Date" field.
          datePosted = result?.datePosted || result?.openDate || "";
          datePostedFromOpenDate = !result?.datePosted && !!result?.openDate;
          // Deadline: JSON-LD validThrough wins, else a labeled close/deadline date.
          validThrough = result?.validThrough || result?.close?.date || "";
          closeRolling = !result?.validThrough && !result?.close?.date && !!result?.close?.rolling;
        }
      } catch {
        fetchErrored = true;
        desc = "";
      } finally {
        if (page) {
          await withTimeout(page.close(), PAGE_CLOSE_TIMEOUT_MS, "page.close").catch(() => {});
        }
      }

      // Strip a leading "Skip to Main Content" link that some ATS pages render
      // inside the content region (not in a <nav>, so the DOM strip misses it).
      if (desc) desc = desc.replace(/^\s*skip to (main )?content\s*/i, "").trim();

      fetchReport.record(job.url, desc ? "filled" : fetchErrored ? "errors" : "empty");

      attempted++;
      const wasMissingDescription = !String(target.description || "").trim();
      const priorDescriptionAttempts = descriptionAttemptCount(target);
      target.descriptionFetchedAt = new Date().toISOString();
      // Only fill an empty description — a redate re-scan must not clobber a
      // description captured on the original fetch.
      if (desc && !String(target.description || "").trim()) {
        target.description = desc;
        filled++;
      }
      if (wasMissingDescription) {
        target.descriptionFetchAttempts = priorDescriptionAttempts + 1;
        target.descriptionFetchStatus = desc ? "filled" : "empty";
        target.descriptionFetchVersion = DESCRIPTION_FETCH_VERSION;
      }
      // Soft "anticipated start date" parsed from the posting body (free text).
      if (!target.startDate) {
        const sd = extractStartDate(desc || target.description || "");
        if (sd) { target.startDate = sd; startFilled++; }
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
      // A labeled "Close Date: Open Until Filled" → rolling (card shows "Rolling").
      if (closeRolling && !target.closeDate && target.openUntilFilled === undefined) {
        target.openUntilFilled = true;
        rollingFilled++;
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
  if (context) await withTimeout(context.close(), 10000, "context.close").catch(() => {});
  if (browser) await withTimeout(browser.close(), 10000, "browser.close").catch(() => {});

  writeJson(PUBLIC_JOBS, payload);
  if (fs.existsSync(DOCS_JOBS)) writeJson(DOCS_JOBS, payload);

  const totalWithDescription = payload.jobs.filter((j) => j.description && String(j.description).trim()).length;
  const remaining = payload.jobs.filter(
    (j) => !String(j.description || "").trim() && /^https?:\/\//i.test(j.url || "")
  ).length;
  const eligibleRemaining = payload.jobs.filter((j) => needsDescriptionFetch(j)).length;
  const unsupportedRemaining = payload.jobs.filter(
    (j) => !String(j.description || "").trim() && isUnsupportedDescriptionUrl(j.url)
  ).length;
  const fetchDiagnostics = fetchReport.summarize();

  writeJson(REPORT_PATH, {
    generatedAt: new Date().toISOString(),
    totalJobs: payload.jobs.length,
    attemptedThisRun: attempted,
    filledThisRun: filled,
    datePostedFilledThisRun: datedFilled,
    openDateFilledThisRun: openDateFilled,
    startDateFilledThisRun: startFilled,
    totalWithStartDate: payload.jobs.filter((j) => j.startDate).length,
    deadlineFilledThisRun: deadlineFilled,
    rollingFilledThisRun: rollingFilled,
    mode: RECLOSE ? "reclose" : REDATE ? "redate" : "normal",
    totalWithDatePosted: payload.jobs.filter((j) => j.datePosted).length,
    totalWithDeadline: payload.jobs.filter((j) => j.closeDate).length,
    totalWithDescription,
    remaining,
    eligibleRemaining,
    unsupportedRemaining,
    fetchDiagnostics,
    config: { max: MAX, concurrency: CONCURRENCY, timeoutMs: TIMEOUT_MS, minLen: MIN_LEN, platform: PLATFORM || null },
  });

  console.log(`\n  Attempted this run : ${attempted}`);
  console.log(`  Filled this run    : ${filled} (${attempted ? ((filled / attempted) * 100).toFixed(0) : 0}%)`);
  console.log(`  datePosted found   : ${datedFilled} (${attempted ? ((datedFilled / attempted) * 100).toFixed(0) : 0}%)  [${openDateFilled} via labeled Open Date]`);
  console.log(`  deadlines found    : ${deadlineFilled} (${attempted ? ((deadlineFilled / attempted) * 100).toFixed(0) : 0}%)  [+${rollingFilled} rolling/until-filled]`);
  console.log(`  start dates found  : ${startFilled} (${attempted ? ((startFilled / attempted) * 100).toFixed(0) : 0}%)`);
  console.log(`  Total w/ description: ${totalWithDescription.toLocaleString()} / ${payload.jobs.length.toLocaleString()}`);
  console.log(`  Remaining missing  : ${remaining.toLocaleString()}`);
  console.log(`  Eligible next run  : ${eligibleRemaining.toLocaleString()}`);
  console.log(`  Unsupported links  : ${unsupportedRemaining.toLocaleString()}`);
  console.log("  Highest-failure platforms:");
  for (const row of fetchDiagnostics.byPlatform.slice(0, 5)) {
    console.log(`    ${row.platform}: ${row.empty + row.errors}/${row.attempted} failed (${row.failureRatePct}%)`);
  }
  console.log("  Highest-failure hosts:");
  for (const row of fetchDiagnostics.byHost.slice(0, 10)) {
    console.log(`    ${row.host}: ${row.empty + row.errors}/${row.attempted} failed (${row.failureRatePct}%)`);
  }
  console.log(`  Report saved       : generated/job-descriptions-report.json\n`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
