import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/shared-system-campus-control-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/shared-system-campus-control-validation.json"), "utf8"));
const normalizedUrl = (value) => String(value || "").replace(/\/(?=\?)/, "");

test("shared systems use 15 exact official campus controls", () => {
  assert.equal(milestone.appliedCount, 15);
  assert.deepEqual(
    Object.fromEntries([...new Set(milestone.applied.map((item) => item.source))].map((source) => [source, milestone.applied.filter((item) => item.source === source).length])),
    {
      "University of Connecticut": 4,
      "University of New Hampshire System": 3,
      "Indiana University": 5,
      "Rutgers, The State University of New Jersey": 3,
    }
  );
  for (const item of milestone.applied) {
    const override = overrides.overrides.find((row) => row.name === item.name);
    const institution = master.institutions.find((row) => row.name === item.name);
    assert.equal(normalizedUrl(override?.career_url), normalizedUrl(item.url));
    assert.equal(override?.coverage_source, item.source);
    assert.equal(normalizedUrl(institution?.career_url), normalizedUrl(item.url));
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "shared_system_exact_campus_control_validated");
  }
});

test("campus routes precede broad system routes so exact attribution wins", () => {
  for (const source of [...new Set(milestone.applied.map((item) => item.source))]) {
    const broadIndex = server.indexOf(`campus: ${JSON.stringify(source)}`);
    assert.ok(broadIndex > 0, `missing broad route for ${source}`);
    for (const item of milestone.applied.filter((row) => row.source === source)) {
      const campusIndex = server.indexOf(`campus: ${JSON.stringify(item.name)}`);
      assert.ok(campusIndex >= 0 && campusIndex < broadIndex, `${item.name} must precede ${source}`);
    }
  }
});

test("UConn PageUp campus routes fail closed through exact listing locations", () => {
  for (const item of milestone.applied.filter((row) => row.controlType === "pageup_location")) {
    assert.match(item.url, /\?location=UConn%20/);
    assert.match(server, new RegExp(`locationFilter: ${JSON.stringify(item.control)}`));
  }
  assert.match(server, /type === "pageup-campus"/);
  assert.match(server, /scrapePageUpCampusAs\(context, url, campus, "CT", locationFilter\)/);
  assert.match(server, /location\.toLowerCase\(\) !== clean\(locationFilter\)\.toLowerCase\(\)/);
  assert.match(server, /exact PageUp location/);
  assert.match(server, /querySelector\?\.\("\.location, \[data-label='Location'\], \[aria-label='Location'\]"\)/);
});

test("all official controls validate and retain faculty safeguards", () => {
  assert.equal(validation.validatedCount, 15);
  assert.equal(validation.allControlsPresentAndSelected, true);
  assert.equal(validation.validated.every((item) => item.officialDescriptor), true);
  for (const item of milestone.applied.filter((row) => row.source.startsWith("Rutgers"))) {
    assert.match(item.url, /query_position_type_id%5B%5D=6/);
    assert.match(item.url, /2182%5B%5D=3/);
    assert.match(item.url, /2201%5B%5D=[123]/);
  }
  for (const item of milestone.applied.filter((row) => row.source === "University of New Hampshire System")) {
    assert.match(item.url, /timeType=1550a879b33f10037951f18fd1800000/);
    assert.match(item.url, /workerSubType=b4f41dd8de101000c45c0d3fc2a10001/);
  }
});

test("UNH Manchester now has a manually verified official hiring source", () => {
  const name = "University of New Hampshire at Manchester";
  assert.equal(overrides.overrides.some((row) => row.name === name), true);
  assert.equal(master.institutions.find((row) => row.name === name)?.coverage_status, "covered");
  assert.match(server, /University of New Hampshire at Manchester[^\n]+manchester\.unh\.edu\/about\/faculty-staff-resources\/human-resources/);
  assert.equal(milestone.heldForReview[0].name, name);
});
