import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractMooreTechFacultyJobsFromHtml } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));

test("Moore Tech hiring news keeps faculty postings and rejects administrative hiring", () => {
  const html = `
    <a href="/news/posts/instructor">Moore Tech Hiring: Industrial Electricity Instructor</a>
    <a href="/news/posts/faculty">Moore Tech Hiring: Two Full-Time Faculty Positions</a>
    <a href="/news/posts/admin">Moore Tech Hiring: Admissions/Registration Advisor</a>
    <a href="/news/posts/part-time">Moore Tech Hiring: Part-Time Welding Instructor</a>
    <a href="/news/posts/instructor">Read More</a>
  `;
  const jobs = extractMooreTechFacultyJobsFromHtml(html, "https://www.mooretech.edu/news");
  assert.deepEqual(jobs.map((job) => job.title), ["Industrial Electricity Instructor", "Two Full-Time Faculty Positions"]);
  assert.ok(jobs.every((job) => job.college === "William R Moore College of Technology"));
});

test("both requested closeout groups are fully accounted for", () => {
  const report = readJson("generated/private-specialty-closeout-report.json");
  const master = readJson("data/institutions-master.json").institutions;
  const rules = readJson("data/policy-rules.json").institutionOverrides;
  const byName = new Map(master.map((row) => [row.name, row]));

  assert.equal(report.careerTechnicalReviewed, 11);
  assert.equal(report.seminariesAndAffiliatesReviewed, 12);
  assert.equal(report.reviewed, 23);
  assert.equal(report.accepted + report.excluded + report.activeUnresolved, report.reviewed);

  for (const source of report.acceptedSources) {
    assert.equal(byName.get(source.name)?.coverage_status, "covered", source.name);
    assert.equal(byName.get(source.name)?.career_url, source.career_url, source.name);
  }
  for (const excluded of report.policyExclusions) {
    assert.equal(rules[excluded.name]?.action, "exclude", excluded.name);
    assert.deepEqual(rules[excluded.name]?.sources, excluded.sources, excluded.name);
  }
});
