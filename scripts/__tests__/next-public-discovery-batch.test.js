import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { splitSpokaneCollegesCampus } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/next-public-discovery-batch-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/next-public-discovery-batch-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("next public discovery batch reviews exactly forty institutions", () => {
  assert.equal(validation.reviewedCount, 40);
  assert.equal(validation.promotedCount, 31);
  assert.equal(validation.heldCount, 9);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 9);
});

test("shared public boards retain exact institution controls", () => {
  assert.match(server, /University of Washington-Bothell Campus"[^\n]+campusFilter: "Bothell"/);
  assert.match(server, /University of Washington-Tacoma Campus"[^\n]+campusFilter: "Tacoma"/);
  assert.match(server, /search-page-langston/);
  assert.match(server, /morgan-cc-search-page/);
  assert.match(server, /pueblo-cc-search-page/);
  assert.match(server, /red-rocks-cc-search-page/);
});

test("Spokane shared-board rows require explicit campus evidence", () => {
  const base = { college: "Spokane Colleges", title: "Instructor", url: "https://example.edu/job/1" };
  assert.equal(splitSpokaneCollegesCampus({ ...base, department: "SCC Mathematics" })?.college, "Spokane Community College");
  assert.equal(splitSpokaneCollegesCampus({ ...base, department: "SFCC English" })?.college, "Spokane Falls Community College");
  assert.equal(splitSpokaneCollegesCampus(base), null);
});

test("all promoted institutions are covered and retain source evidence", () => {
  assert.equal(milestone.appliedCount, 31);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url, control.url);
    assert.equal(institution?.career_url.replace(/\/$/, ""), control.url.replace(/\/$/, ""));
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.verification_status, "healthy");
  }
});
