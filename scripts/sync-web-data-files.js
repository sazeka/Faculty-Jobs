#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildListingIndex } from "./lib/jobs-listing-index.js";
import { buildFullTextSearchIndex } from "./lib/jobs-search-index.js";
import { attachCanonicalIds } from "./lib/canonical-id.js";
import { readJobsFile } from "./lib/jobs-file.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// public/jobs.json is not copied into the site: the frontend reads the listing
// index + chunks built below, and a full copy would be re-published as a ~90 MB
// docs/jobs.json by copy-dist (see lib/jobs-file.js).
const SOURCES = [
  ["public/college-coords.json", "web-vue/public/college-coords.json"],
  ["public/data/site-stats.json", "web-vue/public/data/site-stats.json"],
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function slug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeCompactJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

// Canonical-ID hash formula lives in ./lib/canonical-id.js (issue #135) --
// shared with scripts/scrape-to-json.js so the two never drift apart.

function buildJobsChunks(sourcePath, outDir) {
  if (!fs.existsSync(sourcePath)) return;
  const payload = readJobsFile(sourcePath);
  const jobsRaw = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const jobs = attachCanonicalIds(jobsRaw);

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
  const sortedSources = [...bySource.keys()].sort((a, b) => a.localeCompare(b));
  for (const source of sortedSources) {
    const rows = bySource.get(source) || [];
    const id = slug(source);
    const fileName = `${id}.json`;
    const relPath = `chunks/${fileName}`;
    writeJson(path.join(outDir, relPath), {
      source,
      count: rows.length,
      jobs: rows,
    });
    chunkEntries.push({ id, source, count: rows.length, path: relPath });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    scrapedAt: payload?.scrapedAt || null,
    totalJobs: jobs.length,
    totalChunks: chunkEntries.length,
    chunks: chunkEntries,
  };

  writeJson(path.join(outDir, "jobs-manifest.json"), manifest);
  writeCompactJson(path.join(outDir, "jobs-index.json"), buildListingIndex(payload, jobs));
  writeCompactJson(path.join(outDir, "jobs-search-index.json"), buildFullTextSearchIndex(payload, jobs));
}

for (const [srcRel, dstRel] of SOURCES) {
  const src = path.join(ROOT, srcRel);
  const dst = path.join(ROOT, dstRel);
  if (!fs.existsSync(src)) {
    console.warn(`Skip missing source: ${srcRel}`);
    continue;
  }
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  console.log(`Synced ${srcRel} -> ${dstRel}`);
}

// Remove copies left by the old sync, so vite can't ship one into dist/.
for (const stale of ["web-vue/public/jobs.json", "docs/jobs.json"]) {
  fs.rmSync(path.join(ROOT, stale), { force: true });
}

const jobsSource = path.join(ROOT, "public", "jobs.json");
buildJobsChunks(jobsSource, path.join(ROOT, "web-vue", "public", "data"));
console.log("Built compact listing index + chunk manifest in web-vue/public/data");
