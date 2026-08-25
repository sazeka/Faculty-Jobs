import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = read("generated/california-mainstream-universities-validation.json");
const milestone = read("generated/california-mainstream-universities-milestone.json");
const master = read("data/institutions-master.json");
const overrides = read("data/career-url-overrides.json");
const names = ["Loyola Marymount University", "Pepperdine University"];

test("California controls retain their exact faculty facets", () => {
  assert.match(server, /Loyola Marymount University[\s\S]{0,320}jobFamilyGroup=203baa23bdff01ca267c14ea190e2e97/);
  assert.match(server, /Pepperdine University[\s\S]{0,500}dropdown_field_1_uids%5B%5D=6ca14a4d12d8dc1eb17fa054d2411e33/);
  assert.match(server, /Pepperdine University[\s\S]{0,500}dropdown_field_3_uids%5B%5D=dcaa7a03ab89b8b42952f428d59046b3/);
});

test("both live controls are applied with valid institution-scoped jobs", () => {
  assert.equal(validation.validatedCount, 2);
  assert.equal(validation.invalidJobCount, 0);
  assert.ok(validation.currentFacultyJobCount >= 2);
  assert.equal(milestone.appliedCount, 2);
  assert.equal(milestone.newlyCoveredCount, 2);
  for (const name of names) {
    const result = validation.results.find((row) => row.name === name);
    assert.equal(result?.healthySource, true);
    assert.ok(result.currentFacultyJobCount >= 1);
    assert.equal(overrides.overrides.find((row) => row.name === name)?.career_url, result.url);
    assert.equal(master.institutions.find((row) => row.name === name)?.coverage_status, "covered");
  }
});
