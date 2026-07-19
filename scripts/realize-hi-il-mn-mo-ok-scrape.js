// One-off: scrape ONLY Hawaii, Illinois, Minnesota, Missouri, and Oklahoma
// (via CAMPUS_ALLOWLIST=HI,IL,MN,MO,OK) through the real orchestrator, then
// surgically replace those five states' jobs in the live jobs.json while
// leaving every other state byte-for-byte. This realizes:
//   - HI: University of Hawaii System was "generic" (no pagination) against
//     its SchoolJobs board; switched to "schooljobs" (194 open postings vs. 1 read)
//   - IL: Southern Illinois University Edwardsville's Interfolio "positions"
//     page renders via AJAX well after domcontentloaded (fixed sleep undershot
//     it) and its links are relative ng-hrefs a CSS attribute selector can't
//     see through — both fixed in scrapeInterfolioPositionsAs
//   - MN: Minnesota State System's Workday tenant slug was stale (wd1 -> wd115);
//     University of Minnesota's PeopleSoft scraper never matched any real job
//     link (there are none — titles are bare spans) and has been rewritten;
//     also fixed a shared scrapeWorkdayApi bug where a tenant's `total` field
//     resets to 0 after page 1, prematurely truncating pagination
//   - MO: added the University of Missouri System (Columbia, Kansas City, St.
//     Louis), previously entirely untracked despite existing in the location
//     lookup table
//   - OK: added the University of Oklahoma (Norman + Health Sciences Center),
//     previously entirely untracked
// without a full scrape that could strip enrichment from the other 51 sources.
//
// Run with:  CAMPUS_ALLOWLIST=HI,IL,MN,MO,OK node scripts/realize-hi-il-mn-mo-ok-scrape.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { scrapeAllJobsStandalone } from "../server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..");

const STATES = ["HI", "IL", "MN", "MO", "OK"];

const TARGETS = [
  path.join(root, "docs", "jobs.json"),
  path.join(root, "public", "jobs.json"),
  path.join(root, "web-vue", "public", "jobs.json"),
];
const BASE_PATH = path.join(root, "docs", "jobs.json");

function clean(v) { return String(v || "").replace(/\s+/g, " ").trim(); }
function nk(v) { return clean(v).toLowerCase(); }
function sha1(v) { return createHash("sha1").update(String(v || "")).digest("hex"); }
function withCanonicalIds(jobs) {
  return jobs.map((job) => {
    const title = nk(job?.titleClean || job?.title || "");
    const college = nk(job?.college || "");
    const dept = nk(job?.department || "");
    const state = nk(job?.state || job?.source || "");
    const source = nk(job?.source || "");
    const url = nk(job?.url || "");
    const canonicalGroupId = `grp_${sha1([title, college, dept, state].join("|")).slice(0, 16)}`;
    const canonicalJobId = `job_${sha1([canonicalGroupId, source, url].join("|")).slice(0, 16)}`;
    return { ...job, canonicalGroupId, canonicalJobId };
  });
}

(async () => {
  const allowlist = (process.env.CAMPUS_ALLOWLIST || "").toUpperCase();
  if (!STATES.every((s) => allowlist.includes(s))) {
    console.error(`Refusing to run without CAMPUS_ALLOWLIST=${STATES.join(",")} (would scrape everything).`);
    process.exit(1);
  }

  const base = JSON.parse(fs.readFileSync(BASE_PATH, "utf8"));
  const prevCounts = {};
  for (const s of STATES) prevCounts[s] = base.jobs.filter((j) => String(j.source).trim() === s).length;
  console.log(`Base: ${base.jobs.length} jobs. Currently tagged: ${STATES.map((s) => `${s}=${prevCounts[s]}`).join(", ")}`);

  console.log(`Scraping ${STATES.join(", ")} only (this loads Playwright; ~a few minutes)...`);
  const result = await scrapeAllJobsStandalone();
  const freshByState = {};
  for (const s of STATES) freshByState[s] = (result.jobs || []).filter((j) => String(j.source).trim() === s);
  const freshAll = STATES.flatMap((s) => freshByState[s]);
  console.log(`Fresh scrape returned ${result.count} jobs (${freshAll.length} across the ${STATES.length} target states).`);

  for (const s of STATES) {
    if (freshByState[s].length === 0) {
      console.error(`Fresh ${s} scrape produced 0 jobs — refusing to overwrite (likely a blocked run).`);
      process.exit(2);
    }
  }

  for (const s of STATES) {
    const byCollege = {};
    for (const j of freshByState[s]) { const c = j.college || "?"; byCollege[c] = (byCollege[c] || 0) + 1; }
    console.log(`${s} by campus:`);
    for (const [c, n] of Object.entries(byCollege).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}  ${c}`);
  }

  const kept = base.jobs.filter((j) => !STATES.includes(String(j.source).trim()));
  const merged = withCanonicalIds([...kept, ...freshAll]);
  const out = { ...base, scrapedAt: result.scrapedAt, count: merged.length, jobs: merged };

  for (const t of TARGETS) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, JSON.stringify(out, null, 2));
    console.log(`Wrote ${path.relative(root, t)} (${out.count} jobs)`);
  }
  console.log(
    `Done: ${STATES.map((s) => `${s} ${prevCounts[s]} -> ${freshByState[s].length}`).join("; ")}; total ${base.jobs.length} -> ${merged.length}`
  );
})();
