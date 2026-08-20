#!/usr/bin/env node
/**
 * agent-alert-issues.js
 *
 * Reads generated report files and opens GitHub Issues for critical conditions
 * using the `gh` CLI. Intended to run at the end of GitHub Actions workflows.
 *
 * Alert conditions:
 *   1. Dead source     — job-url-report.json source with deadPct >= 50 AND checked >= 5
 *   2. Scraper drop    — data-health-report.json sourceDropWarnings entry with dropPct >= 60
 *   3. Live site fail  — live-site-health.json overallStatus === "FAIL" (case-insensitive)
 *   4. Data staleness  — jobs.json generatedAt (or scrapedAt) more than 48 hours old
 *   5. Jetson heartbeat — no "Daily scrape update" commit (the Jetson's own daily-
 *      update.sh signature) in the last 36 hours. Distinct from #4: the Jetson's
 *      systemd service hung for 5 days straight in 2026-07-27 while jobs.json
 *      *looked* fresh the whole time — someone was manually re-triggering the
 *      CI-based scrape.yml every day or two, which genuinely refreshes
 *      jobs.json's scrapedAt and kept closing every staleness alert, while the
 *      actual automated pipeline stayed dead underneath. This check watches the
 *      specific mechanism that failed instead of a proxy any ad-hoc scrape can
 *      satisfy.
 *
 * Usage:
 *   node scripts/agent-alert-issues.js [--dry-run]
 *
 * Options:
 *   --dry-run   Print what issues would be created without calling gh.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { findCoverageRegressions } from "./lib/coverage-health.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── File paths ────────────────────────────────────────────────────────────────

const JOB_URL_REPORT_PATH   = path.join(ROOT, "generated", "job-url-report.json");
const DATA_HEALTH_PATH      = path.join(ROOT, "generated", "data-health-report.json");
const LIVE_SITE_PATH        = path.join(ROOT, "generated", "live-site-health.json");
const COVERAGE_REPORT_PATH  = path.join(ROOT, "generated", "coverage-report.json");
const COVERAGE_THRESHOLDS_PATH = path.join(ROOT, "data", "coverage-alert-thresholds.json");
const JOBS_JSON_PATH        = path.join(ROOT, "public",    "jobs.json");
const ALERT_REPORT_PATH     = path.join(ROOT, "generated", "alert-issues-report.json");

// ── Thresholds ────────────────────────────────────────────────────────────────

const DEAD_PCT_THRESHOLD  = 50;   // % dead job URLs before alerting
const DEAD_MIN_CHECKED    = 5;    // minimum checked URLs required
const DROP_PCT_THRESHOLD  = 60;   // % scraper count drop before alerting
const STALENESS_HOURS     = 48;   // hours before jobs.json is considered stale
const HEARTBEAT_HOURS     = 36;   // hours before a missing "Daily scrape update" commit alerts

// ── CLI args ──────────────────────────────────────────────────────────────────

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

const args   = parseArgs(process.argv.slice(2));
const DRY_RUN = Boolean(args["dry-run"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Run a shell command via execSync and return its stdout as a string.
 * Returns null on error and logs a warning.
 */
function runCommand(cmd, label) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    const msg = err?.stderr?.trim() || err?.message || String(err);
    console.warn(`[WARNING] ${label} failed: ${msg}`);
    return null;
  }
}

// ── gh resolution ─────────────────────────────────────────────────────────────

/**
 * Resolve the `gh` executable. Prefer PATH, but fall back to the known install
 * locations: winget puts gh on the *Machine* PATH, yet a shell (or scheduled
 * task) started before the install won't have picked that up. Don't let a stale
 * PATH silently disable the alerting layer.
 * Returns a command string ready to prefix args, or null if gh isn't found.
 */
function resolveGhCmd() {
  try {
    execSync("gh --version", { stdio: ["pipe", "pipe", "pipe"] });
    return "gh";
  } catch { /* not on PATH — try known locations */ }

  const candidates = [
    "C:\\Program Files\\GitHub CLI\\gh.exe",
    "C:\\Program Files (x86)\\GitHub CLI\\gh.exe",
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "gh.exe")
      : null,
  ].filter(Boolean);

  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    try {
      execSync(`"${c}" --version`, { stdio: ["pipe", "pipe", "pipe"] });
      return `"${c}"`;
    } catch { /* keep looking */ }
  }
  return null;
}

