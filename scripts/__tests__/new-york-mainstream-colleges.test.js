import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/new-york-mainstream-colleges-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/new-york-mainstream-colleges-validation.json"), "utf8"));

const names = [
  "Houghton University",
  "Skidmore College",
  "Vassar College",
  "St Lawrence University",
  "St. John Fisher University",
];

test("five New York institutions use exact official hiring controls", () => {
  for (const name of names) assert.match(server, new RegExp(`campus: "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(server, /Houghton University"[\s\S]{0,220}excludeTitleFilter: "\^Faculty Application\$"/);
  assert.match(server, /Vassar College"[\s\S]{0,260}jobFamilyGroup=71e2c39500161003e7c502c9a45f8212/);
  assert.match(server, /St Lawrence University"[\s\S]{0,260}query_position_type_id%5B%5D=2/);
  assert.match(server, /St\. John Fisher University"[\s\S]{0,300}query_position_type_id=3/);
});

test("New York dispatcher preserves source-specific safeguards", () => {
  const dispatcher = server.match(/async function scrapeNyPrivate[\s\S]*?\/\/ Paycom scraper/);
  assert.ok(dispatcher);
  assert.match(dispatcher[0], /type === "oracle-cloud-api"/);
  assert.match(dispatcher[0], /new RegExp\(excludeTitleFilter, "i"\)/);
});

test("all five controls retain healthy live evidence", () => {
  assert.equal(milestone.appliedCount, 5);
  assert.equal(milestone.newlyCoveredCount, 5);
  assert.equal(validation.invalidJobCount, 0);
  for (const result of validation.results) {
    const override = overrides.overrides.find((row) => row.name === result.name);
    const institution = master.institutions.find((row) => row.name === result.name);
    assert.equal(result.healthySource, true);
    assert.equal(override?.career_url, result.url);
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "official_institution_employment_page_validated");
  }
  assert.equal(validation.results.find((row) => row.name === "Houghton University")?.sampleTitles.includes("Faculty Application"), false);
  assert.ok(validation.results.find((row) => row.name === "Skidmore College")?.rawBoardJobCount > 0);
});
