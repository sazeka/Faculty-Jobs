import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-g-institutions-validation.json", import.meta.url), "utf8")
);

test("next four G institutions use official scoped employee sources", () => {
  assert.match(serverSource, /Graceland University-Lamoni", type: "oracle-cx"[\s\S]*?selectedCategoriesFacet=300000009203194/);
  assert.match(serverSource, /Guilford College", type: "workday", url: "https:\/\/guilford\.wd1\.myworkdayjobs\.com\/Guilford_Careers"/);
  assert.match(serverSource, /Graduate Theological Union", type: "generic", url: "https:\/\/www\.gtu\.edu\/about\/employment"/);
  assert.match(serverSource, /Great Northern University", type: "generic", url: "https:\/\/gnu\.edu\/about\/employment\/faculty-positions\/"/);

  for (const name of [
    "Graceland University-Lamoni",
    "Guilford College",
    "Graduate Theological Union",
    "Great Northern University",
  ]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("state dispatchers support the selected ATS routes", () => {
  const iaDispatcher = serverSource.match(/async function scrapeIaAll[\s\S]*?async function scrapeWyAll/);
  const ncDispatcher = serverSource.match(/async function scrapeNcAll[\s\S]*?async function scrapeVaAll/);
  assert.ok(iaDispatcher);
  assert.ok(ncDispatcher);
  assert.match(iaDispatcher[0], /type === "oracle-cx"/);
  assert.match(ncDispatcher[0], /type === "workday"/);
  assert.match(serverSource, /export async function scrapeOracleCxAs/);
});

test("live validation records four newly covered institutions", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 10);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
  assert.equal(validation.results.filter((row) => row.facultyJobCount === 0).length, 2);
});
