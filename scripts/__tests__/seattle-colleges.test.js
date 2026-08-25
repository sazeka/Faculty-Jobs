import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { splitSeattleCollegesCampus } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated", "seattle-colleges-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated", "seattle-colleges-validation.json"), "utf8"));

const names = ["North Seattle College", "Seattle Central College", "South Seattle College"];

test("Seattle Colleges splitter uses explicit campus evidence", () => {
  const base = { college: "Seattle Colleges", title: "Assistant Professor", url: "https://example.test/job" };
  assert.equal(splitSeattleCollegesCampus({ ...base, location: "North Seattle College" })?.college, "North Seattle College");
  assert.equal(splitSeattleCollegesCampus({ ...base, location: "Seattle Central College" })?.college, "Seattle Central College");
  assert.equal(splitSeattleCollegesCampus({ ...base, location: "S. Seattle - Georgetown Campus" })?.college, "South Seattle College");
  assert.equal(splitSeattleCollegesCampus({ ...base, location: "Multiple", title: "Tenure-Track Physics (North Seattle College)" })?.college, "North Seattle College");
});

test("Seattle Colleges splitter fails closed on ambiguous district rows", () => {
  assert.equal(splitSeattleCollegesCampus({ college: "Seattle Colleges", title: "Faculty Pool", location: "Multiple" }), null);
  const unrelated = { college: "Cascadia College", title: "Professor", location: "Cascadia College" };
  assert.equal(splitSeattleCollegesCampus(unrelated), unrelated);
});

test("three colleges use one exact official district control", () => {
  assert.equal(milestone.appliedCount, 3);
  assert.equal(milestone.newlyCoveredCount, 3);
  assert.equal(validation.siteId, "060");
  assert.equal(validation.invalidJobCount, 0);
  assert.ok(validation.mappedFacultyJobCount >= 1);
  for (const name of names) {
    const override = overrides.overrides.find((row) => row.name === name);
    const institution = master.institutions.find((row) => row.name === name);
    assert.equal(override?.career_url, validation.careerUrl);
    assert.equal(override?.platform_type, "seattle-colleges-district");
    assert.equal(override?.coverage_source, "Seattle Colleges");
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "official_shared_board_location_split_validated");
    assert.equal(institution?.last_discovery_confidence, 1);
  }
  const entries = server.match(/type: "seattle-colleges"/g) || [];
  assert.equal(entries.length, 1);
});

test("Washington dispatcher maps district jobs before returning them", () => {
  const dispatcher = server.match(/async function scrapeWaAll[\s\S]*?\/\* ============================== ME/);
  assert.ok(dispatcher);
  assert.match(dispatcher[0], /type === "seattle-colleges"/);
  assert.match(dispatcher[0], /jobs\.map\(splitSeattleCollegesCampus\)\.filter\(Boolean\)/);
});
