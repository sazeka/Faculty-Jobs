import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/tamus-campus-facets-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/tamus-campus-facets-validation.json"), "utf8"));

test("five unresolved Texas A&M members use exact official Workday controls", () => {
  assert.equal(milestone.appliedCount, 5);
  assert.equal(milestone.newlyCoveredCount, 5);
  assert.equal(new Set(milestone.applied.map((item) => item.memberId)).size, 5);
  for (const item of milestone.applied) {
    const url = new URL(item.career_url);
    assert.equal(url.searchParams.get("hiringCompany"), item.memberId);
    assert.equal(url.searchParams.get("workerSubType"), item.facultyId);
    assert.equal(url.searchParams.get("ztimeType"), item.fullTimeId);
    const override = overrides.overrides.find((row) => row.name === item.name);
    const institution = master.institutions.find((row) => row.name === item.name);
    assert.equal(override?.career_url, item.career_url);
    assert.equal(override?.coverage_source, "Texas A&M University System");
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "shared_workday_member_facets_validated");
    assert.ok(server.includes(`campus: ${JSON.stringify(item.name)}`));
  }
});

test("live validation proves member, faculty, and full-time controls", () => {
  assert.equal(validation.boardStatus, 200);
  assert.equal(validation.validatedCount, 5);
  assert.equal(validation.allControlsPresentInOfficialApi, true);
  assert.ok(validation.membersWithCurrentFacetPostings > 0);
  assert.ok(validation.currentStrictFacultyPostingCount > 0);
});
