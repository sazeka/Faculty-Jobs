#!/usr/bin/env node
// Backfill the soft `startDate` (anticipated position start) on stored jobs by
// parsing their existing description text. The description scraper now does this
// for newly-fetched pages; this applies extractStartDate() to the descriptions we
// already have. Idempotent — only fills jobs that lack startDate.
//
// Usage: node scripts/backfill-start-dates.js [--dry-run]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractStartDate } from "./lib/start-date.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public", "jobs.json");
const DOCS = path.join(ROOT, "docs", "jobs.json");
const DRY = process.argv.includes("--dry-run");

const payload = JSON.parse(fs.readFileSync(PUBLIC, "utf8"));
let filled = 0, ymd = 0, season = 0;
const samples = [];
for (const job of payload.jobs) {
  if (job.startDate || !job.description) continue;
  const sd = extractStartDate(job.description);
  if (!sd) continue;
  job.startDate = sd;
  filled++;
  if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) ymd++; else season++;
  if (samples.length < 12) samples.push(`${sd}  ←  ${(job.title || "").slice(0, 40)} [${job.college}]`);
}
const total = payload.jobs.filter((j) => j.startDate).length;
console.log(`Filled startDate on ${filled} jobs (${ymd} calendar dates, ${season} season/month).`);
console.log(`Total with startDate now: ${total} / ${payload.jobs.length}`);
console.log("Samples:");
samples.forEach((s) => console.log("  " + s));

if (DRY) { console.log("\n*** DRY RUN — no files written ***"); process.exit(0); }
const out = JSON.stringify(payload, null, 2) + "\n";
fs.writeFileSync(PUBLIC, out, "utf8");
if (fs.existsSync(DOCS)) fs.writeFileSync(DOCS, out, "utf8");
console.log("\nWrote public/jobs.json + docs/jobs.json");
