import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { parseLcoFacultyJobs, parseLeeFacultyJobs } from "../../server.js";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-l-employee-sources-validation.json", import.meta.url), "utf8")
);

test("LCO parser captures its faculty pool without treating policy links as jobs", () => {
  const html = `
    <a href="/faculty-credentialing-standards.pdf">Faculty Credentialing Standards</a>
    <p><strong>Adjunct Faculty (Open Applicant Pool for All Disciplines for <u>In-person Instruction</u>)</strong></p>`;
  const jobs = parseLcoFacultyJobs(html, "https://www.lco.edu/employment");
  assert.deepEqual(jobs.map((job) => job.title), [
    "Adjunct Faculty (Open Applicant Pool for All Disciplines for In-person Instruction)",
  ]);
  assert.equal(jobs[0].url, "https://www.lco.edu/employment");
});

test("Lee parser requires faculty job cards and rejects part-time and navigation links", () => {
  const html = `
    <li class="post-1 job_listing job-type-faculty job-type-full-time"><a href="https://lee.example/accounting"><h3>FACULTY POSITION IN ACCOUNTING</h3></a></li>
    <li class="post-2 job_listing job-type-staff job-type-full-time"><a href="https://lee.example/staff"><h3>Faculty Records Administrator</h3></a></li>
    <li class="post-3 job_listing job-type-faculty job-type-part-time"><a href="https://lee.example/nursing"><h3>Nursing Faculty (Part-Time)</h3></a></li>
    <a href="/faculty-application.pdf">Faculty Employment Application</a>`;
  const jobs = parseLeeFacultyJobs(html);
  assert.deepEqual(jobs.map((job) => job.title), ["Faculty Position in Accounting"]);
});

test("four L institutions use scoped official employee controls", () => {
  assert.match(serverSource, /Lane Community College",[\s\S]*?type: "peopleadmin"[\s\S]*?512%5B%5D=3&512%5B%5D=4/);
  assert.match(serverSource, /Landmark College",[\s\S]*?employment\/category\/faculty/);
  assert.match(serverSource, /Lac Courte Oreilles Ojibwe University",[\s\S]*?type: "lco-employment"/);
  assert.match(serverSource, /Lee University",[\s\S]*?type: "lee-job-manager"/);
  assert.match(serverSource.match(/async function scrapeWiAll[\s\S]*?async function scrapeMtAll/)[0], /type === "lco-employment"[\s\S]*?scrapeLcoFacultyAs/);
  assert.match(serverSource.match(/async function scrapeTnAll[\s\S]*?async function scrapeAkAll/)[0], /type === "lee-job-manager"[\s\S]*?scrapeLeeFacultyAs/);

  for (const name of ["Lac Courte Oreilles Ojibwe University", "Landmark College", "Lane Community College", "Lee University"]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("live validation records four newly covered institutions", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 11);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
});
