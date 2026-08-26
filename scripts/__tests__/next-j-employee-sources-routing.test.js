import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-j-employee-sources-validation.json", import.meta.url), "utf8")
);

test("four J institutions use exact official employee faculty routes", () => {
  assert.match(serverSource, /Jackson College", type: "schooljobs"[\s\S]*?schooljobs\.com\/careers\/jccmi\/transferjobs/);
  assert.match(serverSource, /Jacksonville State University", type: "pageup"[\s\S]*?search-page-jsu-careers-faculty/);
  assert.match(serverSource, /James A\. Rhodes State College", type: "schooljobs"[\s\S]*?schooljobs\.com\/careers\/rhodesstate/);
  assert.match(serverSource, /John Brown University", type: "jbu-faculty"[\s\S]*?jbu\.edu\/human-resources\/faculty-job-listings/);
  for (const name of ["Jackson College", "Jacksonville State University", "James A. Rhodes State College", "John Brown University"]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("state dispatchers reach the selected production adapters", () => {
  const al = serverSource.match(/async function scrapeAlAll[\s\S]*?async function scrapeMsAll/);
  const ar = serverSource.match(/async function scrapeArAll[\s\S]*?async function scrapeKsAll/);
  assert.ok(al);
  assert.ok(ar);
  assert.match(al[0], /type === "pageup"[\s\S]*?scrapePageUpAs/);
  assert.match(ar[0], /type === "jbu-faculty"[\s\S]*?scrapeJbuFacultyAs/);
  assert.match(serverSource, /export async function scrapeJbuFacultyAs[\s\S]*?rootPath = "\/human-resources\/faculty-job-listings\/"/);
});

test("live validation records four newly covered institutions", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 87);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
});
