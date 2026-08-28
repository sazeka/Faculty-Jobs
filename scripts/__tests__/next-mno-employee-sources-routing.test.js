import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-mno-employee-sources-validation.json", import.meta.url), "utf8")
);

const expected = [
  "Medical University of South Carolina",
  "Mercer University",
  "Mississippi State University",
  "Missouri Southern State University",
  "Morningside University",
  "New Mexico Institute of Mining and Technology",
  "Newman University",
  "Northeastern State University",
  "Northwest Florida State College",
  "Odessa College",
  "Oklahoma Baptist University",
  "Oklahoma Wesleyan University",
  "Ozarks Technical Community College",
];

test("M through O institutions route to official employee sources", () => {
  for (const name of expected) {
    assert.match(serverSource, new RegExp(`campus: "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }

  assert.match(serverSource, /Mississippi State University", type: "pageup"[\s\S]*?explore\.msujobs\.msstate\.edu\/cw\/en-us\/listing/);
  assert.match(serverSource, /Odessa College", type: "peopleadmin"[\s\S]*?1670%5B%5D=1/);
  assert.match(serverSource, /Northwest Florida State College", type: "interviewexchange"[\s\S]*?531NFM1/);
  assert.match(serverSource, /Ozarks Technical Community College", type: "pageup"[\s\S]*?pageuppeople\.com\/880/);
});

test("state dispatchers include the newly required adapters and safeguards", () => {
  assert.match(serverSource.match(/async function scrapeMsAll[\s\S]*?export function southernSystemCampusFromTitle/)[0], /type === "pageup"[\s\S]*?scrapePageUpAs/);
  assert.match(serverSource.match(/async function scrapeMoAll[\s\S]*?async function scrapeKyAll/)[0], /type === "pageup"[\s\S]*?scrapePageUpAs/);
  assert.match(serverSource.match(/async function scrapeNmAll[\s\S]*?async function scrapeNvAll/)[0], /excludeTitleFilter[\s\S]*?new RegExp/);
  assert.match(serverSource.match(/async function scrapeFlAll[\s\S]*?async function scrapeTaleoAs/)[0], /type === "interviewexchange"[\s\S]*?scrapeInterviewExchangeAs/);
});

test("live validation records thirteen newly covered M through O institutions", () => {
  assert.equal(validation.newlyCoveredCount, 13);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 13);
  assert.equal(validation.facultyJobCount, 177);
  assert.deepEqual(validation.letterCounts, {
    M: { newlyCoveredCount: 5, facultyJobCount: 118 },
    N: { newlyCoveredCount: 4, facultyJobCount: 13 },
    O: { newlyCoveredCount: 4, facultyJobCount: 46 },
  });
  assert.equal(validation.results.length, 13);
  for (const result of validation.results) assert.equal(result.healthySource, true);
});
