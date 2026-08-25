import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseStBernardsFacultyJobs } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = read("generated/new-york-specialized-colleges-validation.json");
const milestone = read("generated/new-york-specialized-colleges-milestone.json");
const master = read("data/institutions-master.json");
const overrides = read("data/career-url-overrides.json");
const names = [
  "Hebrew Union College-Jewish Institute of Religion",
  "Wagner College",
  "St Bernard's School of Theology and Ministry",
];

test("St. Bernard's parser emits only the exact institution section", () => {
  const html = `<h4><strong>St. Bernard's Faculty Search\nVisiting Faculty Position (Open Rank)</strong></h4><p>St. Bernard’s School of Theology and Ministry is seeking applications for a full-time, non-tenure track faculty position.</p><h4>Community Instructor</h4><p>External school role</p>`;
  const jobs = parseStBernardsFacultyJobs(html, "https://stbernards.edu/job-postings", names[2], "NY");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, "https://stbernards.edu/job-postings");
  assert.doesNotMatch(jobs[0].description, /External school role/);
  assert.deepEqual(parseStBernardsFacultyJobs("<h4>Community Instructor</h4>", "https://stbernards.edu/job-postings", names[2], "NY"), []);
});

test("three specialized controls use exact production routes", () => {
  for (const name of names) assert.match(server, new RegExp(`campus: "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(server, /Hebrew Union College[\s\S]{0,360}727c7840-07f6-4cdf-b2dc-29819ba3b3ca/);
  assert.match(server, /Wagner College[\s\S]{0,360}oracle-cloud-api/);
  assert.match(server, /St Bernard's School[\s\S]{0,300}stbernards-faculty/);
  const dispatcher = server.match(/async function scrapeNyPrivate[\s\S]*?\/\/ Paycom scraper/);
  assert.match(dispatcher?.[0] || "", /type === "stbernards-faculty"/);
});

test("all three live controls are applied without weakening healthy-zero evidence", () => {
  assert.equal(validation.validatedCount, 3);
  assert.equal(validation.invalidJobCount, 0);
  assert.equal(validation.currentFacultyJobCount, 6);
  assert.equal(milestone.appliedCount, 3);
  assert.equal(milestone.newlyCoveredCount, 3);
  const huc = validation.results.find((row) => row.name.startsWith("Hebrew Union"));
  assert.ok(huc.rawBoardJobCount >= 1);
  for (const result of validation.results) {
    assert.equal(result.healthySource, true);
    assert.equal(overrides.overrides.find((row) => row.name === result.name)?.career_url, result.url);
    assert.equal(master.institutions.find((row) => row.name === result.name)?.coverage_status, "covered");
  }
});
