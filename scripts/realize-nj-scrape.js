// One-off: scrape ONLY New Jersey (via CAMPUS_ALLOWLIST=NJ) through the real
// orchestrator, then surgically replace the source==="NJ" jobs in the live
// jobs.json while leaving every other state byte-for-byte. This realizes:
// - a poll-based wait in scrapeNjTaleo (TCNJ's Taleo job list renders via AJAX
//   well after domcontentloaded; a fixed 900ms sleep under-read it)
// - a path-segment fix to the generic scraper's nav-link exclusion regex
//   (bare "about" substring was killing links like
//   /about-felician-university/careers-at-felician/psycprof2/)
// - Camden County College switched to its real PeopleAdmin board
// - Stockton's stale employment-type filter param removed
// without a full scrape that could strip enrichment from the other 55 sources.
//
// Run with:  CAMPUS_ALLOWLIST=NJ node scripts/realize-nj-scrape.js
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
  if (!(process.env.CAMPUS_ALLOWLIST || "").toUpperCase().includes("NJ")) {
    console.error("Refusing to run without CAMPUS_ALLOWLIST=NJ (would scrape everything).");
    process.exit(1);
  }

  const base = JSON.parse(fs.readFileSync(BASE_PATH, "utf8"));
  const prevNj = base.jobs.filter((j) => String(j.source).trim() === "NJ").length;
  console.log(`Base: ${base.jobs.length} jobs, ${prevNj} currently tagged NJ`);

  console.log("Scraping NJ only (this loads Playwright; ~a few minutes)...");
  const result = await scrapeAllJobsStandalone();
  const freshNj = (result.jobs || []).filter((j) => String(j.source).trim() === "NJ");
  console.log(`Fresh NJ scrape returned ${result.count} jobs (${freshNj.length} tagged NJ).`);

  if (freshNj.length === 0) {
    console.error("Fresh NJ scrape produced 0 jobs — refusing to overwrite (likely a blocked run).");
    process.exit(2);
  }

  // Per-campus breakdown for visibility
  const byCollege = {};
  for (const j of freshNj) { const c = j.college || "?"; byCollege[c] = (byCollege[c] || 0) + 1; }
  console.log("NJ by campus:");
  for (const [c, n] of Object.entries(byCollege).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}  ${c}`);

  const kept = base.jobs.filter((j) => String(j.source).trim() !== "NJ");
  const merged = withCanonicalIds([...kept, ...freshNj]);
  const out = { ...base, scrapedAt: result.scrapedAt, count: merged.length, jobs: merged };

  for (const t of TARGETS) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, JSON.stringify(out, null, 2));
    console.log(`Wrote ${path.relative(root, t)} (${out.count} jobs)`);
  }
  console.log(`Done: NJ ${prevNj} -> ${freshNj.length}; total ${base.jobs.length} -> ${merged.length}`);
})();
