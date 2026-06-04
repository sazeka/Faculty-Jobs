// One-off: scrape ONLY Tennessee (via CAMPUS_ALLOWLIST=TN) through the real
// orchestrator, then surgically replace the source==="TN" jobs in the live
// jobs.json while leaving every other state byte-for-byte. This realizes the
// new TN overrides + platform scrapers (Oracle/csod/Paycom/ADP/TBR/Paylocity)
// without a full scrape that could strip enrichment from the other 55 sources.
//
// Run with:  CAMPUS_ALLOWLIST=TN node scripts/realize-tn-scrape.js
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
  if (!(process.env.CAMPUS_ALLOWLIST || "").toUpperCase().includes("TN")) {
    console.error("Refusing to run without CAMPUS_ALLOWLIST=TN (would scrape everything).");
    process.exit(1);
  }

  const base = JSON.parse(fs.readFileSync(BASE_PATH, "utf8"));
  const prevTn = base.jobs.filter((j) => String(j.source).trim() === "TN").length;
  console.log(`Base: ${base.jobs.length} jobs, ${prevTn} currently tagged TN`);

  console.log("Scraping TN only (this loads Playwright; ~a few minutes)...");
  const result = await scrapeAllJobsStandalone();
  const freshTn = (result.jobs || []).filter((j) => String(j.source).trim() === "TN");
  console.log(`Fresh TN scrape returned ${result.count} jobs (${freshTn.length} tagged TN).`);

  if (freshTn.length === 0) {
    console.error("Fresh TN scrape produced 0 jobs — refusing to overwrite (likely a blocked run).");
    process.exit(2);
  }

  // Per-campus breakdown for visibility
  const byCollege = {};
  for (const j of freshTn) { const c = j.college || "?"; byCollege[c] = (byCollege[c] || 0) + 1; }
  console.log("TN by campus:");
  for (const [c, n] of Object.entries(byCollege).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}  ${c}`);

  const kept = base.jobs.filter((j) => String(j.source).trim() !== "TN");
  const merged = withCanonicalIds([...kept, ...freshTn]);
  const out = { ...base, scrapedAt: result.scrapedAt, count: merged.length, jobs: merged };

  for (const t of TARGETS) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, JSON.stringify(out, null, 2));
    console.log(`Wrote ${path.relative(root, t)} (${out.count} jobs)`);
  }
  console.log(`Done: TN ${prevTn} -> ${freshTn.length}; total ${base.jobs.length} -> ${merged.length}`);
})();
