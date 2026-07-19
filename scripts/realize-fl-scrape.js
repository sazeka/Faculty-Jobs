// One-off: scrape ONLY Florida (via CAMPUS_ALLOWLIST=FL) through the real
// orchestrator, then surgically replace the source==="FL" jobs in the live
// jobs.json while leaving every other state byte-for-byte. This realizes the
// new FIU JSON-API scraper, the ExactHire (Eckerd), fixed UCF/UNF/NCF/Rollins
// URLs, and the generic ADP hand-off, without a full scrape that could strip
// enrichment from the other 55 sources.
//
// Run with:  CAMPUS_ALLOWLIST=FL node scripts/realize-fl-scrape.js
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
  if (!(process.env.CAMPUS_ALLOWLIST || "").toUpperCase().includes("FL")) {
    console.error("Refusing to run without CAMPUS_ALLOWLIST=FL (would scrape everything).");
    process.exit(1);
  }

  const base = JSON.parse(fs.readFileSync(BASE_PATH, "utf8"));
  const prevFl = base.jobs.filter((j) => String(j.source).trim() === "FL").length;
  console.log(`Base: ${base.jobs.length} jobs, ${prevFl} currently tagged FL`);

  console.log("Scraping FL only (this loads Playwright; ~a few minutes)...");
  const result = await scrapeAllJobsStandalone();
  const freshFl = (result.jobs || []).filter((j) => String(j.source).trim() === "FL");
  console.log(`Fresh FL scrape returned ${result.count} jobs (${freshFl.length} tagged FL).`);

  if (freshFl.length === 0) {
    console.error("Fresh FL scrape produced 0 jobs — refusing to overwrite (likely a blocked run).");
    process.exit(2);
  }

  // Per-campus breakdown for visibility
  const byCollege = {};
  for (const j of freshFl) { const c = j.college || "?"; byCollege[c] = (byCollege[c] || 0) + 1; }
  console.log("FL by campus:");
  for (const [c, n] of Object.entries(byCollege).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}  ${c}`);

  const kept = base.jobs.filter((j) => String(j.source).trim() !== "FL");
  const merged = withCanonicalIds([...kept, ...freshFl]);
  const out = { ...base, scrapedAt: result.scrapedAt, count: merged.length, jobs: merged };

  for (const t of TARGETS) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, JSON.stringify(out, null, 2));
    console.log(`Wrote ${path.relative(root, t)} (${out.count} jobs)`);
  }
  console.log(`Done: FL ${prevFl} -> ${freshFl.length}; total ${base.jobs.length} -> ${merged.length}`);
})();
