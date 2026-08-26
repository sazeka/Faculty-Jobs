import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-j-specialty-employee-sources-validation.json", import.meta.url), "utf8")
);

test("four specialty institutions use exact official employee sources", () => {
  assert.match(serverSource, /John Paul the Great Catholic University", type: "generic"[\s\S]*?jpcatholic\.edu\/JPadmin\/jpopenings\.php/);
  assert.match(serverSource, /Johnson University", type: "generic"[\s\S]*?johnsonu\.edu\/employment-opportunities/);
  assert.match(serverSource, /Johnson & Wales University-Online",[\s\S]*?type: "pageup-campus"[\s\S]*?locationFilter: "Non-Campus Location"/);
  assert.match(serverSource, /Institute of Buddhist Studies",[\s\S]*?excludeTitleFilter:[\s\S]*?Yoshitaka Tamai Professor/);

  for (const name of [
    "John Paul the Great Catholic University",
    "Johnson University",
    "Johnson & Wales University-Online",
    "Institute of Buddhist Studies",
  ]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("JWU campus identities use exact PageUp locations and no stale faculty URL", () => {
  const nc = serverSource.match(/async function scrapeNcAll[\s\S]*?async function scrapeVaAll/);
  const ri = serverSource.match(/async function scrapeRiAll[\s\S]*?async function scrapeNhAll/);
  assert.ok(nc);
  assert.ok(ri);
  assert.match(nc[0], /type === "pageup-campus"[\s\S]*?scrapePageUpCampusAs/);
  assert.match(ri[0], /type === "pageup-campus"[\s\S]*?scrapePageUpCampusAs/);
  assert.match(serverSource, /Johnson & Wales University-Charlotte",[\s\S]*?locationFilter: "Charlotte, North Carolina"/);
  assert.match(serverSource, /Johnson & Wales University-Providence",[\s\S]*?locationFilter: "Providence, Rhode Island"/);
  assert.doesNotMatch(serverSource, /jwu\.edu\/faculty\/jobs/);
});

test("live validation records four newly covered institutions and two repaired controls", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 5);
  assert.equal(validation.results.length, 4);
  assert.equal(validation.repairedExistingControls.length, 2);
  for (const result of validation.results) assert.equal(result.healthySource, true);
  assert.equal(validation.results.find((row) => row.name === "Institute of Buddhist Studies").facultyJobCount, 0);
});
