#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const COVERAGE_PATH = path.join(ROOT, "generated", "coverage-report.json");
const VALIDATION_PATH = path.join(ROOT, "generated", "ut-system-health-controls-validation.json");
const REPORT_PATH = path.join(ROOT, "generated", "ut-system-health-controls-milestone.json");
const SOURCE = "University of Texas System";

const controls = [
  {
    name: "The University of Texas Permian Basin",
    platform_type: "peoplesoft-hrs",
    career_url: "https://zahr-prd-candidate-ada.utshare.utsystem.edu/psc/ZAHRPRDADA/EMPLOYEE/UTZ_CG/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Action=U&FOCUS=Applicant&Page=HRS_APP_SCHJOB&SiteId=10",
    scopeEvidence: "Official UTPB footer Careers link and exact UTShare SiteId=10",
    notes: "Verified live 2026-08-25 from UTPB's official footer Careers link: exact institution-specific UTShare SiteId=10. Production validation returned 30 current faculty-titled jobs with the existing non-adjunct safeguard intact.",
  },
  {
    name: "The University of Texas System Office",
    platform_type: "peoplesoft-hrs",
    career_url: "https://zahr-prd-candidate-ada.utshare.utsystem.edu/psp/ZAHRPRDADA/EMPLOYEE/HRMS/c/HRS_HRAM.HRS_APP_SCHJOB.GBL?Action=U&FOCUS=Applicant&Page=HRS_APP_SCHJOB&SiteId=8",
    scopeEvidence: "Official UT System Administration Careers link and exact UTShare SiteId=8",
    notes: "Verified live 2026-08-25 from the UT System Administration official Careers page: exact office-specific UTShare SiteId=8. No faculty-titled jobs are current, and the scoped route prevents member-campus attribution.",
  },
  {
    name: "The University of Texas Health Science Center at Houston",
    platform_type: "phenom-faculty-category",
    career_url: "https://careers.uth.tmc.edu/us/en/c/faculty-physicians-jobs",
    scopeEvidence: "Institution-owned Phenom Faculty & Physicians category plus faculty-title evidence",
    notes: "Verified live 2026-08-25 through UTHealth Houston's current institution-owned Phenom Faculty & Physicians category. Full offset pagination returned 109 jobs with both exact category and faculty-title evidence; physician-only titles remain excluded.",
  },
  {
    name: "The University of Texas Health Science Center at San Antonio",
    platform_type: "selectminds-faculty-search",
    career_url: "https://uthscsa.referrals.selectminds.com/faculty",
    scopeEvidence: "Institution-dedicated SelectMinds portal with exact Category: Faculty on every accepted row",
    notes: "Verified live 2026-08-25 through the institution's dedicated SelectMinds Faculty portal. The production adapter paginated the complete search and accepted 224 canonical rows carrying exact Category: Faculty evidence.",
  },
  {
    name: "The University of Texas Medical Branch at Galveston",
    platform_type: "selectminds-faculty-saved-search",
    career_url: "https://applyjobs.utmb.edu/landing-pages/79/jobs-matching-custom-search",
    scopeEvidence: "Official UTMB Faculty & Physicians saved search plus faculty-title evidence",
    notes: "Verified live 2026-08-25 through UTMB's official Faculty & Physicians saved search. The production adapter paginated all 25 result pages and retained 141 faculty-evidenced titles while rejecting physician-only roles.",
  },
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

for (const control of controls) {
  const override = {
    name: control.name,
    career_url: control.career_url,
    platform_type: control.platform_type,
    coverage_source: SOURCE,
    notes: control.notes,
  };
  const prior = overrideMap.get(control.name.toLowerCase());
  if (prior) Object.assign(prior, override);
  else overrides.overrides.push(override);

  const institution = institutionMap.get(control.name.toLowerCase());
  if (!institution) throw new Error(`Institution missing from master: ${control.name}`);
  const live = validationMap.get(control.name.toLowerCase());
  institution.career_url = control.career_url;
  institution.platform_type = control.platform_type;
  institution.coverage_source = SOURCE;
  institution.coverage_status = "covered";
  institution.verification_status = "healthy";
  institution.last_verified_at = now;
  institution.last_seen_job_count = Number(live?.currentFacultyJobCount || 0);
  institution.last_discovery_status = "official_institution_control_validated";
  institution.last_discovery_confidence = 1;
  institution.last_discovery_attempt_at = now;
  institution.notes = control.notes;
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

const resultCoverage = coverage.totals;
const report = {
  generatedAt: now,
  scope: "Five previously unresolved University of Texas System institutions",
  baseline: {
    eligibleUniverse: resultCoverage.eligible_universe,
    covered: resultCoverage.covered - newlyCoveredCount,
    missing: resultCoverage.missing + newlyCoveredCount,
    excludedPolicy: resultCoverage.excluded_policy,
    pendingReview: resultCoverage.pending_review,
    coveragePercent: Number((((resultCoverage.covered - newlyCoveredCount) / resultCoverage.eligible_universe) * 100).toFixed(2)),
  },
  result: {
    eligibleUniverse: resultCoverage.eligible_universe,
    covered: resultCoverage.covered,
    missing: resultCoverage.missing,
    excludedPolicy: resultCoverage.excluded_policy,
    pendingReview: resultCoverage.pending_review,
    coveragePercent: Number(((resultCoverage.covered / resultCoverage.eligible_universe) * 100).toFixed(2)),
  },
  appliedCount: controls.length,
  newlyCoveredCount,
  currentFacultyJobCount: validation.currentFacultyJobCount,
  applied: controls.map((control) => ({
    name: control.name,
    platform_type: control.platform_type,
    career_url: control.career_url,
    scopeEvidence: control.scopeEvidence,
    currentFacultyJobCount: validationMap.get(control.name.toLowerCase())?.currentFacultyJobCount || 0,
  })),
  safeguards: [
    "Only canonical job-detail URLs on the institution-owned host are accepted.",
    "San Antonio rows require exact Category: Faculty evidence.",
    "Houston and UTMB mixed Faculty & Physicians boards also require faculty-title evidence.",
    "Existing non-adjunct and tenure-classification evidence safeguards remain unchanged.",
    "PeopleSoft routes use exact SiteId controls and click the exact View All Jobs action.",
  ],
};

fs.writeFileSync(OVERRIDES_PATH, `${JSON.stringify(overrides, null, 2)}\n`);
fs.writeFileSync(MASTER_PATH, `${JSON.stringify(master, null, 2)}\n`);
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Applied ${controls.length} exact UT controls; ${newlyCoveredCount} newly covered.`);
