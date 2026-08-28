import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/seventh-private-discovery-batch-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/seventh-private-discovery-batch-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("seventh private discovery batch accounts for every unresolved N through P institution", () => {
  assert.equal(validation.reviewedCount, 55);
  assert.equal(validation.promotedCount, 15);
  assert.equal(validation.heldCount, 40);
  assert.equal(validation.promoted.length, 15);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 40);
  assert.equal(validation.liveChecks.reduce((sum, row) => sum + row.publishedFacultyMatches, 0), 113);
});

test("all promoted N through P routes are wired to official sources", () => {
  for (const control of validation.promoted) {
    assert.match(server, new RegExp(control.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(server, /Oklahoma Christian University[^\n]+recruitingbypaycor\.com/);
  assert.match(server, /Oral Roberts University[^\n]+oru\.hrmdirect\.com/);
  assert.match(server, /Niagara University[^\n]+niagara\.applicantpro\.com/);
});

test("faculty-heading pages use a fail-closed production extractor", () => {
  assert.match(server, /export async function scrapeFacultyHeadingPageAs[\s\S]+does not[\s\S]+faculty-heading scrape failed/);
  for (const source of ["MA", "NJ", "NC", "OK", "TX"]) {
    assert.match(server, new RegExp(`type === "faculty-headings"[^\\n]+scrapeFacultyHeadingPageAs\\(context, url, campus, "${source}"\\)`));
  }
});

test("known navigation and non-faculty labels are rejected", () => {
  assert.match(server, /New York Law School[^\n]+faculty news/);
  assert.match(server, /Peirce College[^\n]+supplemental instructor/);
  assert.match(server, /faculty news\|faculty support\|faculty development\|faculty application/);
});

test("all promoted institutions are covered and retain evidence", () => {
  assert.equal(milestone.appliedCount, 15);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url, control.url);
    assert.equal(institution?.career_url, control.url);
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.verification_status, "healthy");
  }
});
