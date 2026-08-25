#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const COVERAGE_PATH = path.join(ROOT, "generated", "coverage-report.json");
const VALIDATION_PATH = path.join(ROOT, "generated", "ul-system-administration-validation.json");
const REPORT_PATH = path.join(ROOT, "generated", "ul-system-administration-milestone.json");

const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const coverage = JSON.parse(fs.readFileSync(COVERAGE_PATH, "utf8"));
const validation = JSON.parse(fs.readFileSync(VALIDATION_PATH, "utf8"));
const now = validation.generatedAt;
const before = {
  covered: master.institutions.filter((item) => item.coverage_status === "covered").length,
  missing: master.institutions.filter((item) => item.coverage_status === "missing").length,
};
const notes = `Verified live 2026-08-25 from the State of Louisiana board using the exact HED-Bd Supervisors U of LA Sys department filter. The filtered source is healthy and currently reports no openings; unrelated state and campus jobs cannot enter this route.`;
const override = {
  name: validation.name,
  career_url: validation.url,
  platform_type: validation.platformType,
  coverage_source: validation.name,
  notes,
};
const prior = overrides.overrides.find((item) => item.name.toLowerCase() === validation.name.toLowerCase());
if (prior) Object.assign(prior, override);
else overrides.overrides.push(override);

const institution = master.institutions.find((item) => item.name.toLowerCase() === validation.name.toLowerCase());
if (!institution) throw new Error(`Institution missing from master: ${validation.name}`);
institution.career_url = validation.url;
institution.platform_type = validation.platformType;
institution.coverage_source = validation.name;
institution.coverage_status = "covered";
institution.verification_status = "healthy";
institution.last_verified_at = now;
institution.last_seen_job_count = validation.currentFacultyJobCount;
institution.last_discovery_status = "official_exact_department_filter_validated";
institution.last_discovery_confidence = 1;
institution.last_discovery_attempt_at = now;
institution.notes = notes;

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
  scope: "University of Louisiana System Administration exact department control",
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
  appliedCount: 1,
  newlyCoveredCount,
  currentFacultyJobCount: validation.currentFacultyJobCount,
  applied: validation,
  safeguards: [
    "The State of Louisiana board is fixed to one exact UL System Board Office department.",
    "A healthy exact source remains coverage evidence when it has zero current openings.",
    "NationsUniversity remains unresolved because no public employee or volunteer-faculty recruitment source was found.",
    "Existing appointment-track evidence safeguards remain unchanged.",
  ],
};

fs.writeFileSync(OVERRIDES_PATH, `${JSON.stringify(overrides, null, 2)}\n`);
fs.writeFileSync(MASTER_PATH, `${JSON.stringify(master, null, 2)}\n`);
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Applied UL System Administration exact control; ${newlyCoveredCount} newly covered.`);
