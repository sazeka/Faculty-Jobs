import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { parseKansasChristianFacultyJobs } from "../../server.js";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-k-employee-sources-validation.json", import.meta.url), "utf8")
);

test("Kansas Christian parsing stays inside the college section", () => {
  const html = `
    <h2>Available Positions at KCC</h2>
    <p><a href="/jobs/faculty-bible.pdf">Assistant Professor of Bible</a></p>
    <p><a href="/jobs/maintenance.pdf">Maintenance Associate</a></p>
    <h2>Available Positions at Overland Christian Schools</h2>
    <p><a href="/jobs/k12-teacher.pdf">Faculty Teacher - Elementary School</a></p>`;
  const jobs = parseKansasChristianFacultyJobs(html, "https://kansaschristian.edu/employment-opportunities/");
  assert.deepEqual(jobs.map((job) => job.title), ["Assistant Professor of Bible"]);
  assert.equal(jobs[0].url, "https://kansaschristian.edu/jobs/faculty-bible.pdf");
});

test("four K institutions use exact official employee controls", () => {
  assert.match(serverSource, /Kansas Christian College", type: "kansas-christian"[\s\S]*?employment-opportunities/);
  assert.match(serverSource, /Kansas City Art Institute",[\s\S]*?type: "adp"[\s\S]*?b8eda22f-d280-4db8-a8b7-bc0ed820ee60/);
  assert.match(serverSource, /Kansas City University", type: "workday"[\s\S]*?kansascity\.wd1\.myworkdayjobs\.com\/Jobs/);
  assert.match(serverSource, /Keene State College",[\s\S]*?locations=1ec6efc4979310011705058226c60000[\s\S]*?workerSubType=b4f41dd8de101000c45c0d3fc2a10001/);
  assert.match(serverSource.match(/async function scrapeKsAll[\s\S]*?async function scrapeOkAll/)[0], /type === "kansas-christian"[\s\S]*?scrapeKansasChristianFacultyAs/);

  for (const name of ["Kansas Christian College", "Kansas City Art Institute", "Kansas City University", "Keene State College"]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("live validation records four newly covered institutions", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 17);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
});
