#!/usr/bin/env node
/**
 * verify-job-urls.js
 *
 * Checks that individual job posting URLs are still live.
 * Samples up to --sample-per-source URLs per source per run.
 * Results are cached in generated/job-url-cache.json so each URL
 * is only rechecked every --recheck-days (default 7) days.
 *
 * Usage:
 *   node scripts/verify-job-urls.js [options]
 *
 * Options:
 *   --sample-per-source <n>   Max URLs to check per source per run (default 8)
 *   --concurrency <n>         Parallel requests (default 6)
 *   --recheck-days <n>        Days before rechecking a cached result (default 7)
 *   --timeout-ms <n>          Per-request timeout in ms (default 12000)
 *   --dry-run                 Print what would be checked without fetching
 */
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const JOBS_PATH        = path.join(ROOT, "public", "jobs.json");
const CACHE_PATH       = path.join(ROOT, "generated", "job-url-cache.json");
const REPORT_PATH      = path.join(ROOT, "generated", "job-url-report.json");
const DEAD_LIST_PATH   = path.join(ROOT, "generated", "job-url-dead.json");

// ── CLI args ──────────────────────────────────────────────────────────────────

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

const args           = parseArgs(process.argv.slice(2));
const SAMPLE         = Math.max(1, Number(args["sample-per-source"] || 8));
const CONCURRENCY    = Math.max(1, Math.min(20, Number(args["concurrency"] || 6)));
const RECHECK_DAYS   = Math.max(1, Number(args["recheck-days"] || 7));
const TIMEOUT_MS     = Math.max(3000, Number(args["timeout-ms"] || 12000));
const DRY_RUN        = Boolean(args["dry-run"]);
const RECHECK_MS     = RECHECK_DAYS * 24 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJsonOrNull(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function clean(v) { return String(v || "").replace(/\s+/g, " ").trim(); }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isHomepageRedirect(originalUrl, finalUrl) {
  try {
    const orig = new URL(originalUrl);
    const final = new URL(finalUrl);
    // Different host = probable redirect off-platform
    if (orig.hostname !== final.hostname) return true;
    // Original had a deep path; final is root or near-root
    const origSegments = orig.pathname.replace(/\/$/, "").split("/").filter(Boolean);
    const finalSegments = final.pathname.replace(/\/$/, "").split("/").filter(Boolean);
    if (origSegments.length >= 3 && finalSegments.length <= 1) return true;
    return false;
  } catch {
    return false;
  }
}

// ── HTTP fetch (no external deps) ─────────────────────────────────────────────

function headRequest(url, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 5) return resolve({ status: "redirect-loop", finalUrl: url });

    let parsed;
    try { parsed = new URL(url); } catch { return resolve({ status: "invalid-url", finalUrl: url }); }

    const lib = parsed.protocol === "https:" ? https : http;
    const options = {
      method: "HEAD",
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FacultyAtlas-Checker/1.0)",
        "Accept": "text/html,application/xhtml+xml,*/*",
      },
      timeout: TIMEOUT_MS,
    };

    const timer = setTimeout(() => {
      req.destroy();
      resolve({ status: "timeout", finalUrl: url });
    }, TIMEOUT_MS + 500);

    const req = lib.request(options, (res) => {
      clearTimeout(timer);
      const code = res.statusCode;

      // Follow redirects
      if ((code === 301 || code === 302 || code === 303 || code === 307 || code === 308) && res.headers.location) {
        let next = res.headers.location;
        if (next.startsWith("/")) next = `${parsed.protocol}//${parsed.host}${next}`;
        res.resume();
        return headRequest(next, redirectCount + 1).then((r) => {
          clearTimeout(timer);
          // Check if it looks like a homepage redirect
          if (r.status === "ok" && isHomepageRedirect(url, r.finalUrl)) {
            resolve({ status: "homepage-redirect", finalUrl: r.finalUrl, httpCode: r.httpCode });
          } else {
            resolve(r);
          }
        });
      }

      // Some servers refuse HEAD — treat as live rather than retrying with GET
      // (avoids hammering servers with double requests)
      res.resume();
      if (code === 200 || code === 201 || code === 203) {
        resolve({ status: "ok", finalUrl: url, httpCode: code });
      } else if (code === 404 || code === 410) {
        resolve({ status: "dead", finalUrl: url, httpCode: code });
      } else if (code === 405 || code === 403 || code === 406) {
        // HEAD not allowed or blocked — assume live, don't penalise
        resolve({ status: "blocked", finalUrl: url, httpCode: code });
      } else if (code === 429 || code === 503 || code === 502) {
        resolve({ status: "rate-limited", finalUrl: url, httpCode: code });
      } else {
        resolve({ status: "unknown", finalUrl: url, httpCode: code });
      }
    });

    req.on("error", (err) => {
      clearTimeout(timer);
      resolve({ status: "error", finalUrl: url, error: err.message });
    });

    req.on("timeout", () => {
      clearTimeout(timer);
      req.destroy();
      resolve({ status: "timeout", finalUrl: url });
    });

    req.end();
  });
}

