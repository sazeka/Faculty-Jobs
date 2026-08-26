import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/private-g-institutions-validation.json", import.meta.url), "utf8")
);

test("four private G institutions use official employee hiring sources", () => {
  assert.match(serverSource, /Garrett-Evangelical Theological Seminary", type: "generic"[\s\S]*?excludeTitleFilter: "\^Adjunct Faculty\$"/);
  assert.match(serverSource, /Gordon College", type: "gordon-faculty"/);
  assert.match(serverSource, /Gordon-Conwell Theological Seminary", type: "adp"/);
  assert.match(serverSource, /Grace College and Theological Seminary", type: "generic"/);

  for (const name of [
    "Garrett-Evangelical Theological Seminary",
    "Gordon College",
    "Gordon-Conwell Theological Seminary",
    "Grace College and Theological Seminary",
  ]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("private G routes preserve source-specific safeguards", () => {
  const maDispatcher = serverSource.match(/async function scrapeMaPrivate[\s\S]*?async function scrapeGordonFacultyAs/);
  const ilDispatcher = serverSource.match(/async function scrapeIlAll[\s\S]*?async function scrapeEiuJobs/);
  assert.ok(maDispatcher);
  assert.ok(ilDispatcher);
  assert.match(maDispatcher[0], /type === "adp"/);
  assert.match(maDispatcher[0], /type === "gordon-faculty"/);
  assert.match(ilDispatcher[0], /excludeTitleFilter/);
  assert.match(serverSource, /export async function scrapeGordonFacultyAs/);
  assert.match(serverSource, /document\.querySelectorAll\("h5"\)/);
});

test("live validation records four newly covered institutions", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 7);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
  assert.equal(validation.results.find((row) => row.name.startsWith("Garrett-"))?.facultyJobCount, 0);
});
