import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { splitMaricopaBusinessUnit } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/maricopa-campus-controls-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/maricopa-campus-controls-validation.json"), "utf8"));

test("Maricopa one-pass splitter covers all ten colleges and the district office", () => {
  assert.equal(milestone.appliedCount, 11);
  assert.equal(milestone.newlyCoveredCount, 9);
  for (const item of milestone.applied) {
    const override = overrides.overrides.find((row) => row.name === item.name);
    const institution = master.institutions.find((row) => row.name === item.name);
    assert.equal(override?.career_url, milestone.boardUrl);
    assert.equal(override?.platform_type, "maricopa-faculty");
    assert.equal(override?.coverage_source, "Maricopa Community Colleges");
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "exact_shared_system_business_unit_validated");
  }
});

test("Maricopa splitter accepts exact business units and fails closed", () => {
  for (const item of milestone.applied) {
    assert.equal(splitMaricopaBusinessUnit({ businessUnit: item.businessUnit }), item.name);
  }
  assert.equal(splitMaricopaBusinessUnit({ businessUnit: "Mesa College - Downtown" }), null);
  assert.equal(splitMaricopaBusinessUnit({ businessUnit: "Maricopa Community College" }), null);
  assert.equal(splitMaricopaBusinessUnit({ businessUnit: "Unknown College" }), null);
  assert.equal(splitMaricopaBusinessUnit({ location: "Mesa Community College" }), null);
});

test("the official board is crawled once and old duplicate routes are absent", () => {
  assert.equal((server.match(/https:\/\/www\.maricopa\.edu\/about\/careers\/faculty/g) || []).length, 1);
  assert.match(server, /type: "maricopa-faculty"/);
  assert.match(server, /scrapeMaricopaFacultyAs\(context, url, "AZ"\)/);
  assert.equal(server.includes('campus: "Chandler-Gilbert Community College", type: "generic"'), false);
  assert.equal(server.includes('campus: "Estrella Mountain Community College", type: "generic"'), false);
});

test("live validation proves every official control and leaves no current row unassigned", () => {
  assert.equal(validation.boardStatus, 200);
  assert.equal(validation.expectedControlCount, 11);
  assert.equal(validation.validatedControlCount, 11);
  assert.equal(validation.allControlsPresent, true);
  assert.equal(validation.unassignedCurrentFacultyCount, 0);
  assert.ok(validation.currentFacultyPostingCount > 0);
  assert.ok(validation.sample.every((job) => milestone.applied.some((item) => item.name === job.college)));
});
