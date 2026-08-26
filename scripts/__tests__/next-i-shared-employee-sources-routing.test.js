import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-i-shared-employee-sources-validation.json", import.meta.url), "utf8")
);

test("five institution identities use exact official employee sources", () => {
  assert.match(serverSource, /Ilisagvik College", type: "generic"[\s\S]*?ilisagvik\.bamboohr\.com\/careers/);
  assert.match(serverSource, /Indiana Institute of Technology",[\s\S]*?type: "paycom"[\s\S]*?9B7DD7DDF4B46DE388E0D590C86BBE1D/);
  assert.match(serverSource, /Indiana Wesleyan University-Marion",[\s\S]*?type: "pageup-campus"[\s\S]*?locationFilter: "Marion, IN"/);
  assert.match(serverSource, /Indiana Wesleyan University-National & Global",[\s\S]*?type: "pageup-campus"[\s\S]*?locationFilter: "Remote \(within United States\)"/);

  for (const name of [
    "Ilisagvik College",
    "Indiana Institute of Technology",
    "Indiana Institute of Technology-College of Professional Studies",
    "Indiana Wesleyan University-Marion",
    "Indiana Wesleyan University-National & Global",
  ]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("Indiana routes exact PageUp locations and crawls the shared Paycom board once", () => {
  const inConfig = serverSource.match(/const IN_CAMPUSES = \[[\s\S]*?\n\];/);
  const inDispatcher = serverSource.match(/async function scrapeInAll[\s\S]*?async function scrapeAdpCareerCenterAs/);
  assert.ok(inConfig);
  assert.ok(inDispatcher);
  assert.equal((inConfig[0].match(/9B7DD7DDF4B46DE388E0D590C86BBE1D/g) || []).length, 1);
  assert.match(inDispatcher[0], /type === "pageup-campus"[\s\S]*?scrapePageUpCampusAs/);
  assert.match(inDispatcher[0], /type === "paycom"[\s\S]*?scrapePaycomAs/);
});

test("live validation records five newly covered identities without duplicate jobs", () => {
  assert.equal(validation.newlyCoveredCount, 5);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 5);
  assert.equal(validation.facultyJobCount, 21);
  assert.equal(validation.results.length, 5);
  for (const result of validation.results) assert.equal(result.healthySource, true);
  const component = validation.results.find((row) => row.name.endsWith("College of Professional Studies"));
  assert.equal(component.coverageSource, "Indiana Institute of Technology");
  assert.equal(component.facultyJobCount, 0);
});
