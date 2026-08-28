import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const validation = read("generated/ninth-private-discovery-batch-validation.json");
const milestone = read("generated/ninth-private-discovery-batch-milestone.json");
const overrides = read("data/career-url-overrides.json");
const master = read("data/institutions-master.json");

test("ninth private discovery batch accounts for every unresolved T through Z institution", () => {
  assert.equal(validation.reviewedCount, 142);
  assert.equal(validation.promotedCount, 38);
  assert.equal(validation.heldCount, 104);
  assert.equal(validation.promoted.length, 38);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 104);
  assert.equal(new Set(validation.held.flatMap((row) => row.names)).size, 104);
  assert.equal(validation.liveChecks.reduce((sum, row) => sum + row.publishedFacultyMatches, 0), 188);
});

test("all promoted T through Z routes are wired to official sources", () => {
  for (const control of validation.promoted) assert.match(server, new RegExp(control.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(server, /Taylor University[^\n]+jobType%5B0%5D=Adjunct/);
  assert.match(server, /Texas Wesleyan University[^\n]+1175=2/);
  assert.match(server, /Thomas Jefferson University[^\n]+ThomasJeffersonExternal[^\n]+titleFilter/);
  assert.match(server, /Vanderbilt University[^\n]+oraclecloud\.com/);
  assert.match(server, /Western Governors University[^\n]+academic-careers[^\n]+excludeTitleFilter/);
});

test("observed non-vacancy labels are rejected", () => {
  assert.match(server, /Toyota Technological Institute at Chicago[^\n]+\^Faculty Alumni\$/);
  assert.match(server, /Union Commonwealth University[^\n]+\^Faculty\/Staff\$/);
  assert.match(server, /Western Governors University[^\n]+\^Hear from our Course Instructors\$/);
});

test("recently closed and suspended institutions remain held", () => {
  const held = new Set(validation.held.flatMap((row) => row.names));
  for (const name of ["The College of Saint Rose", "Trinity Christian College", "University of Valley Forge", "Warner Pacific University", "Woodbury University"]) assert.ok(held.has(name), name);
});

test("all promoted institutions are covered and retain evidence", () => {
  assert.equal(milestone.appliedCount, 38);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url, control.url);
    assert.equal(institution?.career_url, control.url);
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.verification_status, "healthy");
  }
});