// ── Concurrency pool ──────────────────────────────────────────────────────────

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nFaculty Atlas - Job URL Validator");
  console.log(`  Sample: ${SAMPLE}/source | Concurrency: ${CONCURRENCY} | Recheck: every ${RECHECK_DAYS}d | Timeout: ${TIMEOUT_MS}ms`);
  if (DRY_RUN) console.log("  *** DRY RUN ***\n");

  // Load jobs
  const payload = readJsonOrNull(JOBS_PATH);
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  if (jobs.length === 0) { console.error("No jobs found in public/jobs.json"); process.exit(1); }
  console.log(`\nLoaded ${jobs.length.toLocaleString()} jobs.`);

  // Load cache
  const cache = readJsonOrNull(CACHE_PATH) || {};
  const now = Date.now();

  // Build per-source URL lists, skip already-fresh cache hits
  const bySource = new Map();
  for (const job of jobs) {
    const url = clean(job?.url);
    if (!url || url === "#") continue;
    const source = clean(job?.source) || "Unknown";
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push({ url, title: clean(job?.title), college: clean(job?.college) });
  }

  const toCheck = [];
  for (const [source, entries] of bySource) {
    const stale = shuffle(entries).filter(({ url }) => {
      const cached = cache[url];
      if (!cached) return true;
      return (now - new Date(cached.checkedAt).getTime()) > RECHECK_MS;
    });
    toCheck.push(...stale.slice(0, SAMPLE).map((e) => ({ ...e, source })));
  }

  const skipped = jobs.length - toCheck.length;
  console.log(`  ${toCheck.length} URLs selected to check this run (${skipped} not sampled or already fresh in cache)\n`);

  if (DRY_RUN) {
    for (const item of toCheck.slice(0, 20)) console.log(`  Would check: ${item.url}`);
    if (toCheck.length > 20) console.log(`  ... and ${toCheck.length - 20} more`);
    process.exit(0);
  }

  if (toCheck.length === 0) {
    console.log("All sampled URLs are fresh in cache. Nothing to check.");
  } else {
    // Check URLs
    let done = 0;
    const results = await mapWithConcurrency(toCheck, CONCURRENCY, async (item) => {
      const result = await headRequest(item.url);
      cache[item.url] = {
        checkedAt: new Date().toISOString(),
        status: result.status,
        httpCode: result.httpCode || null,
        finalUrl: result.finalUrl !== item.url ? result.finalUrl : undefined,
      };
      done++;
      if (done % 10 === 0 || done === toCheck.length) {
        process.stdout.write(`\r  Checked ${done}/${toCheck.length}...`);
      }
      return { ...item, ...result };
    });
    console.log(""); // newline after progress

    // Save updated cache
    writeJson(CACHE_PATH, cache);

    // Tally fresh results
    const counts = { ok: 0, dead: 0, blocked: 0, "homepage-redirect": 0, timeout: 0, "rate-limited": 0, unknown: 0, error: 0 };
    for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

    console.log("\n-- Results (this run) --");
    console.log(`  OK        : ${counts.ok}`);
    console.log(`  Dead      : ${counts.dead}  (404/410)`);
    console.log(`  Redirected: ${counts["homepage-redirect"]}  (redirected to homepage)`);
    console.log(`  Blocked   : ${counts.blocked}  (403/405 - assumed live)`);
    console.log(`  Timeout   : ${counts.timeout}`);
    console.log(`  Other     : ${counts.unknown + counts.error + counts["rate-limited"]}`);
  }

  // Build full picture from cache (all sources)
  const deadJobs = [];
  const bySourceStats = new Map();

  for (const job of jobs) {
    const url = clean(job?.url);
    if (!url || url === "#") continue;
    const source = clean(job?.source) || "Unknown";
    const cached = cache[url];
    if (!cached) continue; // never checked

    if (!bySourceStats.has(source)) bySourceStats.set(source, { checked: 0, dead: 0, redirected: 0 });
    const st = bySourceStats.get(source);
    st.checked++;
    if (cached.status === "dead" || cached.status === "homepage-redirect") {
      st.dead++;
      if (cached.status === "dead") st.redirected === undefined;
      else st.redirected++;
      deadJobs.push({
        url,
        status: cached.status,
        httpCode: cached.httpCode || null,
        checkedAt: cached.checkedAt,
        title: clean(job?.title),
        college: clean(job?.college),
        source,
      });
    }
  }

  // Sort dead jobs newest-first
  deadJobs.sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt));

  // Compute per-source dead rate
  const sourceWarnings = [];
  for (const [source, st] of bySourceStats) {
    if (st.checked < 3) continue;
    const deadPct = (st.dead / st.checked) * 100;
    if (deadPct >= 30) {
      sourceWarnings.push({ source, checked: st.checked, dead: st.dead, deadPct: Number(deadPct.toFixed(1)) });
    }
  }
  sourceWarnings.sort((a, b) => b.deadPct - a.deadPct);

  // Write outputs
  const totalCached = Object.keys(cache).length;
  const totalDead = deadJobs.length;
  const report = {
    generatedAt: new Date().toISOString(),
    config: { samplePerSource: SAMPLE, recheckDays: RECHECK_DAYS },
    coverage: { jobsTotal: jobs.length, urlsCached: totalCached, coveragePct: Number(((totalCached / jobs.length) * 100).toFixed(1)) },
    deadCount: totalDead,
    sourceWarnings,
  };

  writeJson(REPORT_PATH, report);
  writeJson(DEAD_LIST_PATH, { generatedAt: new Date().toISOString(), count: deadJobs.length, jobs: deadJobs });

  // Console summary
  console.log("\n-- Overall (from cache) --");
  console.log(`  URLs in cache  : ${totalCached.toLocaleString()} / ${jobs.length.toLocaleString()} (${report.coverage.coveragePct}% coverage)`);
  console.log(`  Confirmed dead : ${totalDead}`);

  if (sourceWarnings.length > 0) {
    console.log("\n-- Sources with >=30% dead URLs --");
    for (const w of sourceWarnings) {
      console.log(`  ${w.source}: ${w.dead}/${w.checked} dead (${w.deadPct}%)`);
    }
  }

  if (deadJobs.length > 0) {
    console.log(`\n-- Dead listings (most recent ${Math.min(10, deadJobs.length)}) --`);
    for (const d of deadJobs.slice(0, 10)) {
      console.log(`  [${d.status}] ${d.college} - ${d.title.slice(0, 60)}`);
      console.log(`    ${d.url}`);
    }
    if (deadJobs.length > 10) console.log(`  ... and ${deadJobs.length - 10} more in ${path.relative(ROOT, DEAD_LIST_PATH)}`);
  }

  console.log(`\n  Report  : ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`  Dead    : ${path.relative(ROOT, DEAD_LIST_PATH)}`);
  console.log(`  Cache   : ${path.relative(ROOT, CACHE_PATH)}\n`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
