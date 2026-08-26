import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-h-employee-sources-validation.json", import.meta.url), "utf8")
);

test("four additional institutions use exact official employee sources", () => {
  assert.match(serverSource, /Houston Christian University", type: "generic"[\s\S]*?hc\.edu\/about-hcu\/campus-resources\/job-opportunities/);
  assert.match(serverSource, /Houston Community College", type: "selectminds-faculty-saved-search"[\s\S]*?hccs\.referrals\.selectminds\.com/);
  assert.match(serverSource, /Howard Payne University", type: "generic"[\s\S]*?hputx\.edu\/campus-offices\/human-resources\/open-positions/);
  assert.match(serverSource, /Huston-Tillotson University", type: "paycom"[\s\S]*?clientkey=E3C84A4796E238298FDC7FBE2CE0C62C/);

  for (const name of ["Houston Christian University", "Houston Community College", "Howard Payne University", "Huston-Tillotson University"]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("Texas dispatcher reaches the selected ATS routes", () => {
  const txDispatcher = serverSource.match(/async function scrapeTxAll[\s\S]*?async function scrapeFlAll/);
  assert.ok(txDispatcher);
  assert.match(txDispatcher[0], /type === "selectminds-faculty-saved-search"/);
  assert.match(txDispatcher[0], /type === "paycom"/);
  assert.match(txDispatcher[0], /type === "generic"/);
});

test("live validation records four newly covered institutions", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 4);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
  assert.equal(validation.results.filter((row) => row.facultyJobCount === 0).length, 3);
  assert.equal(validation.results.filter((row) => row.botBlocked).length, 1);
});
