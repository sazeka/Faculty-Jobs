import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/eighth-private-discovery-batch-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/eighth-private-discovery-batch-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("eighth private discovery batch accounts for every unresolved Q through S institution", () => {
  assert.equal(validation.reviewedCount, 77);
  assert.equal(validation.promotedCount, 17);
  assert.equal(validation.heldCount, 60);
  assert.equal(validation.promoted.length, 17);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 60);
  assert.equal(new Set(validation.held.flatMap((row) => row.names)).size, 60);
  assert.equal(validation.liveChecks.reduce((sum, row) => sum + row.publishedFacultyMatches, 0), 113);
});

test("all promoted Q through S routes are wired to official sources", () => {
  for (const control of validation.promoted) {
    assert.match(server, new RegExp(control.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(server, /Randolph-Macon College[^\n]+workforcenow\.adp\.com/);
  assert.match(server, /Saint Louis University[^\n]+jobFamilyGroup=540e12fab86101bf4168b74e74018188/);
  assert.match(server, /St Olaf College[^\n]+oraclecloud\.com/);
});

test("Rust College uses the fail-closed faculty table extractor", () => {
  assert.match(server, /export async function scrapeFacultyTablePageAs[\s\S]+table tbody tr[\s\S]+faculty-table scrape failed/);
  assert.match(server, /Rust College[^\n]+type: "faculty-table"/);
  assert.match(server, /type === "faculty-table"[^\n]+scrapeFacultyTablePageAs\(context, url, campus, "MS"\)/);
});

test("known navigation labels are rejected", () => {
  assert.match(server, /Schreiner University[^\n]+Students\? \\\\| Faculty \\\\| Staff/);
  assert.match(server, /Shenandoah University[^\n]+\^Faculty Handbook\$/);
  assert.match(server, /Stevenson University[^\n]+\^Faculty Policies\$/);
});

test("all promoted institutions are covered and retain evidence", () => {
  assert.equal(milestone.appliedCount, 17);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url, control.url);
    assert.equal(institution?.career_url, control.url);
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.verification_status, "healthy");
  }
});