const GH = resolveGhCmd();

// ── gh availability check ────────────────────────────────────────────────────

/**
 * Verify that `gh` is installed and authenticated.
 * Returns true if usable, false otherwise (after printing a warning).
 */
function checkGhAvailable() {
  if (!GH) {
    console.warn("[WARNING] gh CLI is not available. Skipping issue creation.");
    return false;
  }
  try {
    execSync(`${GH} auth status`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    // gh is installed but auth is missing — warn and continue so the
    // script still writes the report and exits 0.
    console.warn("[WARNING] gh is installed but not authenticated. Run: gh auth login");
    return false;
  }
}

// ── Duplicate prevention ─────────────────────────────────────────────────────

/**
 * Fetch all currently open GitHub issues as [{ number, title }].
 * Returns null if the call fails.
 */
function fetchOpenIssues() {
  const raw = runCommand(
    `${GH} issue list --state open --json number,title --limit 500`,
    "gh issue list"
  );
  if (raw === null) return null;
  try {
    const issues = JSON.parse(raw);
    return issues.map((i) => ({ number: i.number, title: i.title }));
  } catch {
    console.warn("[WARNING] Could not parse gh issue list output.");
    return null;
  }
}

/**
 * Close an open issue with a resolution comment. Returns true on success.
 */
function closeIssue(number, comment) {
  const result = runCommand(
    `${GH} issue close ${number} --comment "${comment.replace(/"/g, '\\"')}"`,
    `gh issue close: #${number}`
  );
  return result !== null;
}

/**
 * Normalize a title for duplicate detection by stripping volatile numbers
 * (percentages, counts). So "CSU dropped 77.9% from baseline" and "CSU dropped
 * 81.6% from baseline" collapse to the same key — yielding ONE open issue per
 * source+condition instead of a fresh duplicate every run.
 */
function dedupeKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[\d.,]+\s*%?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Issue creation ────────────────────────────────────────────────────────────

/**
 * Create a single GitHub Issue via gh CLI.
 * Returns true on success, false on failure.
 */
function createIssue(title, body) {
  // Write body to a temp file to avoid shell quoting issues with arbitrary
  // markdown content.
  const tmpPath = path.join(ROOT, "generated", ".alert-issue-body.tmp.md");
  try {
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, body, "utf8");

    // Use --body-file so the body is read from disk — no shell escaping needed.
    const safeTitle = title.replace(/"/g, '\\"');
    const result = runCommand(
      `${GH} issue create --title "${safeTitle}" --body-file "${tmpPath}"`,
      `gh issue create: ${title}`
    );
    return result !== null;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

// ── Alert condition checks ────────────────────────────────────────────────────

/**
 * Condition 1: Dead source alert.
 * Looks for entries in job-url-report.json sourceWarnings where
 * deadPct >= DEAD_PCT_THRESHOLD AND checked >= DEAD_MIN_CHECKED.
 */
function checkDeadSources() {
  const alerts = [];
  const report = readJson(JOB_URL_REPORT_PATH);

  if (!report) {
    console.log(`  [SKIP] job-url-report.json not found or unreadable.`);
    return alerts;
  }

  const warnings = Array.isArray(report.sourceWarnings) ? report.sourceWarnings : [];

  for (const entry of warnings) {
    const { source, deadPct, checked } = entry;
    if (
      typeof deadPct === "number" && deadPct >= DEAD_PCT_THRESHOLD &&
      typeof checked === "number" && checked >= DEAD_MIN_CHECKED
    ) {
      const title = `\uD83D\uDD34 Dead URL alert: ${source} has ${deadPct}% dead job postings`;
      const body = [
        `## Dead URL Alert`,
        ``,
        `**Source:** \`${source}\``,
        `**Dead percentage:** ${deadPct}%`,
        `**URLs checked:** ${checked}`,
        `**Dead URLs:** ${entry.dead ?? "N/A"}`,
        ``,
        `### What triggered this alert`,
        `${deadPct}% of sampled job posting URLs from source **${source}** returned dead/unreachable responses, ` +
          `exceeding the ${DEAD_PCT_THRESHOLD}% threshold (with a minimum of ${DEAD_MIN_CHECKED} URLs checked).`,
        ``,
        `### Source file`,
        `\`generated/job-url-report.json\` → \`sourceWarnings\``,
        ``,
        `### Timestamp`,
        `${nowIso()}`,
        ``,
        `---`,
        `_This issue was automatically created by agent-alert-issues.js_`,
      ].join("\n");
      alerts.push({ title, body, source: "job-url-report.json", detail: entry });
    }
  }

  return alerts;
}

/**
 * Condition 2: Scraper health drop alert.
 * Looks for entries in data-health-report.json sourceDropWarnings where
 * dropPct >= DROP_PCT_THRESHOLD.
 */
function checkScraperHealthDrops() {
  const alerts = [];
  const report = readJson(DATA_HEALTH_PATH);

  if (!report) {
    console.log(`  [SKIP] data-health-report.json not found or unreadable.`);
    return alerts;
  }

  const warnings = Array.isArray(report.sourceDropWarnings) ? report.sourceDropWarnings : [];

  for (const entry of warnings) {
    const { source, dropPct } = entry;
    if (typeof dropPct === "number" && dropPct >= DROP_PCT_THRESHOLD) {
      const title = `\uD83D\uDD34 Scraper health drop: ${source} dropped ${dropPct}% from baseline`;
      const body = [
        `## Scraper Health Drop Alert`,
        ``,
        `**Source:** \`${source}\``,
        `**Drop percentage:** ${dropPct}%`,
        `**Baseline count:** ${entry.baseline ?? "N/A"}`,
        `**Current count:** ${entry.current ?? "N/A"}`,
        ``,
        `### What triggered this alert`,
        `The job count for source **${source}** dropped by ${dropPct}% compared to its rolling baseline, ` +
          `exceeding the ${DROP_PCT_THRESHOLD}% alert threshold.`,
        ``,
        `### Source file`,
        `\`generated/data-health-report.json\` → \`sourceDropWarnings\``,
        ``,
        `### Timestamp`,
        `${nowIso()}`,
        ``,
        `---`,
        `_This issue was automatically created by agent-alert-issues.js_`,
      ].join("\n");
      alerts.push({ title, body, source: "data-health-report.json", detail: entry });
    }
  }

  return alerts;
}

/**
 * Condition 3: Live site fail alert.
 * Fires when live-site-health.json overallStatus is "FAIL" (case-insensitive).
 * The spec refers to the field as "overall"; the actual file uses "overallStatus".
 * Both are checked to be forward-compatible.
 */
function checkLiveSite() {
  const alerts = [];
  const report = readJson(LIVE_SITE_PATH);

  if (!report) {
    console.log(`  [SKIP] live-site-health.json not found or unreadable.`);
    return alerts;
  }

  // Support both field names.
  const statusRaw = report.overallStatus ?? report.overall ?? null;
  const status = typeof statusRaw === "string" ? statusRaw.toUpperCase() : null;

  if (status === "FAIL") {
    const failedChecks = Array.isArray(report.checks)
      ? report.checks.filter((c) => c.status === "FAIL").map((c) => `- **${c.name}**: ${c.detail || ""}`)
      : [];

    const title = `\uD83D\uDD34 Live site monitor: site health check failed`;
    const body = [
      `## Live Site Health Check Failed`,
      ``,
      `**Base URL:** ${report.baseUrl || "N/A"}`,
      `**Checked at:** ${report.checkedAt || "N/A"}`,
      `**Overall status:** ${statusRaw}`,
      ``,
      ...(failedChecks.length > 0
        ? [`### Failed checks`, ``, ...failedChecks, ``]
        : []),
      `### What triggered this alert`,
      `The live site health monitor reported an overall status of FAIL, indicating one or more critical ` +
        `checks did not pass for the GitHub Pages deployment.`,
      ``,
      `### Source file`,
      `\`generated/live-site-health.json\``,
      ``,
      `### Timestamp`,
      `${nowIso()}`,
      ``,
      `---`,
      `_This issue was automatically created by agent-alert-issues.js_`,
    ].join("\n");

    alerts.push({ title, body, source: "live-site-health.json", detail: { status: statusRaw } });
  }

  return alerts;
}

/**
 * Condition 4: Data staleness alert.
 * Fires when jobs.json generatedAt (or scrapedAt as fallback) is more than
 * STALENESS_HOURS hours old.
 */
function checkDataStaleness() {
  const alerts = [];
  const jobs = readJson(JOBS_JSON_PATH);

  if (!jobs) {
    console.log(`  [SKIP] public/jobs.json not found or unreadable.`);
    return alerts;
  }

  // Prefer generatedAt (as specified), fall back to scrapedAt (the actual field in use).
  const dateStr = jobs.generatedAt ?? jobs.scrapedAt ?? null;

  if (!dateStr) {
    console.log(`  [SKIP] jobs.json has no generatedAt or scrapedAt field.`);
    return alerts;
  }

  const jobsDate = new Date(dateStr);
  if (isNaN(jobsDate.getTime())) {
    console.log(`  [SKIP] jobs.json date field "${dateStr}" is not a valid ISO date.`);
    return alerts;
  }

  const ageMs    = Date.now() - jobsDate.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours >= STALENESS_HOURS) {
    const ageDays = (ageHours / 24).toFixed(1);
    const title = `\uD83D\uDD34 Data staleness: jobs.json not updated in 48+ hours`;
    const body = [
      `## Data Staleness Alert`,
      ``,
      `**Last updated:** ${dateStr}`,
      `**Age:** ~${ageDays} days (${Math.round(ageHours)} hours)`,
      `**Threshold:** ${STALENESS_HOURS} hours`,
      ``,
      `### What triggered this alert`,
      `\`jobs.json\` has not been updated for ${Math.round(ageHours)} hours, exceeding the ${STALENESS_HOURS}-hour ` +
        `staleness threshold. This may indicate the daily scrape workflow has not run or has failed.`,
      ``,
      `### Source file`,
      `\`public/jobs.json\` (field: \`${jobs.generatedAt !== undefined ? "generatedAt" : "scrapedAt"}\`)`,
      ``,
      `### Timestamp`,
      `${nowIso()}`,
      ``,
      `---`,
      `_This issue was automatically created by agent-alert-issues.js_`,
    ].join("\n");

    alerts.push({
      title,
      body,
      source: "public/jobs.json",
      detail: { dateField: jobs.generatedAt !== undefined ? "generatedAt" : "scrapedAt", dateValue: dateStr, ageHours: Math.round(ageHours) },
    });
  }

  return alerts;
}

/**
 * Alert when no commit matching the Jetson's own "Daily scrape update"
 * message has landed within HEARTBEAT_HOURS. Deliberately independent of
 * jobs.json's own scrapedAt field (see the file-level doc comment) — this
 * reads git history directly so a manual scrape.yml run elsewhere can't mask
 * the specific automated pipeline being down.
 */
function checkJetsonHeartbeat() {
  const alerts = [];

  // %cI = committer date, strict ISO 8601 — stable to parse regardless of the
  // runner's locale/timezone. Requires the workflow's checkout to have enough
  // history to contain the last real commit; too-shallow a clone looks
  // identical to "no commit found" here, so this intentionally does NOT alert
  // when the log is empty — that's a workflow config problem, not a pipeline
  // outage, and a false "down" alert would be worse than staying silent until
  // the checkout is fixed.
  const out = runCommand(
    `git log -1 --grep="^Daily scrape update" --format=%cI`,
    "git log (Jetson heartbeat)"
  );
  const dateStr = out ? out.trim() : "";
  if (!dateStr) {
    console.log(`  [SKIP] No "Daily scrape update" commit found in the fetched git history.`);
    return alerts;
  }

  const commitDate = new Date(dateStr);
  if (isNaN(commitDate.getTime())) {
    console.log(`  [SKIP] Could not parse commit date "${dateStr}".`);
    return alerts;
  }

  const ageHours = (Date.now() - commitDate.getTime()) / (1000 * 60 * 60);

  if (ageHours >= HEARTBEAT_HOURS) {
    const ageDays = (ageHours / 24).toFixed(1);
    const title = `🔴 Jetson heartbeat: no daily scrape commit in 36+ hours`;
    const body = [
      `## Jetson Heartbeat Alert`,
      ``,
      `**Last "Daily scrape update" commit:** ${dateStr}`,
      `**Age:** ~${ageDays} days (${Math.round(ageHours)} hours)`,
      `**Threshold:** ${HEARTBEAT_HOURS} hours`,
      ``,
      `### What triggered this alert`,
      `No commit matching the Jetson's own daily-update.sh signature ("Daily scrape update <date>") has landed in ${Math.round(ageHours)} hours. ` +
        `This check is independent of the "Data staleness" alert on purpose: jobs.json can look fresh from a manually-triggered CI scrape ` +
        `(scrape.yml) while the actual unattended pipeline on the Jetson is down — that happened for 5 days straight starting 2026-07-27, ` +
        `undetected because a manual scrape kept resetting the staleness clock underneath it.`,
      ``,
      `### Likely causes`,
      `- The systemd service is stuck (check \`systemctl status faculty-atlas-daily-update.service\` on the Jetson — a service stuck ` +
        `"activating" for a long time blocks every subsequent scheduled trigger)`,
      `- The Jetson is powered off, offline, or lost network connectivity`,
      `- \`daily-update.sh\` is erroring before it reaches the commit/push step`,
      ``,
      `### Timestamp`,
      `${nowIso()}`,
      ``,
      `---`,
      `_This issue was automatically created by agent-alert-issues.js_`,
    ].join("\n");

    alerts.push({
      title,
      body,
      source: "git log",
      detail: { lastCommitDate: dateStr, ageHours: Math.round(ageHours) },
    });
  }

  return alerts;
}

/** Alert whenever the eligible universe is no longer fully classified. */
function checkCoverageRegression() {
  const alerts = [];
  const report = readJson(COVERAGE_REPORT_PATH);
  if (!report) {
    console.log(`  [SKIP] coverage-report.json not found or unreadable.`);
    return alerts;
  }

  const configured = readJson(COVERAGE_THRESHOLDS_PATH) || {};
  const thresholds = {
    maxMissing: Number.isFinite(Number(configured.maxMissing)) ? Number(configured.maxMissing) : 0,
    maxPending: Number.isFinite(Number(configured.maxPending)) ? Number(configured.maxPending) : 0,
  };

  for (const issue of findCoverageRegressions(report, thresholds)) {
    const label = issue.kind === "missing" ? "missing" : "pending review";
    const title = `🔴 Coverage regression: ${issue.actual} institutions ${label}`;
    const body = [
      `## Institution Coverage Regression`,
      ``,
      `**Condition:** ${label}`,
      `**Current count:** ${issue.actual}`,
      `**Expected maximum:** ${issue.allowed}`,
      `**Eligible universe:** ${report?.totals?.eligible_universe ?? "N/A"}`,
      ``,
      `The generated coverage report exceeded the accepted backlog watermark in \`data/coverage-alert-thresholds.json\`. This may be a newly added IPEDS institution or a lost scraper source; review the affected institution records before changing the threshold.`,
      ``,
      `Source: \`generated/coverage-report.json\``,
      ``,
      `_This issue was automatically created by agent-alert-issues.js_`,
    ].join("\n");
    alerts.push({ title, body, source: "coverage-report.json", detail: issue });
  }
  return alerts;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nFaculty Atlas - Alert Issues Agent");
  if (DRY_RUN) console.log("  *** DRY RUN — no gh calls will be made ***\n");

  // ── Gather all candidate alerts ───────────────────────────────────────────

  console.log("Checking alert conditions...");

  const candidates = [
    ...checkDeadSources(),
    ...checkScraperHealthDrops(),
    ...checkLiveSite(),
    ...checkDataStaleness(),
    ...checkJetsonHeartbeat(),
    ...checkCoverageRegression(),
  ];

  console.log(`\n  Candidate alerts found: ${candidates.length}`);

  // ── Build report skeleton ─────────────────────────────────────────────────

  const report = {
    generatedAt: nowIso(),
    dryRun: DRY_RUN,
    conditionsChecked: [
      "Dead source (job-url-report.json sourceWarnings, deadPct >= 50, checked >= 5)",
      "Scraper health drop (data-health-report.json sourceDropWarnings, dropPct >= 60)",
      `Live site fail (live-site-health.json overallStatus === "FAIL")`,
      "Data staleness (public/jobs.json generatedAt/scrapedAt > 48 hours old)",
      `Jetson heartbeat (no "Daily scrape update" commit in > ${HEARTBEAT_HOURS} hours)`,
      "Coverage regression (missing or pending-review institutions above accepted watermark)",
    ],
    candidatesFound: candidates.length,
    issuesSkipped: [],
    issuesCreated: [],
    errors: [],
  };

  if (candidates.length === 0) {
    console.log("\n  No alert conditions triggered. Nothing to do.");
    writeJson(ALERT_REPORT_PATH, report);
    console.log(`\n  Report saved: generated/alert-issues-report.json\n`);
    return;
  }

  // ── Dry-run mode ──────────────────────────────────────────────────────────

  if (DRY_RUN) {
    console.log("\n  Issues that WOULD be created:");
    for (const c of candidates) {
      console.log(`\n    Title : ${c.title}`);
      console.log(`    Source: ${c.source}`);
    }
    for (const c of candidates) {
      report.issuesCreated.push({
        title: c.title,
        source: c.source,
        detail: c.detail,
        dryRun: true,
      });
    }
    writeJson(ALERT_REPORT_PATH, report);
    console.log(`\n  [DRY RUN] Report saved: generated/alert-issues-report.json\n`);
    return;
  }

  // ── Check gh availability ────────────────────────────────────────────────

  const ghAvailable = checkGhAvailable();

  if (!ghAvailable) {
    console.warn("\n  gh CLI unavailable or unauthenticated. Saving report without creating issues.");
    for (const c of candidates) {
      report.errors.push({ title: c.title, reason: "gh not available or not authenticated" });
    }
    writeJson(ALERT_REPORT_PATH, report);
    console.log(`  Report saved: generated/alert-issues-report.json\n`);
    process.exit(0);
  }

  // ── Fetch open issue titles for duplicate prevention ──────────────────────

  console.log("\n  Fetching open GitHub issues for duplicate check...");
  const openIssues = fetchOpenIssues();

  if (openIssues === null) {
    console.warn("  Could not retrieve open issues. Aborting to avoid creating duplicates.");
    report.errors.push({ reason: "Could not fetch open issue list from gh" });
    writeJson(ALERT_REPORT_PATH, report);
    console.log(`  Report saved: generated/alert-issues-report.json\n`);
    process.exit(0);
  }

  console.log(`  Open issues fetched: ${openIssues.length}`);

  // Match by normalized key (source + condition), not exact title, so a recurring
  // problem with a changing percentage doesn't spawn a new issue every run.
  const openKeys = new Set(openIssues.map((i) => dedupeKey(i.title)));

  // ── Create new issues ─────────────────────────────────────────────────────

  console.log("\n  Processing candidates...");

  for (const candidate of candidates) {
    const { title, body, source, detail } = candidate;
    const key = dedupeKey(title);

    if (openKeys.has(key)) {
      console.log(`  [SKIP] Already open (same source/condition): "${title}"`);
      report.issuesSkipped.push({ title, source, reason: "Open issue already exists for this source/condition" });
      continue;
    }

    console.log(`  [CREATE] ${title}`);
    const ok = createIssue(title, body);

    if (ok) {
      console.log(`    Created successfully.`);
      openKeys.add(key); // prevent a second create for the same key within this run
      report.issuesCreated.push({ title, source, detail, createdAt: nowIso() });
    } else {
      console.warn(`    Failed to create issue.`);
      report.errors.push({ title, source, reason: "gh issue create returned non-zero" });
    }
  }

  // ── Auto-close resolved alerts ────────────────────────────────────────────
  // Any open agent alert (title starts with the 🔴 marker) whose source/condition
  // is no longer firing this run has recovered — close it so the issue list
  // reflects only current problems (e.g. a source that bounced back above baseline).
  const currentKeys = new Set(candidates.map((c) => dedupeKey(c.title)));
  report.issuesClosed = [];
  for (const issue of openIssues) {
    if (!/^🔴/.test(issue.title)) continue; // only our 🔴 alert issues
    if (currentKeys.has(dedupeKey(issue.title))) continue; // still firing — keep open
    console.log(`  [CLOSE] resolved: "${issue.title}" (#${issue.number})`);
    if (closeIssue(issue.number, "Auto-closed by agent-alert-issues: condition no longer firing (source recovered).")) {
      report.issuesClosed.push({ number: issue.number, title: issue.title });
    } else {
      report.errors.push({ title: issue.title, reason: "gh issue close returned non-zero" });
    }
  }

  // ── Write final report ────────────────────────────────────────────────────

  writeJson(ALERT_REPORT_PATH, report);

  console.log("\n  Summary:");
  console.log(`    Candidates  : ${candidates.length}`);
  console.log(`    Created     : ${report.issuesCreated.length}`);
  console.log(`    Skipped     : ${report.issuesSkipped.length}`);
  console.log(`    Closed      : ${report.issuesClosed.length}`);
  console.log(`    Errors      : ${report.errors.length}`);
  console.log(`\n  Report saved: generated/alert-issues-report.json\n`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(0); // exit 0 to not fail the workflow
});
