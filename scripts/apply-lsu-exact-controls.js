#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const COVERAGE_PATH = path.join(ROOT, "generated", "coverage-report.json");
const VALIDATION_PATH = path.join(ROOT, "generated", "lsu-exact-controls-validation.json");
const REPORT_PATH = path.join(ROOT, "generated", "lsu-exact-controls-milestone.json");

const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const coverage = JSON.parse(fs.readFileSync(COVERAGE_PATH, "utf8"));
const validation = JSON.parse(fs.readFileSync(VALIDATION_PATH, "utf8"));
const now = validation.generatedAt;
const overrideMap = new Map((overrides.overrides || []).map((item) => [item.name.toLowerCase(), item]));
const institutionMap = new Map((master.institutions || []).map((item) => [item.name.toLowerCase(), item]));
const before = {
  covered: master.institutions.filter((item) => item.coverage_status === "covered").length,
  missing: master.institutions.filter((item) => item.coverage_status === "missing").length,
};

for (const control of validation.results) {
  const scope = control.platformType === "pageup"
    ? "the dedicated LSU Health New Orleans PageUp board with both faculty filters"
    : "the shared LSU Workday tenant with exact Alexandria hiring-company, faculty, and full-time facets";
  const notes = `Verified live 2026-08-25 from ${scope}. Production validation found ${control.currentFacultyJobCount} current faculty jobs and no rows outside the institution-owned host.`;
  const override = {
    name: control.name,
    career_url: control.url,
    platform_type: control.platformType,
    coverage_source: control.name,
    notes,
  };
  const prior = overrideMap.get(control.name.toLowerCase());
  if (prior) Object.assign(prior, override);
  else overrides.overrides.push(override);

  const institution = institutionMap.get(control.name.toLowerCase());
  if (!institution) throw new Error(`Institution missing from master: ${control.name}`);
  institution.career_url = control.url;
  institution.platform_type = control.platformType;
  institution.coverage_source = control.name;
  institution.coverage_status = "covered";
  institution.verification_status = "healthy";
  institution.last_verified_at = now;
  institution.last_seen_job_count = control.currentFacultyJobCount;
  institution.last_discovery_status = "official_exact_facets_validated";
  institution.last_discovery_confidence = 1;
  institution.last_discovery_attempt_at = now;
  institution.notes = notes;
}

const after = {
  covered: master.institutions.filter((item) => item.coverage_status === "covered").length,
  missing: master.institutions.filter((item) => item.coverage_status === "missing").length,
};
const newlyCoveredCount = after.covered - before.covered;
overrides.updatedAt = now;
master.generatedAt = now;
master.counts.covered = after.covered;
master.counts.missing = after.missing;

const baseline = coverage.totals;
const resultCovered = baseline.covered + newlyCoveredCount;
const resultMissing = baseline.missing - newlyCoveredCount;
const report = {
  generatedAt: now,
  scope: "LSU Alexandria and LSU Health New Orleans exact faculty controls",
  baseline: {
    eligibleUniverse: baseline.eligible_universe,
    covered: baseline.covered,
    missing: baseline.missing,
    excludedPolicy: baseline.excluded_policy,
    pendingReview: baseline.pending_review,
    coveragePercent: Number(((baseline.covered / baseline.eligible_universe) * 100).toFixed(2)),
  },
  result: {
    eligibleUniverse: baseline.eligible_universe,
    covered: resultCovered,
    missing: resultMissing,
    excludedPolicy: baseline.excluded_policy,
    pendingReview: baseline.pending_review,
    coveragePercent: Number(((resultCovered / baseline.eligible_universe) * 100).toFixed(2)),
  },
  appliedCount: validation.results.length,
  newlyCoveredCount,
  currentFacultyJobCount: validation.currentFacultyJobCount,
  applied: validation.results,
  safeguards: [
    "Alexandria requires exact hiring-company, Faculty, and Full time Workday facets.",
    "Required Workday facets fail closed instead of falling back to an unscoped browser scrape.",
    "LSU Health uses a dedicated official PageUp host with both Category and Employment Type fixed to Faculty.",
    "Existing appointment-track evidence safeguards remain unchanged.",
  ],
};

fs.writeFileSync(OVERRIDES_PATH, `${JSON.stringify(overrides, null, 2)}\n`);
fs.writeFileSync(MASTER_PATH, `${JSON.stringify(master, null, 2)}\n`);
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Applied ${validation.results.length} LSU exact controls; ${newlyCoveredCount} newly covered.`);
