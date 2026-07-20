// One-off: scrape ONLY Texas (via CAMPUS_ALLOWLIST=TX) through the real
// orchestrator, then surgically replace the source==="TX" jobs in the live
// jobs.json while leaving every other state byte-for-byte. This realizes:
//   - Texas Christian University: stale Workday tenant -> its real
//     jobs.tcu.edu/jobs/search/faculty-jobs board (0 -> ~12)
//   - University of Texas at San Antonio: "peoplesoft" scraper only looks
//     for <a href> job links, but this PeopleSoft HRS template has none
//     (titles are bare <span> elements) — same root cause as the Minnesota
//     fix. Added a generic "peoplesoft-hrs" scraper (0 -> ~16)
//   - Southern Methodist University: was pointed at the Staff-only Taleo
//     section; switched to its real Faculty Careers page (0 -> ~6)
//   - Added Texas State University (PeopleAdmin, faculty-filtered) and
//     University of Texas at El Paso (InterviewExchange, with a new
//     per-category fan-out since postings only appear once a department is
//     selected) — both previously untracked
// without a full scrape that could strip enrichment from the other 55 sources.
//
// Run with:  CAMPUS_ALLOWLIST=TX node scripts/realize-tx-scrape.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { scrapeAllJobsStandalone } from "../server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..");

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
  if (!(process.env.CAMPUS_ALLOWLIST || "").toUpperCase().includes("TX")) {
    console.error("Refusing to run without CAMPUS_ALLOWLIST=TX (would scrape everything).");
    process.exit(1);
  }

  const base = JSON.parse(fs.readFileSync(BASE_PATH, "utf8"));
  const prevTx = base.jobs.filter((j) => String(j.source).trim() === "TX").length;
  console.log(`Base: ${base.jobs.length} jobs, ${prevTx} currently tagged TX`);

  console.log("Scraping TX only (this loads Playwright; TX is large, may take several minutes)...");
  const result = await scrapeAllJobsStandalone();
  const freshTx = (result.jobs || []).filter((j) => String(j.source).trim() === "TX");
  console.log(`Fresh TX scrape returned ${result.count} jobs (${freshTx.length} tagged TX).`);

  if (freshTx.length === 0) {
    console.error("Fresh TX scrape produced 0 jobs — refusing to overwrite (likely a blocked run).");
    process.exit(2);
  }

  // Per-campus breakdown for visibility
  const byCollege = {};
  for (const j of freshTx) { const c = j.college || "?"; byCollege[c] = (byCollege[c] || 0) + 1; }
  console.log("TX by campus:");
  for (const [c, n] of Object.entries(byCollege).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}  ${c}`);

  const kept = base.jobs.filter((j) => String(j.source).trim() !== "TX");
  const merged = withCanonicalIds([...kept, ...freshTx]);
  const out = { ...base, scrapedAt: result.scrapedAt, count: merged.length, jobs: merged };

  for (const t of TARGETS) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, JSON.stringify(out, null, 2));
    console.log(`Wrote ${path.relative(root, t)} (${out.count} jobs)`);
  }
  console.log(`Done: TX ${prevTx} -> ${freshTx.length}; total ${base.jobs.length} -> ${merged.length}`);
})();
