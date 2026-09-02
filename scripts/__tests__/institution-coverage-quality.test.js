import assert from "node:assert/strict";
import test from "node:test";
import { classifyInstitutionCoverage } from "../lib/institution-coverage-quality.js";

test("classifies verified hiring source types", () => {
  assert.equal(classifyInstitutionCoverage({ coverage_status: "covered", name: "A", career_url: "https://a.edu/jobs", platform_type: "workday" }), "direct_job_board");
  assert.equal(classifyInstitutionCoverage({ coverage_status: "covered", name: "A Campus", coverage_source: "A System", career_url: "https://system.edu/jobs" }), "verified_shared_system_board");
  assert.equal(classifyInstitutionCoverage({ coverage_status: "covered", name: "A", homepage_url: "https://a.edu", career_url: "https://a.edu/employment", platform_type: "generic" }), "official_employment_page");
  assert.equal(classifyInstitutionCoverage({ coverage_status: "covered", name: "A", homepage_url: "https://www.a.edu/", career_url: "http://a.edu", platform_type: "generic" }), "homepage_fallback");
});

test("keeps no-public-source and inactive exclusions distinct", () => {
  assert.equal(
    classifyInstitutionCoverage(
      { coverage_status: "excluded_policy", verification_status: "verified_no_public_hiring_source" },
      { reason: "No public employee openings page was found." }
    ),
    "no_public_hiring_source"
  );
  assert.equal(
    classifyInstitutionCoverage(
      { coverage_status: "excluded_policy", verification_status: "verified_inactive" },
      { reason: "The college closed in 2025." }
    ),
    "closed_or_out_of_scope"
  );
});

test("does not treat a covered record without a source as verified quality", () => {
  assert.equal(classifyInstitutionCoverage({ coverage_status: "covered" }), "unresolved");
});
