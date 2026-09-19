// One-off: regenerate the per-source job chunks + manifest into ALL THREE data
// dirs (docs/data, public/data, web-vue/public/data) from public/jobs.json, so
// a data-only change (e.g. the scoped TN scrape) reaches the live site
// (served from docs/data) without a full vite rebuild. Mirrors the chunk logic
// in scripts/sync-web-data-files.js.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildListingIndex } from "./lib/jobs-listing-index.js";
import { buildFullTextSearchIndex } from "./lib/jobs-search-index.js";
import { summarizeCatalog } from "../web-vue/src/lib/listingTrust.js";
import { attachCanonicalIds } from "./lib/canonical-id.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// NOTE (issue #164): this used to keep its own independent, hand-rolled copy
// of attachCanonicalIds() -- unlike scripts/sync-web-data-files.js, which has
// always imported the shared implementation above. The two had quietly
// drifted apart: the shared lib/canonical-id.js version always recomputes
// canonicalGroupId/canonicalJobId fresh from a job's current fields (the
// comment on its own attachCanonicalIds() is explicit about this), while the
// old local copy here preserved whatever canonicalGroupId/canonicalJobId was
// already stored on the job, if any. That meant a migration that edits a
// job's url/source/title/college/department (its canonical-id inputs)
// without also refreshing its cached canonicalGroupId/canonicalJobId would
// rebuild perfectly consistent output via sync-web-data-files.js, but STALE,
// mismatched ids via this script -- silently reintroducing exactly the kind
// of id drift issue #164 reports, from a full from-scratch rebuild that
// looked like it should have fixed it. Importing the one shared
// implementation is what actually prevents that class of drift going
// forward, not just running "the rebuild script" more often.
function clean(v) { return String(v || "").replace(/\s+/g, " ").trim(); }
function slug(v) { return clean(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown"; }
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function writeJson(p, v) { ensureDir(path.dirname(p)); fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, "utf8"); }
function writeCompactJson(p, v) { ensureDir(path.dirname(p)); fs.writeFileSync(p, `${JSON.stringify(v)}\n`, "utf8"); }

function buildJobsChunks(payload, outDir) {
  const jobs = attachCanonicalIds(Array.isArray(payload?.jobs) ? payload.jobs : []);
  const bySource = new Map();
  for (const job of jobs) {
    const src = clean(job?.source) || "Unknown";
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(job);
  }
  const chunksDir = path.join(outDir, "chunks");
  fs.rmSync(chunksDir, { recursive: true, force: true });
  ensureDir(chunksDir);
  const chunkEntries = [];
  for (const source of [...bySource.keys()].sort((a, b) => a.localeCompare(b))) {
    const rows = bySource.get(source) || [];
    const id = slug(source);
    const relPath = `chunks/${id}.json`;
    writeJson(path.join(outDir, relPath), { source, count: rows.length, jobs: rows });
    chunkEntries.push({ id, source, count: rows.length, path: relPath });
  }
  const manifest = {
    generatedAt: payload?.scrapedAt || null, // stable: avoid Date.now noise; tie to scrape
    scrapedAt: payload?.scrapedAt || null,
    totalJobs: jobs.length,
    totalChunks: chunkEntries.length,
    chunks: chunkEntries,
  };
  writeJson(path.join(outDir, "jobs-manifest.json"), manifest);
  writeCompactJson(path.join(outDir, "jobs-index.json"), buildListingIndex(payload, jobs));
  writeCompactJson(path.join(outDir, "jobs-search-index.json"), buildFullTextSearchIndex(payload, jobs));
  return { sources: chunkEntries.length, totalJobs: jobs.length };
}

function buildSiteStats(payload, previous = {}) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const scrapeDate = clean(payload?.scrapedAt).slice(0, 10) || new Date().toISOString().slice(0, 10);
  const weekCutoffDate = new Date(`${scrapeDate}T12:00:00Z`);
  weekCutoffDate.setUTCDate(weekCutoffDate.getUTCDate() - 6);
  const weekCutoff = weekCutoffDate.toISOString().slice(0, 10);
  const firstSeenByGroup = new Map();
  const collegeSet = new Set();
  const stateSet = new Set();
  for (const job of jobs) {
    const groupId = clean(job?.canonicalGroupId || job?.canonicalJobId || job?.url);
    const firstSeen = clean(job?.firstSeen).slice(0, 10);
    const existing = firstSeenByGroup.get(groupId);
    if (groupId && firstSeen && (!existing || firstSeen < existing)) firstSeenByGroup.set(groupId, firstSeen);
    if (clean(job?.college)) collegeSet.add(clean(job.college));
    if (clean(job?.state || job?.source)) stateSet.add(clean(job.state || job.source));
  }
  const firstSeenDates = [...firstSeenByGroup.values()];
  const newToday = firstSeenDates.filter((date) => date === scrapeDate).length;
  const newThisWeek = firstSeenDates.filter((date) => date >= weekCutoff).length;
  return {
    ...previous,
    generatedAt: payload?.scrapedAt || previous.generatedAt || null,
    scrapeDate,
    total: jobs.length,
    ...summarizeCatalog(jobs, new Date(`${scrapeDate}T12:00:00Z`)),
    uniqueColleges: collegeSet.size,
    stateSystems: stateSet.size,
    newToday,
    newThisWeek,
    newPostingsToday: newToday,
    newPostingsThisWeek: newThisWeek,
  };
}

const payload = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "jobs.json"), "utf8"));
const previousSiteStatsPath = path.join(ROOT, "public", "data", "site-stats.json");
const previousSiteStats = fs.existsSync(previousSiteStatsPath)
  ? JSON.parse(fs.readFileSync(previousSiteStatsPath, "utf8"))
  : {};
const siteStats = buildSiteStats(payload, previousSiteStats);
for (const dir of ["docs/data", "public/data", "web-vue/public/data"]) {
  const r = buildJobsChunks(payload, path.join(ROOT, dir));
  writeJson(path.join(ROOT, dir, "site-stats.json"), siteStats);
  console.log(`Rebuilt ${dir}: ${r.sources} source chunks, ${r.totalJobs} jobs`);
}
console.log("\nNext: node scripts/verify-data-sync.js (confirms these now match public/jobs.json exactly -- issue #164)");
