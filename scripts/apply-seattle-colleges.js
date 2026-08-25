#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const COVERAGE_PATH = path.join(ROOT, "generated", "coverage-report.json");
const VALIDATION_PATH = path.join(ROOT, "generated", "seattle-colleges-validation.json");
const REPORT_PATH = path.join(ROOT, "generated", "seattle-colleges-milestone.json");
const SOURCE = "Seattle Colleges";
const CAREER_URL = "https://hcprd.ctclink.us/psc/tam/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?FOCUS=Applicant&SiteId=060";
const NAMES = [
  "North Seattle College",
  "Seattle Central College",
  "South Seattle College",
];

const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const coverage = JSON.parse(fs.readFileSync(COVERAGE_PATH, "utf8"));
const validation = JSON.parse(fs.readFileSync(VALIDATION_PATH, "utf8"));
const now = validation.generatedAt;
const overrideMap = new Map((overrides.overrides || []).map((item) => [item.name.toLowerCase(), item]));
const institutionMap = new Map((master.institutions || []).map((item) => [item.name.toLowerCase(), item]));
const validationMap = new Map((validation.results || []).map((item) => [item.name.toLowerCase(), item]));
const before = {
  covered: master.institutions.filter((item) => item.coverage_status === "covered").length,
  missing: master.institutions.filter((item) => item.coverage_status === "missing").length,
};

for (const name of NAMES) {
  const count = Number(validationMap.get(name.toLowerCase())?.currentFacultyJobCount || 0);
  const notes = `Verified live 2026-08-25 from Seattle Colleges' official Careers page: district-scoped ctcLink SiteId=060. The board is scraped once and jobs are assigned only when Location or title explicitly identifies ${name}; ambiguous districtwide rows fail closed. Current qualifying faculty jobs: ${count}.`;
  const override = {
    name,
    career_url: CAREER_URL,
    platform_type: "seattle-colleges-district",
    coverage_source: SOURCE,
    notes,
  };
  const prior = overrideMap.get(name.toLowerCase());
  if (prior) Object.assign(prior, override);
  else overrides.overrides.push(override);

  const institution = institutionMap.get(name.toLowerCase());
  if (!institution) throw new Error(`Institution missing from master: ${name}`);
  institution.career_url = CAREER_URL;
  institution.platform_type = "seattle-colleges-district";
  institution.coverage_source = SOURCE;
  institution.coverage_status = "covered";
  institution.verification_status = "healthy";
  institution.last_verified_at = now;
  institution.last_seen_job_count = count;
  institution.last_discovery_status = "official_shared_board_location_split_validated";
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
  scope: "Three Seattle Colleges institutions on one official district board",
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
  appliedCount: NAMES.length,
  newlyCoveredCount,
  currentFacultyJobCount: validation.mappedFacultyJobCount,
  ambiguousQualifyingJobCount: validation.ambiguousQualifyingJobCount,
  applied: NAMES.map((name) => ({
    name,
    platform_type: "seattle-colleges-district",
    career_url: CAREER_URL,
    currentFacultyJobCount: validationMap.get(name.toLowerCase())?.currentFacultyJobCount || 0,
  })),
  safeguards: [
    "The district board is fetched once, avoiding redundant scans and duplicate job URLs.",
    "Only explicit campus evidence in Location or title assigns a job to North, Central, or South.",
    "Ambiguous Multiple or districtwide rows fail closed instead of being guessed onto a college.",
    "Existing non-adjunct and tenure-classification evidence safeguards remain unchanged.",
  ],
};

fs.writeFileSync(OVERRIDES_PATH, `${JSON.stringify(overrides, null, 2)}\n`);
fs.writeFileSync(MASTER_PATH, `${JSON.stringify(master, null, 2)}\n`);
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Applied ${NAMES.length} Seattle Colleges controls; ${newlyCoveredCount} newly covered.`);
