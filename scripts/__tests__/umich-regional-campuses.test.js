import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated", "umich-regional-campuses-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated", "umich-regional-campuses-validation.json"), "utf8"));

const controls = [
  ["University of Michigan-Dearborn", "work_location=1", "Dearborn Campus"],
  ["University of Michigan-Flint", "work_location=2", "Flint Campus"],
];

test("U-M regional campuses use exact official work-location controls", () => {
  assert.equal(milestone.appliedCount, 2);
  assert.equal(milestone.newlyCoveredCount, 2);
  assert.equal(validation.invalidJobCount, 0);
  for (const [name, marker, location] of controls) {
    const override = overrides.overrides.find((row) => row.name === name);
    const institution = master.institutions.find((row) => row.name === name);
    const live = validation.results.find((row) => row.name === name);
    assert.ok(override?.career_url.includes(marker));
    assert.equal(override?.platform_type, "umich-campus");
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "official_exact_work_location_validated");
    assert.equal(live?.location, location);
    assert.ok(live?.currentFacultyJobCount >= 1);
  }
});

test("U-M table parser and pager fail closed", () => {
  assert.match(server, /card\.tagName === "TR"/);
  assert.match(server, /cells\.length >= 5/);
  assert.match(server, /if \(!hasNextPage\) break/);
  assert.match(server, /\^\(\?:Dearborn\|Flint\) Campus\$/);
  const dispatcher = server.match(/async function scrapeMiAll[\s\S]*?export async function scrapeSchoolJobsAs/);
  assert.ok(dispatcher);
  assert.match(dispatcher[0], /type === "umich-campus"/);
  assert.match(dispatcher[0], /scrapeUmichCampusAs/);
});
