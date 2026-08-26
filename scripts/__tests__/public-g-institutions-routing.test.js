import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/public-g-institutions-validation.json", import.meta.url), "utf8")
);

test("four public G institutions use institution-scoped hiring systems", () => {
  assert.match(serverSource, /Georgia Institute of Technology-Main Campus[\s\S]*?SiteId=03000/);
  assert.match(serverSource, /Georgia Military College", type: "paycom"/);
  assert.match(serverSource, /Glenville State University", type: "schooljobs"/);
  assert.match(serverSource, /Great Basin College", type: "workday"/);

  for (const name of [
    "Georgia Institute of Technology-Main Campus",
    "Georgia Military College",
    "Glenville State University",
    "Great Basin College",
  ]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("OneUSG site portals click through the welcome page and reject known false positives", () => {
  const helper = serverSource.match(/async function scrapeUsgPortalRows[\s\S]*?async function scrapeUsgFaculty/);
  assert.ok(helper);
  assert.match(helper[0], /getByText\("View All Jobs", \{ exact: true \}\)/);
  assert.match(serverSource, /excludeTitleFilter: "\^\(\?:Faculty Support Coordinator\\\\b\|Dummy Faculty Job Code\$\)"/);
  assert.match(serverSource, /scrapeUsgSiteAs\(context, url, campus, "GA", excludeTitleFilter\)/);
});

test("state dispatchers include the new platform routes", () => {
  const wvDispatcher = serverSource.match(/async function scrapeWvAll[\s\S]*?async function scrapeGaAll/);
  const gaDispatcher = serverSource.match(/async function scrapeGaAll[\s\S]*?async function scrapeAlAll/);
  assert.ok(wvDispatcher);
  assert.ok(gaDispatcher);
  assert.match(wvDispatcher[0], /type === "schooljobs"/);
  assert.match(gaDispatcher[0], /type === "usg-site"/);
});

test("live validation records four newly covered institutions", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 55);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
  assert.equal(validation.results.find((row) => row.name.startsWith("Georgia Institute"))?.facultyJobCount, 40);
});
