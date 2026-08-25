import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = read("data/career-url-overrides.json");
const master = read("data/institutions-master.json");
const milestone = read("generated/new-york-independent-colleges-milestone.json");
const validation = read("generated/new-york-independent-colleges-validation.json");
const names = [
  "Manhattan School of Music",
  "Manhattanville University",
  "Northeast College of Health Sciences",
  "New York School of Interior Design",
  "New York Academy of Art",
];

test("five independent New York institutions use exact official sources", () => {
  for (const name of names) assert.match(server, new RegExp(`campus: "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(server, /Manhattan School of Music"[\s\S]{0,320}Faculty Overview/);
  assert.match(server, /New York Academy of Art"[\s\S]{0,240}\^CS Faculty\$/);
});

test("New York dispatcher supports ExactHire job cards", () => {
  const dispatcher = server.match(/async function scrapeNyPrivate[\s\S]*?\/\/ Paycom scraper/);
  assert.ok(dispatcher);
  assert.match(dispatcher[0], /type === "exacthire"/);
  assert.match(server, /input\[type="checkbox"\]\[value\]/);
});

test("all five controls retain healthy live evidence", () => {
  assert.equal(milestone.appliedCount, 5);
  assert.equal(milestone.newlyCoveredCount, 5);
  assert.equal(validation.invalidJobCount, 0);
  assert.equal(validation.currentFacultyJobCount, 11);
  for (const result of validation.results) {
    assert.equal(result.healthySource, true);
    assert.equal(overrides.overrides.find((row) => row.name === result.name)?.career_url, result.url);
    assert.equal(master.institutions.find((row) => row.name === result.name)?.coverage_status, "covered");
  }
  assert.deepEqual(validation.results.find((row) => row.name === "New York Academy of Art")?.sampleTitles, []);
});
