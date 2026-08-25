import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { splitHawaiiSchoolJobsCampus } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/policy-excluded-colleges.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/hawaii-system-campus-splitter-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/hawaii-system-campus-splitter-validation.json"), "utf8"));

test("Hawaiʻi one-pass splitter promotes four exact university campus controls", () => {
  assert.equal(milestone.appliedCount, 4);
  for (const item of milestone.applied) {
    const override = overrides.overrides.find((row) => row.name === item.name);
    const institution = master.institutions.find((row) => row.name === item.name);
    assert.equal(override?.career_url, milestone.boardUrl);
    assert.equal(override?.platform_type, "schooljobs-hawaii");
    assert.equal(override?.coverage_source, "University of Hawaii System");
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "exact_shared_system_campus_control_validated");
  }
  assert.match(server, /type: "schooljobs-hawaii"/);
  assert.match(server, /scrapeHawaiiSystemAs\(context, url, "HI"\)/);
  const systemOverride = overrides.overrides.find((row) => row.name === "University of Hawaii System");
  assert.equal(systemOverride?.platform_type, "schooljobs-hawaii");
  assert.equal(systemOverride?.career_url, milestone.boardUrl);
});

test("Hawaiʻi splitter accepts exact department prefixes and fails closed", () => {
  assert.equal(splitHawaiiSchoolJobsCampus({ departmentName: "University of Hawai'i at Hilo" }), "University of Hawaii at Hilo");
  assert.equal(splitHawaiiSchoolJobsCampus({ departmentName: "(EVA) University of Hawai'i at Hilo" }), "University of Hawaii at Hilo");
  assert.equal(splitHawaiiSchoolJobsCampus({ departmentName: "University of Hawai'i at Manoa - College of Engineering" }), "University of Hawaii at Manoa");
  assert.equal(splitHawaiiSchoolJobsCampus({ departmentName: "University of Hawai'i Maui College" }), "University of Hawaii Maui College");
  assert.equal(splitHawaiiSchoolJobsCampus({ departmentName: "University of Hawai'i - West O'ahu - Academic Affairs (L)" }), "University of Hawaii-West Oahu");
  assert.equal(splitHawaiiSchoolJobsCampus({ departmentName: "Hawai'i Community College" }), "Hawaii Community College");
  assert.equal(splitHawaiiSchoolJobsCampus({ departmentName: "Kapi'olani Community College - Health Sciences" }), "Kapiolani Community College");
  assert.equal(splitHawaiiSchoolJobsCampus({ departmentName: "Office of the Vice President for Budget and Finance System" }), null);
  assert.equal(splitHawaiiSchoolJobsCampus({ departmentName: "University of Hawai'i at Hilo support office" }), null);
});

test("the shared board is crawled once and old duplicate campus routes are removed", () => {
  assert.equal((server.match(/careers\/hawaiiedu\?keywords=faculty/g) || []).length, 1);
  for (const name of milestone.consolidatedExistingCampusRoutes) {
    assert.equal(server.includes(`campus: ${JSON.stringify(name)}, type: "schooljobs"`), false);
  }
  assert.match(server, /data-department-name/);
});

test("official markers validate while Pitt's Taleo exclusion remains intact", () => {
  assert.equal(validation.validatedCount, 4);
  assert.equal(validation.allControlsPresent, true);
  assert.equal(validation.validated.every((item) => item.matchedDepartments.length > 0), true);
  assert.ok(validation.focusedScrape.currentFacultyPostingCount > 0);
  for (const item of milestone.applied) {
    assert.ok(validation.focusedScrape.campusCounts[item.name] > 0);
  }
  assert.equal(policy.colleges.includes("University of Pittsburgh-Titusville"), true);
  assert.match(milestone.heldByPolicy.reason, /Oracle Taleo/);
});
