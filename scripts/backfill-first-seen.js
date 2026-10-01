#!/usr/bin/env node
/**
 * backfill-first-seen.js
 *
 * Recovers each listing's earliest appearance after the 2026-09-19 reset, when
 * #166 re-keyed every canonicalJobId without migrating generated/job-presence.json
 * and the presence agent stamped ~22.5k listings with firstSeen=2026-09-19.
 *
 * Evidence, matched to current jobs by canonicalJobId or canonicalized url:
 *   - one historical public/jobs.json commit per ISO week (the week's last
 *     commit), plus the last commit before the reset, which still carries the
 *     ledger's original firstSeen values. Each snapshot contributes
 *     min(job.firstSeen, snapshot date) per job.
 *   - data/releases/<date>.json snapshots, which contribute their release date
 *     (and firstSeen when present).
 *
 * firstSeen only ever moves earlier. --write updates public/jobs.json and
 * lowers matching generated/job-presence.json entries; without it the script
 * only reports. After --write, rebuild derived data as the scrape workflow
 * does (sync-web-data-files.js, then copy web-vue/public/data to docs/ and
 * public/, then npm run verify:data-sync).
 *
 * Usage:
 *   node scripts/backfill-first-seen.js [--write] [--report PATH]
 *     [--since YYYY-MM-DD] [--reset-commit SHA]
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { canonicalizeUrl } from "./lib/url-normalization.js";
import { readJobsFile, writeJobsFile } from "./lib/jobs-file.js";
import { validFirstSeen } from "./lib/job-presence-ledger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_JOBS = path.join(ROOT, "public", "jobs.json");
const PRESENCE_PATH = path.join(ROOT, "generated", "job-presence.json");
const RELEASES_DIR = path.join(ROOT, "data", "releases");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) { out[a.slice(2)] = true; continue; }
    out[a.slice(2)] = next;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const WRITE = Boolean(args.write);
const REPORT_PATH = args.report ? path.resolve(args.report) : null;
const SINCE = args.since || "";
// The scheduled scrape that performed the reset.
const RESET_COMMIT = args["reset-commit"] || "0d7a3f1e9e";

function git(argv, opts = {}) {
  return execFileSync("git", argv, { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...opts });
}

function isoWeek(date) {
  const d = new Date(`${date}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** One commit per ISO week (the latest in that week) plus the pre-reset commit. */
function sampleCommits(log, preResetSha) {
  const byWeek = new Map();
  for (const { sha, date } of log) {
    const week = isoWeek(date);
    const existing = byWeek.get(week);
    if (!existing || date >= existing.date) byWeek.set(week, { sha, date });
  }
  const picked = [...byWeek.values()];
  if (preResetSha && !picked.some((c) => c.sha === preResetSha.sha)) picked.push(preResetSha);
  return picked.sort((a, b) => a.date.localeCompare(b.date));
}

const today = new Date().toISOString().slice(0, 10);
const earliestById = new Map();
const earliestByUrl = new Map();
const evidenceSources = [];

function lower(map, key, date) {
  if (!key || !date) return;
  const existing = map.get(key);
  if (!existing || date < existing) map.set(key, date);
}

function ingest(jobs, snapshotDate, label) {
  let n = 0;
  for (const job of jobs || []) {
    if (!job) continue;
    const carried = validFirstSeen(job.firstSeen, snapshotDate);
    const date = carried && carried < snapshotDate ? carried : snapshotDate;
    lower(earliestById, job.canonicalJobId, date);
    lower(earliestByUrl, canonicalizeUrl(job.url), date);
    n += 1;
  }
  evidenceSources.push({ label, date: snapshotDate, jobs: n });
}

// ── Historical public/jobs.json commits ──────────────────────────────────────

const log = git(["log", "--format=%H %cI", ...(SINCE ? [`--since=${SINCE}`] : []), "--", "public/jobs.json"])
  .trim().split("\n").filter(Boolean)
  .map((line) => { const [sha, iso] = line.split(" "); return { sha, date: iso.slice(0, 10) }; });

