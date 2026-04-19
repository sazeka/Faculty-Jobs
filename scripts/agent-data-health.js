#!/usr/bin/env node
/**
 * agent-data-health.js
 *
 * Backend data-health agent. Runs after verify-job-urls.js and:
 *   1. Removes confirmed-dead job URLs from public/jobs.json (and docs/jobs.json).
 *   2. Compares per-source job counts to a rolling baseline; flags anomalous drops.
 *   3. Strips raw HTML tags from job title fields.
 *   4. Writes a health report to generated/data-health-report.json.
 *
 * Usage:
 *   node scripts/agent-data-health.js [--dry-run] [--drop-threshold <pct>]
 *
 * Options:
 *   --dry-run              Print what would change without modifying files.
 *   --drop-threshold <n>   % drop from baseline that triggers a warning (default 40).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PUBLIC_JOBS   = path.join(ROOT, "public", "jobs.json");
const DOCS_JOBS     = path.join(ROOT, "docs",   "jobs.json");
const DEAD_LIST     = path.join(ROOT, "generated", "job-url-dead.json");
const BASELINE_PATH = path.join(ROOT, "generated", "source-count-baseline.json");
const REPORT_PATH   = path.join(ROOT, "generated", "data-health-report.json");

// ── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

const args           = parseArgs(process.argv.slice(2));
const DRY_RUN        = Boolean(args["dry-run"]);
const DROP_THRESHOLD = Math.max(5, Number(args["drop-threshold"] || 40));

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function stripHtml(str) {
  return String(str || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ── 1. Load inputs ────────────────────────────────────────────────────────────

const payload = readJson(PUBLIC_JOBS);
if (!payload || !Array.isArray(payload.jobs)) {
  console.error("Could not load public/jobs.json");
  process.exit(1);
}

const deadPayload = readJson(DEAD_LIST);
const deadUrls    = new Set((deadPayload?.jobs || []).map((j) => j.url));

const baseline = readJson(BASELINE_PATH) || {};

console.log("\nFaculty Atlas - Data Health Agent");
console.log(`  Jobs loaded   : ${payload.jobs.length.toLocaleString()}`);
console.log(`  Dead URLs     : ${deadUrls.size}`);
if (DRY_RUN) console.log("  *** DRY RUN ***\n");

// ── 2. Per-source counts before changes ──────────────────────────────────────

const beforeCounts = new Map();
for (const job of payload.jobs) {
  const src = String(job.source || "Unknown");
  beforeCounts.set(src, (beforeCounts.get(src) || 0) + 1);
}

// ── 3. Remove dead URLs + strip HTML from titles ──────────────────────────────

let removedCount  = 0;
let htmlFixed     = 0;

const cleanedJobs = [];
for (const job of payload.jobs) {
  if (deadUrls.has(job.url)) {
    removedCount++;
    continue;
  }
  const cleanTitle = stripHtml(job.title);
  if (cleanTitle !== String(job.title || "")) {
    htmlFixed++;
    cleanedJobs.push({ ...job, title: cleanTitle });
  } else {
    cleanedJobs.push(job);
  }
}

console.log(`\n  Dead listings removed : ${removedCount}`);
console.log(`  HTML titles cleaned   : ${htmlFixed}`);

// ── 4. Compare per-source counts to baseline ─────────────────────────────────

const afterCounts = new Map();
for (const job of cleanedJobs) {
  const src = String(job.source || "Unknown");
  afterCounts.set(src, (afterCounts.get(src) || 0) + 1);
}

const drops = [];
for (const [src, before] of beforeCounts) {
  const base = baseline[src];
  if (!base || base < 10) continue; // too small to be meaningful
  const after    = afterCounts.get(src) || 0;
  const dropPct  = ((base - after) / base) * 100;
  if (dropPct >= DROP_THRESHOLD) {
    drops.push({ source: src, baseline: base, current: after, dropPct: Number(dropPct.toFixed(1)) });
  }
}
drops.sort((a, b) => b.dropPct - a.dropPct);

if (drops.length > 0) {
  console.log(`\n  Sources with >=${DROP_THRESHOLD}% drop from baseline:`);
  for (const d of drops) {
    console.log(`    ${d.source}: ${d.current} (was ${d.baseline}, -${d.dropPct}%)`);
  }
} else {
  console.log("  No anomalous source drops detected.");
}

// ── 5. Update baseline with today's counts ───────────────────────────────────

const newBaseline = { ...baseline };
for (const [src, count] of afterCounts) {
  // Exponential moving average (alpha=0.2) so brief drops don't skew baseline
  const prev = newBaseline[src];
  newBaseline[src] = prev ? Math.round(prev * 0.8 + count * 0.2) : count;
}

// ── 6. Write outputs (unless dry-run) ────────────────────────────────────────

const report = {
  generatedAt: new Date().toISOString(),
  config: { dropThreshold: DROP_THRESHOLD },
  removedDeadCount: removedCount,
  htmlTitlesFixed: htmlFixed,
  sourceDropWarnings: drops,
  sourceCounts: Object.fromEntries([...afterCounts.entries()].sort()),
};

if (!DRY_RUN) {
  if (removedCount > 0 || htmlFixed > 0) {
    const updated = { ...payload, jobs: cleanedJobs };
    writeJson(PUBLIC_JOBS, updated);
    // Mirror to docs/ if it exists
    if (fs.existsSync(DOCS_JOBS)) writeJson(DOCS_JOBS, updated);
    console.log("\n  public/jobs.json updated.");
  } else {
    console.log("\n  No changes needed in jobs.json.");
  }
  writeJson(BASELINE_PATH, newBaseline);
  writeJson(REPORT_PATH, report);
  console.log(`  Baseline saved : generated/source-count-baseline.json`);
  console.log(`  Report saved   : generated/data-health-report.json`);
} else {
  console.log("\n  DRY RUN: no files written.");
  if (removedCount > 0) {
    console.log("  Would remove dead URLs:");
    for (const j of deadPayload.jobs.slice(0, 10)) {
      console.log(`    [${j.status}] ${j.college} - ${j.title?.slice(0, 60)}`);
    }
  }
}

console.log("");
