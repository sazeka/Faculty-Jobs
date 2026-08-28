#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { buildListingIndex } from "./lib/jobs-listing-index.js";
import { buildFullTextSearchIndex } from "./lib/jobs-search-index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SOURCES = [
  ["public/jobs.json", "web-vue/public/jobs.json"],
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

function sha1Hex(value) {
  return createHash("sha1").update(String(value || "")).digest("hex");
}

function normalizeKeyPart(value) {
  return clean(value).toLowerCase();
}

function attachCanonicalIds(jobs) {
  return jobs.map((job) => {
    const title = normalizeKeyPart(job?.titleClean || job?.title || "");
    const college = normalizeKeyPart(job?.college || "");
    const dept = normalizeKeyPart(job?.department || "");
    const state = normalizeKeyPart(job?.state || job?.source || "");
    const source = normalizeKeyPart(job?.source || "");
    const url = normalizeKeyPart(job?.url || "");
    const canonicalGroupId = clean(job?.canonicalGroupId) || `grp_${sha1Hex([title, college, dept, state].join("|")).slice(0, 16)}`;
    const canonicalJobId = clean(job?.canonicalJobId) || `job_${sha1Hex([canonicalGroupId, source, url].join("|")).slice(0, 16)}`;
    return { ...job, canonicalGroupId, canonicalJobId };
  });
}

function buildJobsChunks(sourcePath, outDir) {
  if (!fs.existsSync(sourcePath)) return;
  const payload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
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
  if (srcRel === "public/jobs.json" && dstRel === "web-vue/public/jobs.json") {
    const payload = JSON.parse(fs.readFileSync(src, "utf8"));
    const jobsRaw = Array.isArray(payload?.jobs) ? payload.jobs : [];
    const jobs = attachCanonicalIds(jobsRaw);
    writeJson(dst, { ...payload, jobs, count: jobs.length });
  } else {
    fs.copyFileSync(src, dst);
  }
  console.log(`Synced ${srcRel} -> ${dstRel}`);
}

const jobsSource = path.join(ROOT, "public", "jobs.json");
buildJobsChunks(jobsSource, path.join(ROOT, "web-vue", "public", "data"));
console.log("Built compact listing index + chunk manifest in web-vue/public/data");
