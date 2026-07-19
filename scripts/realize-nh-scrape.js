// One-off: scrape ONLY New Hampshire (via CAMPUS_ALLOWLIST=NH) through the
// real orchestrator, then surgically replace the source==="NH" jobs in the
// live jobs.json while leaving every other state byte-for-byte. This realizes
// the newly-added/fixed Saint Anselm (Workday), Franklin Pierce (generic),
// Rivier (SchoolJobs), New England College (PeopleAdmin), and SNHU (generic)
// sources, without a full scrape that could strip enrichment from the other
// 55 sources.
//
// Run with:  CAMPUS_ALLOWLIST=NH node scripts/realize-nh-scrape.js
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
  if (!(process.env.CAMPUS_ALLOWLIST || "").toUpperCase().includes("NH")) {
    console.error("Refusing to run without CAMPUS_ALLOWLIST=NH (would scrape everything).");
    process.exit(1);
  }

  const base = JSON.parse(fs.readFileSync(BASE_PATH, "utf8"));
  const prevNh = base.jobs.filter((j) => String(j.source).trim() === "NH").length;
  console.log(`Base: ${base.jobs.length} jobs, ${prevNh} currently tagged NH`);

  console.log("Scraping NH only (this loads Playwright; ~a few minutes)...");
  const result = await scrapeAllJobsStandalone();
  const freshNh = (result.jobs || []).filter((j) => String(j.source).trim() === "NH");
  console.log(`Fresh NH scrape returned ${result.count} jobs (${freshNh.length} tagged NH).`);

  if (freshNh.length === 0) {
    console.error("Fresh NH scrape produced 0 jobs — refusing to overwrite (likely a blocked run).");
    process.exit(2);
  }

  // Per-campus breakdown for visibility
  const byCollege = {};
  for (const j of freshNh) { const c = j.college || "?"; byCollege[c] = (byCollege[c] || 0) + 1; }
  console.log("NH by campus:");
  for (const [c, n] of Object.entries(byCollege).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}  ${c}`);

  const kept = base.jobs.filter((j) => String(j.source).trim() !== "NH");
  const merged = withCanonicalIds([...kept, ...freshNh]);
  const out = { ...base, scrapedAt: result.scrapedAt, count: merged.length, jobs: merged };

  for (const t of TARGETS) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, JSON.stringify(out, null, 2));
    console.log(`Wrote ${path.relative(root, t)} (${out.count} jobs)`);
  }
  console.log(`Done: NH ${prevNh} -> ${freshNh.length}; total ${base.jobs.length} -> ${merged.length}`);
})();