let preReset = null;
try {
  const sha = git(["rev-list", "-1", `${RESET_COMMIT}^`, "--", "public/jobs.json"]).trim();
  const date = git(["log", "-1", "--format=%cI", sha]).trim().slice(0, 10);
  if (sha) preReset = { sha, date };
} catch {
  console.warn(`⚠️  Could not resolve pre-reset commit from ${RESET_COMMIT}`);
}

const commits = sampleCommits(log, preReset);
console.log(`Sampling ${commits.length} of ${log.length} public/jobs.json commits…`);
for (const { sha, date } of commits) {
  let payload;
  try {
    payload = JSON.parse(git(["show", `${sha}:public/jobs.json`]));
  } catch (e) {
    console.warn(`  skip ${sha.slice(0, 10)} ${date}: ${e.message.split("\n")[0]}`);
    continue;
  }
  const snapshotDate = String(payload?.scrapedAt || "").slice(0, 10) || date;
  ingest(payload?.jobs, snapshotDate < date ? snapshotDate : date, `commit ${sha.slice(0, 10)}`);
  console.log(`  ${date} ${sha.slice(0, 10)}  ${payload?.jobs?.length ?? 0} jobs`);
}

// ── Research releases ────────────────────────────────────────────────────────

for (const name of fs.existsSync(RELEASES_DIR) ? fs.readdirSync(RELEASES_DIR) : []) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
  if (!m) continue;
  const payload = JSON.parse(fs.readFileSync(path.join(RELEASES_DIR, name), "utf8"));
  const records = Array.isArray(payload) ? payload : payload.jobs || payload.records || [];
  ingest(records, m[1], `release ${name}`);
  console.log(`  release ${name}  ${records.length} records`);
}

// ── Apply to current jobs ────────────────────────────────────────────────────

const current = readJobsFile(PUBLIC_JOBS, { descriptions: false });
const changes = [];
const histogramBefore = {};
const histogramAfter = {};
for (const job of current.jobs) {
  const before = validFirstSeen(job.firstSeen, today);
  const recovered = [earliestById.get(job.canonicalJobId), earliestByUrl.get(canonicalizeUrl(job.url)), before]
    .filter(Boolean).sort()[0] || null;
  const month = (d) => (d ? d.slice(0, 7) : "none");
  histogramBefore[month(before)] = (histogramBefore[month(before)] || 0) + 1;
  histogramAfter[month(recovered)] = (histogramAfter[month(recovered)] || 0) + 1;
  if (recovered && recovered !== before) {
    changes.push({ canonicalJobId: job.canonicalJobId, url: job.url, before, after: recovered });
    job.firstSeen = recovered;
  }
}

const atReset = current.jobs.filter((j) => j.firstSeen === "2026-09-19").length;
console.log(`\nJobs: ${current.jobs.length}; firstSeen moved earlier: ${changes.length}; still 2026-09-19: ${atReset}`);
console.log("firstSeen by month (before → after):");
for (const month of [...new Set([...Object.keys(histogramBefore), ...Object.keys(histogramAfter)])].sort()) {
  console.log(`  ${month}  ${histogramBefore[month] || 0} → ${histogramAfter[month] || 0}`);
}

if (REPORT_PATH) {
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(), evidenceSources, changedCount: changes.length,
    histogramBefore, histogramAfter, changes,
  }, null, 2) + "\n");
  console.log(`Report: ${REPORT_PATH}`);
}

if (WRITE) {
  writeJobsFile(PUBLIC_JOBS, current);
  const presence = JSON.parse(fs.readFileSync(PRESENCE_PATH, "utf8"));
  let lowered = 0;
  for (const job of current.jobs) {
    const entry = presence.jobs?.[job.canonicalJobId];
    if (entry && job.firstSeen && (!entry.firstSeen || job.firstSeen < entry.firstSeen)) {
      entry.firstSeen = job.firstSeen;
      lowered += 1;
    }
  }
  fs.writeFileSync(PRESENCE_PATH, JSON.stringify(presence, null, 2) + "\n");
  console.log(`Wrote public/jobs.json and lowered ${lowered} ledger entries.`);
} else {
  console.log("Dry run: no files written (pass --write to apply).");
}
