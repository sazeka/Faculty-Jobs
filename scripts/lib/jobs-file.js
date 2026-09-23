// public/jobs.json is stored in two parts so no tracked file approaches
// GitHub's 100 MB limit (descriptions were ~78% of an 87 MB file):
//
//   public/jobs.json                 every job, without `description`
//   public/job-descriptions/NN.json  { <jobKey>: description } in 32 shards
//
// Always read and write the dataset through readJobsFile/writeJobsFile, which
// reassemble and split it. A script that bypasses them and writes a full payload
// straight to jobs.json still works: readers prefer an inline description over
// the shard copy, and normalizeJobsFile() (run before every commit) moves inline
// descriptions back into the shards.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const SHARD_COUNT = 32;
export const DESCRIPTIONS_DIRNAME = "job-descriptions";

export function descriptionsDirFor(jobsPath) {
  return path.join(path.dirname(jobsPath), DESCRIPTIONS_DIRNAME);
}

// Stable per-job key: the canonical job id when present, else the URL.
export function jobKey(job) {
  return String(job?.canonicalJobId || job?.url || "").trim();
}

function shardName(key) {
  const n = parseInt(createHash("sha1").update(key).digest("hex").slice(0, 8), 16) % SHARD_COUNT;
  return `${n.toString(16).padStart(2, "0")}.json`;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function readShards(dir) {
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const name of fs.readdirSync(dir)) {
    if (!/^[0-9a-f]{2}\.json$/.test(name)) continue;
    for (const [k, v] of Object.entries(readJson(path.join(dir, name)))) map.set(k, v);
  }
  return map;
}

// The full payload ({ scrapedAt, count, jobs: [...] }) with descriptions
// attached. Pass { descriptions: false } when only listing fields are needed.
export function readJobsFile(jobsPath, { descriptions = true } = {}) {
  const payload = readJson(jobsPath);
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  if (!descriptions) return payload;
  const shards = readShards(descriptionsDirFor(jobsPath));
  if (!shards.size) return payload;
  return {
    ...payload,
    jobs: jobs.map((job) => {
      if (job?.description) return job; // inline (unnormalized) copy is the fresher one
      const d = shards.get(jobKey(job));
      return d ? { ...job, description: d } : job;
    }),
  };
}

// Writes the slim jobs file and rebuilds every shard from `payload`, so shards
// never keep descriptions for jobs that are gone. A job with no `description`
// property keeps its stored one (so writing back a slim read loses nothing);
// an explicitly empty description removes it. Unchanged shards are left
// byte-identical (git sees no diff).
export function writeJobsFile(jobsPath, payload, { pretty = true } = {}) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const dir = descriptionsDirFor(jobsPath);
  const existing = readShards(dir);
  const shards = Array.from({ length: SHARD_COUNT }, () => ({}));
  const slim = jobs.map((job) => {
    if (!job || typeof job !== "object") return job;
    const key = jobKey(job);
    const hasOwn = "description" in job;
    const description = hasOwn ? job.description : existing.get(key);
    if (description && key) shards[parseInt(shardName(key), 16)][key] = description;
    // Only text moves to the shards; a null/"" placeholder stays inline as-is.
    if (!hasOwn || !job.description || !key) return job;
    const { description: _drop, ...rest } = job;
    return rest;
  });

  fs.mkdirSync(dir, { recursive: true });
  shards.forEach((shard, i) => {
    const file = path.join(dir, `${i.toString(16).padStart(2, "0")}.json`);
    const sorted = Object.fromEntries(Object.keys(shard).sort().map((k) => [k, shard[k]]));
    const text = `${JSON.stringify(sorted, null, 1)}\n`;
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text, "utf8");
  });

  fs.mkdirSync(path.dirname(jobsPath), { recursive: true });
  const out = { ...payload, jobs: slim };
  fs.writeFileSync(jobsPath, pretty ? `${JSON.stringify(out, null, 2)}\n` : `${JSON.stringify(out)}\n`, "utf8");
}

// Move any inline descriptions (from a script that wrote jobs.json directly)
// into the shards. Idempotent; returns how many jobs carried inline text.
export function normalizeJobsFile(jobsPath) {
  const raw = readJson(jobsPath);
  const inline = (raw.jobs || []).filter((j) => j && typeof j === "object" && j.description).length;
  writeJobsFile(jobsPath, readJobsFile(jobsPath));
  return inline;
}

// readJobsFile that returns null instead of throwing (missing/corrupt file).
export function readJobsFileOrNull(jobsPath, options) {
  try { return readJobsFile(jobsPath, options); } catch { return null; }
}
