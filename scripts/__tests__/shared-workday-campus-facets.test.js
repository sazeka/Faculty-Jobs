import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const report = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/shared-workday-campus-facet-milestone.json"), "utf8"));

test("Penn State and Ohio State regional campuses use unique official Workday facets", () => {
  assert.equal(report.appliedCount, 23);
  assert.equal(new Set(report.applied.map((item) => item.facetId)).size, 23);
  for (const item of report.applied) {
    assert.match(item.career_url, /\?locations=[a-f0-9]+&/);
    const override = overrides.overrides.find((row) => row.name === item.name);
    assert.equal(override?.career_url, item.career_url);
    assert.equal(override?.platform_type, "workday");
    assert.equal(override?.coverage_source, item.source);
    assert.match(server, new RegExp(`campus: ${JSON.stringify(item.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
});

test("campus-scoped routes precede broad system routes and rebuild as covered", () => {
  for (const source of ["The Pennsylvania State University", "Ohio State University"]) {
    const members = report.applied.filter((item) => item.source === source);
    const broadIndex = server.indexOf(`campus: ${JSON.stringify(source)}`);
    assert.ok(broadIndex > 0);
    for (const member of members) {
      assert.ok(server.indexOf(`campus: ${JSON.stringify(member.name)}`) < broadIndex);
      assert.equal(master.institutions.find((row) => row.name === member.name)?.coverage_status, "covered");
    }
  }
});

test("Penn State New Kensington remains unresolved without a verified facet", () => {
  const name = "Pennsylvania State University-Penn State New Kensington";
  assert.equal(overrides.overrides.some((row) => row.name === name), false);
  assert.equal(master.institutions.find((row) => row.name === name)?.coverage_status, "missing");
  assert.equal(report.heldForReview[0].name, name);
});
