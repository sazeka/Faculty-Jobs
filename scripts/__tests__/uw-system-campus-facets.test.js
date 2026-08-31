import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "data/policy-rules.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/uw-system-campus-facets-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/uw-system-campus-facets-validation.json"), "utf8"));

test("UW comprehensive institutions use unique official Workday facets", () => {
  assert.equal(milestone.appliedCount, 12);
  assert.equal(milestone.newlyCoveredCount, 7);
  assert.equal(new Set(milestone.applied.map((item) => item.facetId)).size, 12);
  for (const item of milestone.applied) {
    assert.match(item.career_url, /\?Institution=[a-f0-9]+$/);
    const override = overrides.overrides.find((row) => row.name === item.name);
    const institution = master.institutions.find((row) => row.name === item.name);
    assert.equal(override?.career_url, item.career_url);
    assert.equal(override?.platform_type, "workday");
    assert.equal(override?.coverage_source, "University of Wisconsin System");
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "shared_workday_institution_facet_validated");
    assert.match(server, new RegExp(`campus: ${JSON.stringify(item.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
});

test("the unsafe broad UW route and weaker duplicate routes are absent", () => {
  assert.equal(server.includes('campus: "UW System Comprehensives"'), false);
  for (const name of [
    "University of Wisconsin-Oshkosh",
    "University of Wisconsin-Stout",
    "University of Wisconsin-Superior",
    "University of Wisconsin-Whitewater",
  ]) {
    assert.equal(server.includes(`campus: "${name}", type: "generic"`), false);
  }
});

test("Flex-only modality records remain unpromoted without an exact official facet", () => {
  for (const held of milestone.heldForReview) {
    assert.equal(overrides.overrides.some((row) => row.name === held.name), false);
    assert.ok(["missing", "excluded_policy"].includes(master.institutions.find((row) => row.name === held.name)?.coverage_status));
    assert.equal(rules.institutionOverrides[held.name]?.action, "exclude");
  }
});

test("live validation proves every official facet through the production scraper", () => {
  assert.equal(validation.boardStatus, 200);
  assert.equal(validation.validatedCount, 12);
  assert.equal(validation.allFacetIdsPresentInOfficialApi, true);
  assert.equal(validation.campusesWithCurrentPostings, 12);
  assert.ok(validation.currentFacultyPostingCount > 0);
});
