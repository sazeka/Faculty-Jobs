import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { splitHerzingUkgLocation } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/herzing-campus-controls-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/herzing-campus-controls-validation.json"), "utf8"));

test("Herzing one-pass splitter covers all eleven IPEDS campuses", () => {
  assert.equal(milestone.appliedCount, 11);
  assert.equal(milestone.newlyCoveredCount, 11);
  for (const item of milestone.applied) {
    const override = overrides.overrides.find((row) => row.name === item.name);
    const institution = master.institutions.find((row) => row.name === item.name);
    assert.equal(override?.career_url, milestone.boardUrl);
    assert.equal(override?.platform_type, "herzing-ukg");
    assert.equal(override?.coverage_source, "Herzing University");
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "exact_shared_system_location_control_validated");
  }
});

test("Herzing splitter accepts one exact physical location and fails closed", () => {
  for (const item of milestone.applied) {
    assert.deepEqual(splitHerzingUkgLocation({ Locations: [{ Id: item.locationId }] }), {
      college: item.name,
      state: item.state,
    });
  }
  assert.equal(splitHerzingUkgLocation({ Locations: [] }), null);
  assert.equal(splitHerzingUkgLocation({ Locations: [{ Id: "unknown" }] }), null);
  assert.equal(splitHerzingUkgLocation({ Locations: [{ Id: milestone.applied[0].locationId }, { Id: milestone.applied[1].locationId }] }), null);
  assert.equal(splitHerzingUkgLocation({ Locations: [{ Id: "eb8c4ebc-d098-4acf-b3a0-f03f8dcb96fb" }] }), null);
  assert.equal(splitHerzingUkgLocation({ location: "Tampa, FL" }), null);
});

test("the official Herzing board is crawled once through the WI dispatcher", () => {
  assert.equal((server.match(/https:\/\/recruiting2\.ultipro\.com\/HER1009HRZ\/JobBoard\/267d2e37-abff-4559-8a18-a754503d3749/g) || []).length, 1);
  assert.match(server, /type: "herzing-ukg"/);
  assert.match(server, /scrapeHerzingUkgAs\(context, url, "Herzing"\)/);
});

test("live validation proves every control and produces no ambiguous output", () => {
  assert.equal(validation.boardStatus, 200);
  assert.equal(validation.expectedControlCount, 11);
  assert.equal(validation.validatedControlCount, 11);
  assert.equal(validation.allControlsPresent, true);
  assert.equal(validation.unassignedOutputCount, 0);
  assert.ok(validation.currentFacultyPostingCount > 0);
  assert.ok(validation.sample.every((job) => milestone.applied.some((item) => item.name === job.college)));
});
