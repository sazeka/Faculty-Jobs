import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/louisiana-official-boards-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/louisiana-official-boards-validation.json"), "utf8"));

test("Nicholls and UNO use dedicated official ATS routes", () => {
  assert.match(server, /campus: "Nicholls State University", type: "peopleadmin", url: "https:\/\/jobs\.nicholls\.edu\/postings\/search\?[^\"]*1667%5B%5D=3/);
  assert.match(server, /campus: "University of New Orleans", type: "workday", url: "https:\/\/ulsuno\.wd1\.myworkdayjobs\.com\/UniversityOfNewOrleans"/);
  const dispatcher = server.match(/async function scrapeLaAll[\s\S]*?async function scrapeArAll/);
  assert.ok(dispatcher);
  assert.match(dispatcher[0], /type === "peopleadmin"/);
  assert.match(dispatcher[0], /type === "workday"/);
});

test("both Louisiana official boards retain live validation evidence", () => {
  assert.equal(milestone.appliedCount, 2);
  assert.equal(milestone.newlyCoveredCount, 2);
  assert.equal(validation.invalidJobCount, 0);
  for (const result of validation.results) {
    const override = overrides.overrides.find((row) => row.name === result.name);
    const institution = master.institutions.find((row) => row.name === result.name);
    assert.equal(override?.career_url, result.url);
    assert.equal(override?.platform_type, result.platformType);
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "official_dedicated_board_validated");
    assert.ok(result.currentFacultyJobCount >= 1);
  }
});
