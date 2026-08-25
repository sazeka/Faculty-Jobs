import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = read("generated/california-established-universities-validation.json");
const milestone = read("generated/california-established-universities-milestone.json");
const master = read("data/institutions-master.json");
const overrides = read("data/career-url-overrides.json");
const names = [
  "Pitzer College",
  "University of La Verne",
  "University of San Francisco",
  "Western University of Health Sciences",
  "Westmont College",
  "Samuel Merritt University",
];

test("six California controls retain exact faculty and campus safeguards", () => {
  assert.match(server, /Pitzer College[\s\S]{0,280}academicjobsonline/);
  assert.match(server, /University of La Verne[\s\S]{0,300}query_position_type_id%5B%5D=2/);
  assert.match(server, /University of San Francisco[\s\S]{0,240}USF_Full-Time_Faculty/);
  assert.match(server, /Western University of Health Sciences[\s\S]{0,400}query_position_type_id%5B%5D=2&2711%5B%5D=1/);
  assert.match(server, /Samuel Merritt University[\s\S]{0,420}jobFamily=354364828a5e010b8f2897b83ce40000[\s\S]{0,180}associate dean\|simulation educator/);
  const dispatcher = server.match(/async function scrapeCaPrivate[\s\S]*?\/\* ===== Generic/);
  assert.match(dispatcher?.[0] || "", /type === "academicjobsonline"/);
  assert.match(dispatcher?.[0] || "", /excludeTitleFilter/);
});

test("all six live controls are covered with fail-closed evidence", () => {
  assert.equal(validation.validatedCount, 6);
  assert.equal(validation.invalidJobCount, 0);
  assert.equal(milestone.appliedCount, 6);
  assert.equal(milestone.newlyCoveredCount, 6);
  const westmont = validation.results.find((row) => row.name === "Westmont College");
  assert.equal(westmont?.healthyZero, true);
  const western = validation.results.find((row) => row.name === "Western University of Health Sciences");
  assert.equal(western?.requiredMarkersPresent, true);
  assert.equal(western?.forbiddenMarkersAbsent, true);
  for (const name of names) {
    const result = validation.results.find((row) => row.name === name);
    assert.equal(result?.healthySource, true);
    assert.equal(overrides.overrides.find((row) => row.name === name)?.career_url, result.url);
    assert.equal(master.institutions.find((row) => row.name === name)?.coverage_status, "covered");
  }
});
