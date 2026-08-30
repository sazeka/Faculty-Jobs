import test from "node:test";
import assert from "node:assert/strict";
import { computeInstitutionOpeningStats } from "../lib/institution-opening-stats.js";

test("counts covered eligible institutions with and without current openings", () => {
  const institutions = [
    { name: "Open University", level: "4-year", control: "public", is_degree_granting: true, coverage_status: "covered", last_seen_job_count: 3 },
    { name: "Quiet College", level: "2-year", control: "private nonprofit", is_degree_granting: true, coverage_status: "covered", last_seen_job_count: 0 },
    { name: "Excluded College", level: "4-year", control: "public", is_degree_granting: true, coverage_status: "covered", last_seen_job_count: 0 },
    { name: "Missing College", level: "4-year", control: "public", is_degree_granting: true, coverage_status: "missing", last_seen_job_count: 0 },
    { name: "For Profit College", level: "4-year", control: "private for-profit", is_degree_granting: true, coverage_status: "covered", last_seen_job_count: 0 },
  ];

  assert.deepEqual(computeInstitutionOpeningStats({
    institutions,
    scope: {
      levelsIncluded: ["2-year", "4-year"],
      excludeControls: ["private for-profit"],
      target: "degree-granting",
    },
    excludedColleges: ["Excluded College"],
  }), {
    trackedInstitutions: 2,
    institutionsWithOpenings: 1,
    institutionsWithNoCurrentOpenings: 1,
  });
});
