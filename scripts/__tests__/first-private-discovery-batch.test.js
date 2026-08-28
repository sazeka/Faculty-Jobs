import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/first-private-discovery-batch-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/first-private-discovery-batch-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("first private discovery batch reviews exactly forty institutions", () => {
  assert.equal(validation.reviewedCount, 40);
  assert.equal(validation.promotedCount, 20);
  assert.equal(validation.heldCount, 20);
  assert.equal(validation.promoted.length, 20);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 20);
});

test("new routes use official institution-scoped sources", () => {
  assert.match(server, /Heritage Christian University[^\n]+hcu\.edu\/about\/job-openings/);
  assert.match(server, /Oakwood University[^\n]+oakwood\.edu\/human-resources/);
  assert.match(server, /Ouachita Baptist University[^\n]+faculty-vacancies/);
  assert.match(server, /Sonoran University of Health Sciences[^\n]+co=Sonoran\+University/);
  assert.match(server, /Pacific Oaks College[^\n]+PacificOaksCareers/);
  assert.match(server, /San Francisco Bay University[^\n]+33737-san-francisco-bay-university/);
});

test("ambiguous, merged, and non-employee sources remain held", () => {
  const held = new Set(validation.held.flatMap((row) => row.names));
  assert.ok(held.has("Jackson Theological Seminary"));
  assert.ok(held.has("California College of ASU"));
  assert.ok(held.has("Northcentral University"));
  assert.ok(held.has("Reiss-Davis Graduate School"));
  assert.ok(held.has("RAND School of Public Policy"));
});

test("all promoted institutions are covered and retain source evidence", () => {
  assert.equal(milestone.appliedCount, 20);
  assert.equal(milestone.newlyCoveredCount, 20);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url, control.url);
    assert.equal(institution?.career_url.replace(/\/$/, ""), control.url.replace(/\/$/, ""));
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.verification_status, "healthy");
  }
});
