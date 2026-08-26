import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { parseKentuckyChristianFacultyJobs, parseKuyperFacultyJobs } from "../../server.js";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-k-specialty-employee-sources-validation.json", import.meta.url), "utf8")
);

test("Kentucky Christian accepts only university-employer faculty cards", () => {
  const html = `
    <li class="post-1 type-job_listing job_listing"><a href="https://www.kcu.edu/job/faculty/"><h3>Assistant Professor of Bible</h3><div class="company"><strong>Kentucky Christian University</strong></div></a></li>
    <li class="post-2 type-job_listing job_listing"><a href="https://www.kcu.edu/job/church/"><h3>Teaching Pastor</h3><div class="company"><strong>Outside Church</strong></div></a></li>
    <li class="post-3 type-job_listing job_listing"><a href="https://www.kcu.edu/job/custodian/"><h3>Custodian</h3><div class="company"><strong>Kentucky Christian University</strong></div></a></li>`;
  const jobs = parseKentuckyChristianFacultyJobs(html);
  assert.deepEqual(jobs.map((job) => job.title), ["Assistant Professor of Bible"]);
});

test("Kuyper accepts only exact college-employer faculty cards", () => {
  const html = `
    <details class="item"><div>Title: Professor of Business<br /> Organization: Kuyper College<br /> Location: Grand Rapids<br /><a href="/faculty.pdf">here</a></div></details>
    <details class="item"><div>Title: Professor of Ministry<br /> Organization: Outside Seminary<br /> Location: Elsewhere<br /><a href="/outside.pdf">here</a></div></details>`;
  const jobs = parseKuyperFacultyJobs(html, "https://www.kuyper.edu/employment/");
  assert.deepEqual(jobs.map((job) => job.title), ["Professor of Business"]);
  assert.equal(jobs[0].url, "https://www.kuyper.edu/faculty.pdf");
});

test("four additional K institutions use exact official employee controls", () => {
  assert.match(serverSource, /Kansas Health Science University", type: "workday"[\s\S]*?myworkdayjobs\.com\/KHSC/);
  assert.match(serverSource, /Kentucky Christian University", type: "kcu-job-manager"[\s\S]*?kcu\.edu\/job-postings/);
  assert.match(serverSource, /Kuyper College", type: "kuyper-employment"[\s\S]*?kuyper\.edu\/employment/);
  assert.equal((serverSource.match(/campus: "Kentucky State University"[\s\S]{0,300}?type: "adp"/g) || []).length, 2);
  assert.match(serverSource, /ccId=2641351383_637/);
  assert.match(serverSource, /ccId=168064444822_5603/);

  for (const name of ["Kansas Health Science University", "Kentucky Christian University", "Kentucky State University", "Kuyper College"]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("live validation records four newly covered institutions", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 38);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
});
