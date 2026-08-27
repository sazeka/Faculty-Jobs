import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { parseLebanonValleyFacultyJobs, parseLenoirRhyneFacultyJobs } from "../../server.js";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-l-specialty-employee-sources-validation.json", import.meta.url), "utf8")
);

test("Lebanon Valley requires ADP-backed faculty headings and rejects explicit part-time blocks", () => {
  const html = `
    <h4>Assistant Professor of Accounting</h4>
    <p>Full-time role. Apply through <a href="https://workforcenow.adp.com/recruitment.html?jobId=1&amp;source=CC2">Career Center</a>.</p>
    <h4>Clinical Adjunct Instructor</h4>
    <p>This part-time contract role uses <a href="https://workforcenow.adp.com/recruitment.html?jobId=2">ADP</a>.</p>
    <h4>Faculty Handbook</h4><p><a href="/handbook.pdf">Read it</a></p>`;
  const jobs = parseLebanonValleyFacultyJobs(html, "https://www.lvc.edu/human-resources/employment/faculty-openings/");
  assert.deepEqual(jobs.map((job) => job.title), ["Assistant Professor of Accounting"]);
  assert.equal(jobs[0].url, "https://workforcenow.adp.com/recruitment.html?jobId=1&source=CC2");
});

test("Lenoir-Rhyne stays inside current faculty groups and excludes part-time-titled cards", () => {
  const html = `
    <p>Listed below are all current adjunct faculty position openings at Lenoir-Rhyne University.</p>
    <h5>Hickory</h5><ul>
      <li><a href="/work-at-lr/mathematics">Mathematics</a></li>
      <li><a href="/work-at-lr/business" title="Part-time Faculty, College of Business">Business</a></li>
      <li><a href="https://outside.example/job">Outside Faculty</a></li>
    </ul>`;
  const jobs = parseLenoirRhyneFacultyJobs(html, "https://www.lr.edu/work-at-lr/open-adjunct-faculty-positions");
  assert.deepEqual(jobs.map((job) => job.title), ["Adjunct Faculty - Mathematics"]);
  assert.equal(jobs[0].location, "Hickory, NC");
});

test("four additional L institutions use scoped official employee controls", () => {
  assert.match(serverSource, /Lake Superior College", type: "workday"[\s\S]*?Institution=a7c1912089511000d545d78218ff0000/);
  assert.match(serverSource, /Lebanon Valley College", type: "lvc-faculty"/);
  assert.match(serverSource, /Lenoir-Rhyne University", type: "lr-faculty"/);
  assert.match(serverSource, /Liberty University", type: "workday"[\s\S]*?lu_job_board_faculty/);
  assert.match(serverSource.match(/async function scrapeNcAll[\s\S]*?async function scrapeVaAll/)[0], /type === "lr-faculty"[\s\S]*?scrapeLenoirRhyneFacultyAs/);
  assert.match(serverSource.match(/async function scrapePaAll[\s\S]*?async function scrapeMiAll/)[0], /type === "lvc-faculty"[\s\S]*?scrapeLebanonValleyFacultyAs/);

  for (const name of ["Lake Superior College", "Lebanon Valley College", "Lenoir-Rhyne University", "Liberty University"]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("live validation records four newly covered institutions", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 56);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
});
