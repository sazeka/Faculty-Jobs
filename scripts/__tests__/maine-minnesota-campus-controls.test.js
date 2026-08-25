import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { splitUmnCampus } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/maine-minnesota-campus-control-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/maine-minnesota-campus-control-validation.json"), "utf8"));

test("Maine and Minnesota milestone applies eight exact campus controls", () => {
  assert.equal(milestone.appliedCount, 8);
  assert.equal(milestone.applied.filter((item) => item.controlType === "oracle_organization").length, 4);
  assert.equal(milestone.applied.filter((item) => item.controlType === "peoplesoft_location").length, 4);
  for (const item of milestone.applied) {
    const override = overrides.overrides.find((row) => row.name === item.name);
    const institution = master.institutions.find((row) => row.name === item.name);
    assert.equal(override?.career_url, item.url);
    assert.equal(override?.coverage_source, item.source);
    assert.equal(override?.platform_type, item.platformType);
    assert.equal(institution?.career_url, item.url);
    assert.equal(institution?.coverage_source, item.source);
    assert.equal(institution?.platform_type, item.platformType);
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "exact_shared_system_campus_control_validated");
  }
});

test("Maine controls combine exact organizations with the Faculty category", () => {
  const maineItems = milestone.applied.filter((item) => item.controlType === "oracle_organization");
  const broadIndex = server.indexOf('campus: "University of Maine System"');
  assert.ok(broadIndex > 0);
  for (const item of maineItems) {
    assert.match(item.url, new RegExp(`selectedOrganizationsFacet=${item.control}`));
    assert.match(item.url, new RegExp(`selectedCategoriesFacet=${milestone.oracleFacultyCategory}`));
    const campusRoute = `campus: ${JSON.stringify(item.name)}, type: "oracle-cloud-api"`;
    assert.ok(server.includes(campusRoute));
    assert.ok(server.indexOf(campusRoute) < broadIndex);
  }
  assert.match(server, /type === "oracle-cloud-api"/);
  assert.match(server, /scrapeOracleCloudApi\(url, campus, "ME"\)/);
});

test("University of Minnesota attribution accepts only exact campus locations", () => {
  const source = { title: "Assistant Professor", college: "University of Minnesota", location: "Duluth" };
  assert.equal(splitUmnCampus(source).college, "University of Minnesota-Duluth");
  assert.equal(splitUmnCampus({ ...source, location: "Crookston" }).college, "University of Minnesota-Crookston");
  assert.equal(splitUmnCampus({ ...source, location: "Morris" }).college, "University of Minnesota-Morris");
  assert.equal(splitUmnCampus({ ...source, location: "Rochester" }).college, "University of Minnesota-Rochester");
  assert.equal(splitUmnCampus({ ...source, location: "Twin Cities" }).college, "University of Minnesota");
  assert.equal(splitUmnCampus({ ...source, location: "Duluth campus" }).college, "University of Minnesota");
  assert.deepEqual(splitUmnCampus({ ...source, college: "Unrelated College" }), { ...source, college: "Unrelated College" });
  assert.match(server, /\.map\(splitUmnCampus\)\s*\.map\(splitMinnStateSystemCollege\)/);
});

test("all eight controls retain live official validation evidence", () => {
  assert.equal(validation.validatedCount, 8);
  assert.equal(validation.allControlsPresentAndSelected, true);
  assert.deepEqual(validation.maine.facultyCategory, { id: milestone.oracleFacultyCategory, descriptor: "Faculty" });
  assert.equal(validation.maine.validated.length, 4);
  assert.equal(validation.minnesota.validated.length, 4);
  assert.equal(validation.maine.validated.every((item) => item.officialDescriptor), true);
  assert.equal(validation.minnesota.validated.every((item) => item.officialCampusUrl), true);
});
