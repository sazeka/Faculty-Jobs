import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = read("generated/california-specialized-universities-validation.json");
const milestone = read("generated/california-specialized-universities-milestone.json");
const master = read("data/institutions-master.json");
const overrides = read("data/career-url-overrides.json");
const names = [
  "Southwestern Law School",
  "San Francisco Conservatory of Music",
  "Southern California Institute of Architecture",
];

test("specialized California controls retain exact employer safeguards", () => {
  assert.match(server, /Southwestern Law School[\s\S]{0,180}type: "southwestern-law"/);
  assert.match(server, /San Francisco Conservatory of Music[\s\S]{0,300}a77350b7-382e-4ebc-be83-5ce68f2b9d07/);
  assert.match(server, /Southern California Institute of Architecture[\s\S]{0,220}sciarc\.edu\/institution\/resources\/careers/);
  const parser = server.match(/export async function scrapeSouthwesternLawFacultyAs[\s\S]*?\/\/ AcademicJobsOnline/);
  assert.match(parser?.[0] || "", /\^\\\/employment-sw\\\/\[\^\/\]\+/);
  assert.match(parser?.[0] || "", /seenTitles/);
  assert.match(parser?.[0] || "", /professor/);
  const dispatcher = server.match(/async function scrapeCaPrivate[\s\S]*?\/\* ===== Generic/);
  assert.match(dispatcher?.[0] || "", /type === "southwestern-law"/);
});

test("all three sources are covered with current fail-closed evidence", () => {
  assert.equal(validation.validatedCount, 3);
  assert.equal(validation.invalidJobCount, 0);
  assert.equal(validation.forbiddenTitleCount, 0);
  assert.equal(milestone.appliedCount, 3);
  assert.equal(milestone.newlyCoveredCount, 3);
  const southwestern = validation.results.find((row) => row.name === "Southwestern Law School");
  assert.ok(southwestern?.currentFacultyJobCount >= 1);
  assert.ok(southwestern.sampleTitles.every((title) => /professor|tenure[- ]track/i.test(title)));
  const sfcm = validation.results.find((row) => row.name === "San Francisco Conservatory of Music");
  assert.ok(sfcm?.currentFacultyJobCount >= 1);
  const sciArc = validation.results.find((row) => row.name === "Southern California Institute of Architecture");
  assert.equal(sciArc?.healthyZero, true);
  for (const name of names) {
    const result = validation.results.find((row) => row.name === name);
    assert.equal(result?.healthySource, true);
    assert.equal(overrides.overrides.find((row) => row.name === name)?.career_url, result.url);
    assert.equal(master.institutions.find((row) => row.name === name)?.coverage_status, "covered");
  }
});
