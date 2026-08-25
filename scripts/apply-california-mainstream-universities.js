#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(value, null, 2)}\n`);
const overrides = read("data/career-url-overrides.json");
const master = read("data/institutions-master.json");
const coverage = read("generated/coverage-report.json");
const validation = read("generated/california-mainstream-universities-validation.json");
const overrideMap = new Map(overrides.overrides.map((row) => [row.name.toLowerCase(), row]));
const institutionMap = new Map(master.institutions.map((row) => [row.name.toLowerCase(), row]));
const coveredBefore = master.institutions.filter((row) => row.coverage_status === "covered").length;

for (const control of validation.results) {
  if (!control.healthySource || control.currentFacultyJobCount < 1 || control.invalidJobCount) {
    throw new Error(`Invalid live evidence for ${control.name}`);
  }
  const notes = `Verified live 2026-08-25 through the faculty-filtered hiring path linked by the institution. Production validation found ${control.currentFacultyJobCount} current faculty jobs. Staff and unscoped shared-system postings remain excluded.`;
  const replacement = {
    name: control.name,
    career_url: control.url,
    platform_type: control.platformType,
    coverage_source: control.name,
    notes,
  };
  const prior = overrideMap.get(control.name.toLowerCase());
  if (prior) Object.assign(prior, replacement);
  else overrides.overrides.push(replacement);
  const institution = institutionMap.get(control.name.toLowerCase());
  if (!institution) throw new Error(`Institution missing from master: ${control.name}`);
  Object.assign(institution, {
    career_url: control.url,
    platform_type: control.platformType,
    coverage_source: control.name,
    coverage_status: "covered",
    verification_status: "healthy",
    last_verified_at: validation.generatedAt,
    last_seen_job_count: control.currentFacultyJobCount,
    last_discovery_status: "official_faculty_filtered_hiring_path_validated",
    last_discovery_confidence: 1,
    last_discovery_attempt_at: validation.generatedAt,
    notes,
  });
}

const coveredAfter = master.institutions.filter((row) => row.coverage_status === "covered").length;
const missingAfter = master.institutions.filter((row) => row.coverage_status === "missing").length;
const newlyCoveredCount = coveredAfter - coveredBefore;
overrides.updatedAt = validation.generatedAt;
master.generatedAt = validation.generatedAt;
master.counts.covered = coveredAfter;
master.counts.missing = missingAfter;
write("data/career-url-overrides.json", overrides);
write("data/institutions-master.json", master);
write("generated/california-mainstream-universities-milestone.json", {
  generatedAt: validation.generatedAt,
  scope: "Two established California universities with official faculty-filtered hiring paths",
  baseline: coverage.totals,
  result: {
    eligibleUniverse: coverage.totals.eligible_universe,
    covered: coverage.totals.covered + newlyCoveredCount,
    missing: coverage.totals.missing - newlyCoveredCount,
    excludedPolicy: coverage.totals.excluded_policy,
    pendingReview: coverage.totals.pending_review,
  },
  appliedCount: validation.results.length,
  newlyCoveredCount,
  currentFacultyJobCount: validation.currentFacultyJobCount,
  applied: validation.results,
  safeguards: [
    "LMU retains its official Workday faculty job-family facet.",
    "Pepperdine retains both the Teaching and Faculty PageUp facets.",
    "Both sources require at least one valid live faculty result before promotion.",
    "Existing appointment-track evidence safeguards remain unchanged.",
  ],
});
console.log(`Applied ${validation.results.length} California controls; ${newlyCoveredCount} newly covered.`);
