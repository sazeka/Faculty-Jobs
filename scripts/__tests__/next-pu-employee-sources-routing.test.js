import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-pu-employee-sources-validation.json", import.meta.url), "utf8")
);

const expected = [
  "Pacific Union College",
  "Paine College",
  "Plymouth State University",
  "Quincy University",
  "Roosevelt University",
  "Ringling College of Art and Design",
  "Saginaw Valley State University",
  "Sam Houston State University",
  "Tennessee Technological University",
  "Texas Southern University",
  "Troy University",
  "University of Kentucky",
  "University of West Florida",
  "University of Dallas",
];

test("P through U institutions route to verified official employee sources", () => {
  for (const name of expected) {
    assert.match(serverSource, new RegExp(`campus: "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }

  assert.match(serverSource, /Plymouth State University"[\s\S]*?locations=1ec6efc4979310011704b2725e0c0000[\s\S]*?Receiving Mail Clerk/);
  assert.match(serverSource, /Roosevelt University"[\s\S]*?query_position_type_id%5B%5D=2[\s\S]*?query_position_type_id%5B%5D=3/);
  assert.match(serverSource, /Sam Houston State University"[\s\S]*?query_position_type_id=2/);
  assert.match(serverSource, /Texas Southern University"[\s\S]*?810%5B%5D=7/);
  assert.match(serverSource, /Troy University"[\s\S]*?3481=3/);
  assert.match(serverSource, /University of Kentucky"[\s\S]*?988=2/);
});

test("state dispatchers and the Quincy parser preserve exact faculty scope", () => {
  const nh = serverSource.match(/async function scrapeNhAll[\s\S]*?async function scrapeVtAll/)[0];
  const il = serverSource.match(/async function scrapeIlAll[\s\S]*?async function scrapeEiuJobs/)[0];
  const tn = serverSource.match(/async function scrapeTnAll[\s\S]*?async function scrapeAkAll/)[0];
  assert.match(nh, /excludeTitleFilter[\s\S]*?new RegExp/);
  assert.match(il, /quincy-faculty[\s\S]*?scrapeQuincyFacultyAs/);
  assert.match(tn, /oracle-cx[\s\S]*?scrapeOracleCxAs/);
  assert.match(serverSource, /export async function scrapeQuincyFacultyAs[\s\S]*?closest\("\.paragraph-widget"\)\?\.nextElementSibling[\s\S]*?querySelectorAll\("summary"\)/);
});

test("live validation records fourteen newly covered P through U institutions", () => {
  assert.equal(validation.newlyCoveredCount, 14);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 14);
  assert.equal(validation.facultyJobCount, 480);
  assert.deepEqual(validation.letterCounts, {
    P: { newlyCoveredCount: 3, facultyJobCount: 8 },
    Q: { newlyCoveredCount: 1, facultyJobCount: 2 },
    R: { newlyCoveredCount: 2, facultyJobCount: 21 },
    S: { newlyCoveredCount: 2, facultyJobCount: 92 },
    T: { newlyCoveredCount: 3, facultyJobCount: 64 },
    U: { newlyCoveredCount: 3, facultyJobCount: 293 },
  });
  assert.equal(validation.results.length, 14);
  assert.equal(validation.results.reduce((sum, result) => sum + result.facultyJobCount, 0), 480);
  for (const result of validation.results) assert.equal(result.healthySource, true);
});
