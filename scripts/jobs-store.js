#!/usr/bin/env node
// Maintenance for the split jobs dataset (see scripts/lib/jobs-file.js).
//
//   node scripts/jobs-store.js normalize   move inline descriptions into shards
//   node scripts/jobs-store.js check       fail if jobs.json carries inline
//                                          descriptions or any file nears the limit
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeJobsFile, descriptionsDirFor } from "./lib/jobs-file.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JOBS = path.join(ROOT, "public", "jobs.json");
// GitHub rejects files over 100 MB and warns over 50 MB.
const WARN_BYTES = 50 * 1024 * 1024;

const cmd = process.argv[2];
if (cmd === "normalize") {
  const moved = normalizeJobsFile(JOBS);
  console.log(moved ? `Moved ${moved} inline description(s) into ${path.relative(ROOT, descriptionsDirFor(JOBS))}/` : "jobs.json already normalized");
} else if (cmd === "check") {
  const problems = [];
  const raw = JSON.parse(fs.readFileSync(JOBS, "utf8"));
  const inline = (raw.jobs || []).filter((j) => j && j.description).length;
  if (inline) problems.push(`${inline} job(s) in public/jobs.json carry an inline description; run \`npm run jobs:normalize\``);
  const files = [JOBS, ...fs.readdirSync(descriptionsDirFor(JOBS)).map((f) => path.join(descriptionsDirFor(JOBS), f))];
  for (const f of files) {
    const size = fs.statSync(f).size;
    if (size > WARN_BYTES) problems.push(`${path.relative(ROOT, f)} is ${(size / 1048576).toFixed(1)} MB (GitHub warns at 50 MB, rejects at 100 MB)`);
  }
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
  console.log(`✓ jobs dataset OK (${(fs.statSync(JOBS).size / 1048576).toFixed(1)} MB jobs.json + ${files.length - 1} description shards)`);
} else {
  console.error("usage: node scripts/jobs-store.js normalize|check");
  process.exit(2);
}
