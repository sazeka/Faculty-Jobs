import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-i-employee-sources-validation.json", import.meta.url), "utf8")
);

test("four additional institutions use exact official employee sources", () => {
  assert.match(serverSource, /Iliff School of Theology",[\s\S]*?iliff\.edu\/about\/career-opportunities/);
  assert.match(serverSource, /Illinois College of Optometry",[\s\S]*?workforcenow\.adp\.com[\s\S]*?9a5d9078-a7f4-44dd-ab39-0a99d4ed592e/);
  assert.match(serverSource, /Illinois Institute of Technology",[\s\S]*?iit\.edu\/hr\/careers/);
  assert.match(serverSource, /Illinois Wesleyan University",[\s\S]*?iwu\.edu\/human-resources\/job-openings/);

  for (const name of ["Iliff School of Theology", "Illinois College of Optometry", "Illinois Institute of Technology", "Illinois Wesleyan University"]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("Colorado and Illinois dispatchers preserve source-specific routing and exclusions", () => {
  const coDispatcher = serverSource.match(/async function scrapeCoAll[\s\S]*?async function scrapeOhAll/);
  const ilDispatcher = serverSource.match(/async function scrapeIlAll[\s\S]*?async function scrapeEiuJobs/);
  assert.ok(coDispatcher);
  assert.ok(ilDispatcher);
  assert.match(coDispatcher[0], /excludeTitleFilter/);
  assert.match(ilDispatcher[0], /type === "adp"/);
  assert.match(ilDispatcher[0], /excludeTitleFilter/);
});

test("live validation records four newly covered institutions", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 4);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
  assert.equal(validation.results.filter((row) => row.facultyJobCount === 0).length, 2);
  assert.equal(validation.results.filter((row) => row.authRestricted).length, 1);
});
