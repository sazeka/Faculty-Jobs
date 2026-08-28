#!/usr/bin/env node
/**
 * agent-job-presence.js
 *
 * Tracks job presence across daily scrapes and purges listings that have been
 * absent for too many consecutive scrapes.
 *
 * Algorithm:
 *   1. Load public/jobs.json (freshly scraped jobs for today)
 *   2. Load generated/job-presence.json (or start fresh if not present)
 *   3. Build a Set of canonicalJobId values from today's jobs
 *   4. For every job in today's scrape: upsert into presence history
 *      (firstSeen=today if new, lastSeen=today and consecutiveMisses=0 always)
 *   5. For every tracked job NOT in today's scrape: increment consecutiveMisses
 *   6. Any job with consecutiveMisses >= EXPIRY_DAYS is purged from
 *      public/jobs.json (and docs/jobs.json if it exists)
 *   7. Remove purged entries from presence history
 *   8. Save updated presence history to generated/job-presence.json
 *   9. Save updated jobs to public/jobs.json (and docs/jobs.json if present)
 *
 * Usage:
 *   node scripts/agent-job-presence.js [--dry-run] [--expiry-days N]
 *
 * Options:
 *   --dry-run          Print what would be purged without modifying files.
 *   --expiry-days N    Consecutive-miss threshold before purge (default 7).
 *   --deadline-grace-days N  Days after a stated deadline before purge (default 7).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { synchronizeJobCount } from "./lib/dataset-invariants.js";
import { attachUniversityCoverage } from "./lib/site-coverage.js";
import { partitionExpiredJobs } from "./lib/post-expiration.js";
import { repairKnownInstitutionAttribution } from "./lib/institution-attribution.js";
import { normalizeTenureTrack } from "../web-vue/src/lib/jobClassification.js";
import {
  classifySourceLink,
  institutionTitleConflict,
  sanitizePostingDate,
  summarizeCatalog,
} from "../web-vue/src/lib/listingTrust.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PUBLIC_JOBS    = path.join(ROOT, "public",    "jobs.json");
const DOCS_JOBS      = path.join(ROOT, "docs",      "jobs.json");
const PRESENCE_PATH  = path.join(ROOT, "generated", "job-presence.json");
const REPORT_PATH    = path.join(ROOT, "generated", "job-presence-report.json");
const COVERAGE_PATH  = path.join(ROOT, "generated", "coverage-report.json");
// site-stats.json carries the global "new" counts the homepage shows, so the
// figure is computed once per scrape for everyone (not per-browser localStorage).
// Written into every served data dir; the daily commit step git-adds docs/data
// + public/data.
const SITE_STATS_DIRS = [
  path.join(ROOT, "docs", "data"),
  path.join(ROOT, "public", "data"),
  path.join(ROOT, "web-vue", "public", "data"),
];

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key  = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

const args        = parseArgs(process.argv.slice(2));
const DRY_RUN     = Boolean(args["dry-run"]);
const EXPIRY_DAYS = Math.max(1, Number(args["expiry-days"] || 7));
const DEADLINE_GRACE_DAYS = Math.max(0, Number(args["deadline-grace-days"] ?? 7));

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n", "utf8");
}

/** Returns today's date as YYYY-MM-DD in local time. */
function todayDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD for `n` days before today (local). */
function daysAgoDateString(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── 1. Load public/jobs.json ──────────────────────────────────────────────────

const payload = readJson(PUBLIC_JOBS);
if (!payload || !Array.isArray(payload.jobs)) {
  console.error("ERROR: Could not load public/jobs.json or jobs array is missing.");
  process.exit(1);
}

const todayJobs = payload.jobs;

// ── 2. Load or initialise presence history ────────────────────────────────────

const today = todayDateString();

let presence = readJson(PRESENCE_PATH);
if (!presence || typeof presence.jobs !== "object" || presence.jobs === null) {
  presence = { lastRunDate: today, jobs: {}, expiredDeadlines: {} };
}
if (!presence.expiredDeadlines || typeof presence.expiredDeadlines !== "object") presence.expiredDeadlines = {};

// One-time migration from the prior run's detailed report, so the first
// release of the deadline cache remembers the listings it just removed.
const previousPresenceReport = readJson(REPORT_PATH);
for (const item of previousPresenceReport?.purgedJobs || []) {
  if (item?.reason !== "expired_deadline" || !item?.url || !item?.closeDate) continue;
  presence.expiredDeadlines[item.url] = {
    closeDate: item.closeDate,
    purgedAt: previousPresenceReport.generatedAt || today,
  };
}

// ── 3. Build a Set of today's canonicalJobIds ─────────────────────────────────

const todayIds = new Set(
  todayJobs
    .map((j) => j.canonicalJobId)
    .filter((id) => typeof id === "string" && id.length > 0)
);

// Build a lookup map from canonicalJobId → job object for jobs seen today
// (used later when composing the purged-jobs report)
const todayJobMap = new Map();
for (const job of todayJobs) {
  if (job.canonicalJobId) todayJobMap.set(job.canonicalJobId, job);
}

// ── 4 & 5. Update presence history ───────────────────────────────────────────

for (const id of todayIds) {
  if (presence.jobs[id]) {
    // Already tracked — refresh
    presence.jobs[id].lastSeen = today;
    presence.jobs[id].consecutiveMisses = 0;
  } else {
    // New job — add it
    presence.jobs[id] = {
      firstSeen: today,
      lastSeen:  today,
      consecutiveMisses: 0,
    };
  }
}

for (const id of Object.keys(presence.jobs)) {
  if (!todayIds.has(id)) {
    presence.jobs[id].consecutiveMisses += 1;
  }
}

// ── 6. Identify jobs to purge ─────────────────────────────────────────────────

const missingIds = new Set(
  Object.entries(presence.jobs)
    .filter(([, entry]) => entry.consecutiveMisses >= EXPIRY_DAYS)
    .map(([id]) => id)
);

const deadlinePartition = partitionExpiredJobs(todayJobs, {
  today: new Date(`${today}T12:00:00Z`),
  graceDays: DEADLINE_GRACE_DAYS,
});
const expiredDeadlineJobs = deadlinePartition.expired;
const expiredDeadlineIds = new Set(
  expiredDeadlineJobs.map((job) => job?.canonicalJobId).filter(Boolean)
);
for (const job of expiredDeadlineJobs) {
  if (!job?.url || !job?.closeDate) continue;
  presence.expiredDeadlines[job.url] = { closeDate: job.closeDate, purgedAt: today };
}
const purgedIds = new Set([...missingIds, ...expiredDeadlineIds]);

// Compose purged-jobs detail for the report.
// A purged job may or may not still be in today's scrape (it won't be, by
// definition, since consecutiveMisses only increments when absent), but we
// keep a best-effort lookup from the presence map itself.
const purgedJobs = [...purgedIds].map((id) => {
  // The job won't be in todayJobMap since it was absent; reconstruct from
  // whatever metadata we have stored in the presence record.
  const entry = presence.jobs[id] || {};
  const job = todayJobMap.get(id);
  return {
    canonicalJobId:    id,
    reason: expiredDeadlineIds.has(id) ? "expired_deadline" : "consecutive_misses",
    consecutiveMisses: entry.consecutiveMisses || 0,
    firstSeen:         entry.firstSeen || null,
    lastSeen:          entry.lastSeen || null,
    title: job?.title || null,
    college: job?.college || null,
    closeDate: job?.closeDate || null,
    url: job?.url || null,
  };
});

// ── 7. Remove purged entries from presence history ────────────────────────────

for (const id of purgedIds) {
  delete presence.jobs[id];
}

// ── 8 & 9. Write outputs ──────────────────────────────────────────────────────

const cleanedJobs = deadlinePartition.kept
  .filter((job) => !missingIds.has(job.canonicalJobId))
  .map(repairKnownInstitutionAttribution);
// Stamp each surviving job with firstSeen from the presence ledger so the
// frontend can sort "Most recent" (newest postings first) without a per-job
// posting date from the source.
for (const job of cleanedJobs) {
  const p = presence.jobs[job.canonicalJobId];
  if (p && p.firstSeen) job.firstSeen = p.firstSeen;

  // Persist the same trust guardrails used by the frontend so downstream
  // exports cannot present a future source date or a title/status conflict as
  // authoritative. Ambiguous institution and search-page links remain usable,
  // but are explicitly flagged for review rather than silently "verified."
  const flags = new Set(Array.isArray(job.qualityFlags) ? job.qualityFlags : []);
  const safeDate = sanitizePostingDate(job.datePosted, new Date(`${today}T12:00:00Z`));
  if (job.datePosted && !safeDate) flags.add("posting-date-suppressed");
  job.datePosted = safeDate;
  job.tenureTrack = normalizeTenureTrack(job.tenureTrack, job.titleClean || job.title || "");
  if (institutionTitleConflict(job.titleClean || job.title || "", job.college)) flags.add("institution-title-conflict");
  const linkQuality = classifySourceLink(job.url);
  if (linkQuality !== "direct") flags.add(`${linkQuality}-source-link`);
  if (flags.size) job.qualityFlags = [...flags].sort();
}
const trackedCount  = Object.keys(presence.jobs).length;
const todayCount    = todayIds.size;
const purgedCount   = purgedIds.size;

// ── Console summary ───────────────────────────────────────────────────────────

console.log("\nFaculty Atlas - Job Presence Agent");
console.log(`  Config        : expiry-days=${EXPIRY_DAYS}, deadline-grace-days=${DEADLINE_GRACE_DAYS}`);
if (DRY_RUN) console.log("  *** DRY RUN — no files will be written ***");
console.log("");
console.log(`  Jobs seen today  : ${todayCount.toLocaleString()}`);
console.log(`  Jobs tracked     : ${trackedCount.toLocaleString()}`);
console.log(`  Jobs to purge    : ${purgedCount.toLocaleString()}`);
console.log(`  Expired deadlines: ${expiredDeadlineJobs.length.toLocaleString()}`);

if (purgedCount > 0) {
  console.log("\n  Listings selected for purge:");
  for (const pj of purgedJobs.slice(0, 100)) {
    const detail = pj.reason === "expired_deadline"
      ? `deadline ${pj.closeDate}`
      : `${pj.consecutiveMisses} misses, last seen ${pj.lastSeen}`;
    console.log(`    ${pj.canonicalJobId}  (${pj.reason}: ${detail})`);
  }
  if (purgedJobs.length > 100) console.log(`    … ${purgedJobs.length - 100} more recorded in the JSON report`);
}

// ── Build report ──────────────────────────────────────────────────────────────

presence.lastRunDate = today;

// ── Global "new" counts for the homepage (computed once, same for everyone) ────
// "New" means a consolidated posting was first cataloged by Faculty Atlas,
// not that the institution necessarily posted it on that date. Count canonical
// groups, using the earliest firstSeen in each group, so newly discovered
// duplicates cannot inflate the number.
const weekCutoff = daysAgoDateString(6);
let newToday = 0;
let newThisWeek = 0;
const firstSeenByGroup = new Map();
for (const job of cleanedJobs) {
  const groupId = String(job?.canonicalGroupId || job?.canonicalJobId || job?.url || '').trim();
  const firstSeen = String(job?.firstSeen || '').trim();
  if (!groupId || !firstSeen) continue;
  const existing = firstSeenByGroup.get(groupId);
  if (!existing || firstSeen < existing) firstSeenByGroup.set(groupId, firstSeen);
}
for (const firstSeen of firstSeenByGroup.values()) {
  if (firstSeen === today) newToday += 1;
  if (firstSeen >= weekCutoff) newThisWeek += 1;
}

const catalogSummary = summarizeCatalog(cleanedJobs, new Date(`${today}T12:00:00Z`));

// Institution and state-system counts, so the homepage hero can show them
// instantly from this tiny file instead of waiting for every job chunk to load.
// Mirrors the frontend: distinct college, and distinct (state || source).
const collegeSet = new Set();
const stateSet = new Set();
for (const job of cleanedJobs) {
  const college = String(job?.college || '').trim();
  if (college) collegeSet.add(college);
  const stateSystem = String(job?.state || job?.source || '').trim();
  if (stateSystem) stateSet.add(stateSystem);
}

const siteStats = attachUniversityCoverage({
  generatedAt: new Date().toISOString(),
  scrapeDate: today,
  total: cleanedJobs.length,
  ...catalogSummary,
  uniqueColleges: collegeSet.size,
  stateSystems: stateSet.size,
  newToday,
  newThisWeek,
  newPostingsToday: newToday,
  newPostingsThisWeek: newThisWeek,
  newDefinition: "Consolidated postings first cataloged by Faculty Atlas; not necessarily newly posted by the institution.",
}, readJson(COVERAGE_PATH));

console.log(`  New today        : ${newToday.toLocaleString()}`);
console.log(`  New this week    : ${newThisWeek.toLocaleString()}`);

const report = {
  generatedAt:  new Date().toISOString(),
  trackedCount,
  todayCount,
  purgedCount,
  deadlineGraceDays: DEADLINE_GRACE_DAYS,
  expiredDeadlinePurgedCount: expiredDeadlineJobs.length,
  expiredDeadlineCacheCount: Object.keys(presence.expiredDeadlines).length,
  newToday,
  newThisWeek,
  catalogSummary,
  purgedJobs,
};

if (!DRY_RUN) {
  // Update public/jobs.json
  const updatedPayload = synchronizeJobCount({ ...payload, jobs: cleanedJobs });
  writeJson(PUBLIC_JOBS, updatedPayload);

  // Mirror to docs/ if the file already exists there
  if (fs.existsSync(DOCS_JOBS)) {
    writeJson(DOCS_JOBS, updatedPayload);
    console.log("\n  docs/jobs.json updated.");
  }

  // Persist presence history
  writeJson(PRESENCE_PATH, presence);

  // Persist summary report
  writeJson(REPORT_PATH, report);

  // Persist global site stats into every served data dir (commit step adds
  // docs/data + public/data).
  for (const dir of SITE_STATS_DIRS) {
    if (dir.includes(`${path.sep}docs${path.sep}`) || dir.includes(`${path.sep}public${path.sep}`) || fs.existsSync(dir)) {
      writeJson(path.join(dir, "site-stats.json"), siteStats);
    }
  }

  console.log("\n  public/jobs.json updated.");
  console.log("  generated/job-presence.json saved.");
  console.log("  generated/job-presence-report.json saved.");
  console.log("  data/site-stats.json saved (docs + public + web-vue).");
} else {
  console.log("\n  DRY RUN: no files written.");
  console.log("  Would write: public/jobs.json");
  if (fs.existsSync(DOCS_JOBS)) console.log("  Would write: docs/jobs.json");
  console.log("  Would write: generated/job-presence.json");
  console.log("  Would write: generated/job-presence-report.json");
}
