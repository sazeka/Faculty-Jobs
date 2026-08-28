import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-vz-employee-sources-validation.json", import.meta.url), "utf8")
);

const expected = [
  "Valley City State University",
  "Virginia Union University",
  "Virginia Wesleyan University",
  "Walla Walla University",
  "Warner Pacific University",
  "Weatherford College",
  "Wheaton College",
  "Wheaton College (Massachusetts)",
  "Wilkes University",
  "Wisconsin Lutheran College",
  "Xavier University",
];

test("V through Z institutions route to verified official employee sources", () => {
  for (const name of expected) {
    assert.match(serverSource, new RegExp(`campus: "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }

  assert.match(serverSource, /Weatherford College"[\s\S]*?865%5B%5D=5[\s\S]*?865%5B%5D=3[\s\S]*?Executive Vice President/);
  assert.match(serverSource, /Wheaton College \(Massachusetts\)"[\s\S]*?365%5B%5D=3/);
});

test("state dispatchers and custom parsers preserve exact faculty scope", () => {
  const va = serverSource.match(/async function scrapeVaAll[\s\S]*?async function scrapeScAll/)[0];
  const tx = serverSource.match(/async function scrapeTxAll[\s\S]*?async function scrapeFlAll/)[0];
  assert.match(va, /type === "adp"[\s\S]*?scrapeAdpAs/);
  assert.match(va, /type === "oracle-cx"[\s\S]*?scrapeOracleCxAs/);
  assert.match(tx, /type === "peopleadmin"[\s\S]*?excludeTitleFilter[\s\S]*?new RegExp/);
  assert.match(serverSource, /export async function scrapeVcsuAcademicAs[\s\S]*?hasText: \/\^Academic\$\/[\s\S]*?tbody tr/);
  assert.match(serverSource, /export async function scrapeWallaWallaFacultyAs[\s\S]*?Faculty Positions Available[\s\S]*?Nursing Clinical Instructor Positions Available/);
  assert.match(serverSource, /export async function scrapeWarnerPacificFacultyAs[\s\S]*?a\.table-row\[href\][\s\S]*?\.title-cell/);
  assert.match(serverSource, /export async function scrapeWlcFacultyAs[\s\S]*?page\.locator\("h3"\)[\s\S]*?\\bFACULTY\\b/);
});

test("live validation records eleven newly covered V through Z institutions", () => {
  assert.equal(validation.newlyCoveredCount, 11);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 11);
  assert.equal(validation.facultyJobCount, 179);
  assert.deepEqual(validation.letterCounts, {
    V: { newlyCoveredCount: 3, facultyJobCount: 15 },
    W: { newlyCoveredCount: 7, facultyJobCount: 151 },
    X: { newlyCoveredCount: 1, facultyJobCount: 13 },
    Y: { newlyCoveredCount: 0, facultyJobCount: 0 },
    Z: { newlyCoveredCount: 0, facultyJobCount: 0 },
  });
  assert.equal(validation.results.length, 11);
  assert.equal(validation.results.reduce((sum, result) => sum + result.facultyJobCount, 0), 179);
  for (const result of validation.results) assert.equal(result.healthySource, true);
});
