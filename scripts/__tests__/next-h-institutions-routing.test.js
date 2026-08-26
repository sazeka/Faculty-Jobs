import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-h-institutions-validation.json", import.meta.url), "utf8")
);

test("next four H institutions use official employee sources", () => {
  assert.match(serverSource, /Hampden-Sydney College", type: "generic", url: "https:\/\/www\.hsc\.edu\/human-resources\/job-openings"/);
  assert.match(serverSource, /Hampton University", type: "hampton-faculty", url: "https:\/\/home\.hamptonu\.edu\/hr\/jobs\/"/);
  assert.match(serverSource, /Harding University", type: "harding-faculty", url: "https:\/\/www\.harding\.edu\/about\/offices-departments\/hr\/faculty-jobs\/"/);
  assert.match(serverSource, /Hendrix College", type: "generic", url: "https:\/\/www\.hendrix\.edu\/resources\/resources\.aspx\?id=2148"/);

  for (const name of ["Hampden-Sydney College", "Hampton University", "Harding University", "Hendrix College"]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("state dispatchers support the dedicated Hampton and Harding routes", () => {
  const vaDispatcher = serverSource.match(/async function scrapeVaAll[\s\S]*?async function scrapeScAll/);
  const arDispatcher = serverSource.match(/async function scrapeArAll[\s\S]*?async function scrapeKsAll/);
  assert.ok(vaDispatcher);
  assert.ok(arDispatcher);
  assert.match(vaDispatcher[0], /type === "hampton-faculty"/);
  assert.match(arDispatcher[0], /type === "harding-faculty"/);
  assert.match(serverSource, /export async function scrapeHamptonFacultyAs/);
  assert.match(serverSource, /export async function scrapeHardingFacultyAs/);
});

test("live validation records four newly covered institutions", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 51);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
  assert.equal(validation.results.filter((row) => row.facultyJobCount === 0).length, 2);
});
