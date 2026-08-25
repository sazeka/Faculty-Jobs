import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = read("generated/california-faith-health-universities-validation.json");
const milestone = read("generated/california-faith-health-universities-milestone.json");
const master = read("data/institutions-master.json");
const overrides = read("data/career-url-overrides.json");
const names = [
  "Vanguard University of Southern California",
  "Life Chiropractic College West",
  "Hope International University",
  "San Diego Christian College",
  "Westminster Theological Seminary in California",
];

test("five California controls retain exact source and campus safeguards", () => {
  assert.match(server, /Vanguard University of Southern California[\s\S]{0,260}type: "vanguard"/);
  assert.match(server, /Life Chiropractic College West[\s\S]{0,220}type: "life-west-ca"/);
  assert.match(server, /San Diego Christian College[\s\S]{0,180}sdcc\.edu\/employment/);
  const vanguard = server.match(/export async function scrapeVanguardFacultyAs[\s\S]*?export async function scrapeLifeWestCaliforniaAs/);
  assert.match(vanguard?.[0] || "", /fsLoadMoreButton/);
  assert.match(vanguard?.[0] || "", /a\.fsPostLink/);
  assert.match(vanguard?.[0] || "", /R_ID/);
  const lifeWest = server.match(/export async function scrapeLifeWestCaliforniaAs[\s\S]*?\/\/ AcademicJobsOnline/);
  assert.match(lifeWest?.[0] || "", /Hayward/);
  const dispatcher = server.match(/async function scrapeCaPrivate[\s\S]*?\/\* ===== Generic/);
  assert.match(dispatcher?.[0] || "", /type === "vanguard"/);
  assert.match(dispatcher?.[0] || "", /type === "life-west-ca"/);
});

test("all five sources are covered with fail-closed live evidence", () => {
  assert.equal(validation.validatedCount, 5);
  assert.equal(validation.invalidJobCount, 0);
  assert.equal(validation.forbiddenTitleCount, 0);
  assert.equal(milestone.appliedCount, 5);
  assert.equal(milestone.newlyCoveredCount, 5);
  const vanguard = validation.results.find((row) => row.name === "Vanguard University of Southern California");
  assert.ok(vanguard?.currentFacultyJobCount >= 1);
  const lifeWest = validation.results.find((row) => row.name === "Life Chiropractic College West");
  assert.ok(lifeWest?.currentFacultyJobCount >= 1);
  assert.ok(lifeWest.sampleTitles.every((title) => /Hayward,\s*CA/i.test(title)));
  for (const name of ["Hope International University", "San Diego Christian College", "Westminster Theological Seminary in California"]) {
    assert.equal(validation.results.find((row) => row.name === name)?.healthyZero, true);
  }
  for (const name of names) {
    const result = validation.results.find((row) => row.name === name);
    assert.equal(result?.healthySource, true);
    assert.equal(overrides.overrides.find((row) => row.name === name)?.career_url, result.url);
    assert.equal(master.institutions.find((row) => row.name === name)?.coverage_status, "covered");
  }
});
