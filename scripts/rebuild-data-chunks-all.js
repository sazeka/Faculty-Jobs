// One-off: regenerate the per-source job chunks + manifest into ALL THREE data
// dirs (docs/data, public/data, web-vue/public/data) from public/jobs.json, so
// a data-only change (e.g. the scoped TN scrape) reaches the live site
// (served from docs/data) without a full vite rebuild. Mirrors the chunk logic
// in scripts/sync-web-data-files.js.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { buildListingIndex } from "./lib/jobs-listing-index.js";
import { buildFullTextSearchIndex } from "./lib/jobs-search-index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function clean(v) { return String(v || "").replace(/\s+/g, " ").trim(); }
function nk(v) { return clean(v).toLowerCase(); }
function sha1Hex(v) { return createHash("sha1").update(String(v || "")).digest("hex"); }
function slug(v) { return clean(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown"; }
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function writeJson(p, v) { ensureDir(path.dirname(p)); fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, "utf8"); }
function writeCompactJson(p, v) { ensureDir(path.dirname(p)); fs.writeFileSync(p, `${JSON.stringify(v)}\n`, "utf8"); }

function attachCanonicalIds(jobs) {
  return jobs.map((job) => {
    const title = nk(job?.titleClean || job?.title || "");
    const college = nk(job?.college || "");
    const dept = nk(job?.department || "");
    const state = nk(job?.state || job?.source || "");
    const source = nk(job?.source || "");
    const url = nk(job?.url || "");
    const canonicalGroupId = clean(job?.canonicalGroupId) || `grp_${sha1Hex([title, college, dept, state].join("|")).slice(0, 16)}`;
    const canonicalJobId = clean(job?.canonicalJobId) || `job_${sha1Hex([canonicalGroupId, source, url].join("|")).slice(0, 16)}`;
    return { ...job, canonicalGroupId, canonicalJobId };
  });
}

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

const payload = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "jobs.json"), "utf8"));
for (const dir of ["docs/data", "public/data", "web-vue/public/data"]) {
  const r = buildJobsChunks(payload, path.join(ROOT, dir));
  console.log(`Rebuilt ${dir}: ${r.sources} source chunks, ${r.totalJobs} jobs`);
}
