import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { southernSystemCampusFromTitle, southernVacancyIsOpen } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/southern-university-system-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/southern-university-system-validation.json"), "utf8"));

test("Southern system title routing is exact and fails closed", () => {
  assert.equal(southernSystemCampusFromTitle("SUBR | Assistant Professor of English"), "Southern University and A & M College");
  assert.equal(southernSystemCampusFromTitle("SULC | Director of Academic Support"), "Southern University Law Center");
  assert.equal(southernSystemCampusFromTitle("SU SYSTEM | Director"), "Southern University-Board and System");
  assert.equal(southernSystemCampusFromTitle("SUS | Analyst"), "Southern University-Board and System");
  assert.equal(southernSystemCampusFromTitle("Adjunct Faculty Member"), null);
  assert.equal(southernSystemCampusFromTitle("SUAREC | Extension Agent"), null);
  assert.equal(southernSystemCampusFromTitle("SUSLA | Instructor"), null);
});

test("Southern vacancy deadline guard rejects explicit expired dates", () => {
  const now = new Date("2026-08-25T12:00:00Z");
  assert.equal(southernVacancyIsOpen("Application Deadline: August 24, 2026", now), false);
  assert.equal(southernVacancyIsOpen("Application Deadline: August 25, 2026", now), true);
  assert.equal(southernVacancyIsOpen("Application Deadline: September 11, 2026", now), true);
  assert.equal(southernVacancyIsOpen("Application Deadline: Open until filled", now), true);
  assert.equal(southernVacancyIsOpen("Application Deadline: Continuous", now), true);
});

test("Louisiana dispatcher uses two non-redundant Southern vacancy scans", () => {
  assert.equal((server.match(/type: "southern-system-vacancies"/g) || []).length, 1);
  assert.equal((server.match(/type: "southern-vacancies"/g) || []).length, 1);
  const dispatcher = server.match(/async function scrapeLaAll[\s\S]*?async function scrapeArAll/);
  assert.ok(dispatcher);
  assert.match(dispatcher[0], /scrapeSouthernSystemVacancies/);
  assert.match(dispatcher[0], /scrapeSouthernVacancyFeed/);
});

test("all four Southern institutions have validated official coverage", () => {
  assert.equal(milestone.appliedCount, 4);
  assert.equal(milestone.newlyCoveredCount, 4);
  assert.equal(milestone.scanCount, 2);
  assert.equal(validation.invalidJobCount, 0);
  assert.ok(validation.sourceChecks.every((check) => check.healthy));
  for (const result of validation.results) {
    const override = overrides.overrides.find((row) => row.name === result.name);
    const institution = master.institutions.find((row) => row.name === result.name);
    assert.equal(override?.career_url, result.url);
    assert.equal(override?.platform_type, result.platformType);
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.verification_status, "healthy");
    assert.equal(institution?.last_discovery_status, "official_exact_institution_scope_validated");
  }
});
