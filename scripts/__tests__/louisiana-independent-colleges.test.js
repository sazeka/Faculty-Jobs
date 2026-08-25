import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/louisiana-independent-colleges-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/louisiana-independent-colleges-validation.json"), "utf8"));

test("four Louisiana independent colleges use institution-owned hiring sources", () => {
  for (const name of [
    "New Orleans Baptist Theological Seminary",
    "Saint Joseph Seminary College",
    "University of Holy Cross",
    "Xavier University of Louisiana",
  ]) assert.match(server, new RegExp(`campus: "${name}"[^\\n]+`));

  const xavier = server.match(/campus: "Xavier University of Louisiana"[^\n]+/)?.[0] || "";
  assert.match(xavier, /type: "peopleadmin"/);
  assert.match(xavier, /query_position_type_id%5B%5D=3/);
  assert.match(server, /Saint Joseph Seminary College"[^\n]+excludeTitleFilter: "\^Faculty Members\$"/);
});

test("Louisiana generic exclusions are applied before results return", () => {
  const dispatcher = server.match(/async function scrapeLaAll[\s\S]*?async function scrapeArAll/);
  assert.ok(dispatcher);
  assert.match(dispatcher[0], /excludeTitleFilter/);
  assert.match(dispatcher[0], /new RegExp\(excludeTitleFilter, "i"\)/);
});

test("all four independent colleges retain healthy live evidence", () => {
  assert.equal(milestone.appliedCount, 4);
  assert.equal(milestone.newlyCoveredCount, 4);
  assert.equal(validation.invalidJobCount, 0);
  for (const result of validation.results) {
    const override = overrides.overrides.find((row) => row.name === result.name);
    const institution = master.institutions.find((row) => row.name === result.name);
    assert.equal(result.healthySource, true);
    assert.equal(override?.career_url, result.url);
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "official_institution_employment_page_validated");
  }
});
