import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { splitOklahomaStateCampus } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated", "okstate-system-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated", "okstate-system-validation.json"), "utf8"));

const names = [
  "Oklahoma State University",
  "Oklahoma State University Center for Health Sciences",
  "Oklahoma State University Institute of Technology",
  "Oklahoma State University-Oklahoma City",
];

test("Oklahoma State splitter accepts only exact department codes", () => {
  const base = { college: "Oklahoma State University System", title: "Professor" };
  assert.equal(splitOklahomaStateCampus({ ...base, department: "CENTER FOR HEALTH SCIENCES (CHS)" })?.college, names[1]);
  assert.equal(splitOklahomaStateCampus({ ...base, department: "INSTITUTE OF TECHNOLOGY (OKM)" })?.college, names[2]);
  assert.equal(splitOklahomaStateCampus({ ...base, department: "OKLAHOMA CITY (OKC)" })?.college, names[3]);
  assert.equal(splitOklahomaStateCampus({ ...base, department: "ARTS AND SCIENCES (STW)" })?.college, names[0]);
  assert.equal(splitOklahomaStateCampus({ ...base, department: "TULSA (TUL)" })?.college, names[0]);
  assert.equal(splitOklahomaStateCampus({ ...base, department: "Unknown" }), null);
});

test("one system route covers four exact institution controls", () => {
  assert.equal(milestone.appliedCount, 4);
  assert.equal(milestone.newlyCoveredCount, 3);
  assert.equal(validation.invalidJobCount, 0);
  assert.equal(validation.ambiguousQualifyingJobCount, 0);
  assert.equal(validation.mappedFacultyJobCount, validation.rawQualifyingJobCount);
  for (const name of names) {
    const override = overrides.overrides.find((row) => row.name === name);
    const institution = master.institutions.find((row) => row.name === name);
    assert.equal(override?.platform_type, "okstate-system");
    assert.equal(override?.coverage_source, "Oklahoma State University System");
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "official_shared_board_department_split_validated");
    assert.equal(institution?.last_discovery_confidence, 1);
  }
  assert.equal((server.match(/type: "okstate-system"/g) || []).length, 1);
});

test("PageUp pagination recognizes a labeled next-page chevron", () => {
  assert.match(server, /label === "next page"/);
  const dispatcher = server.match(/async function scrapeOkAll[\s\S]*?async function scrapeMoAll/);
  assert.ok(dispatcher);
  assert.match(dispatcher[0], /jobs\.map\(splitOklahomaStateCampus\)\.filter\(Boolean\)/);
});
