import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/fifth-private-discovery-batch-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/fifth-private-discovery-batch-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("fifth private discovery batch accounts for twelve institutions", () => {
  assert.equal(validation.reviewedCount, 12);
  assert.equal(validation.promotedCount, 6);
  assert.equal(validation.heldCount, 6);
  assert.equal(validation.promoted.length, 6);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 6);
  assert.equal(validation.liveChecks.reduce((sum, row) => sum + row.publishedFacultyMatches, 0), 95);
});

test("new routes use official institution-scoped sources", () => {
  assert.match(server, /Lawrence Technological University[^\n]+ltu\.edu\/about\/human-resources\/job-openings/);
  assert.match(server, /Lesley University[^\n]+lesley\.wd503\.myworkdayjobs\.com/);
  assert.match(server, /Lincoln Memorial University[^\n]+careers\.lmunet\.edu\/postings\/search/);
  assert.match(server, /Lindenwood University[^\n]+lindenwood\.wd1\.myworkdayjobs\.com/);
  assert.match(server, /Lipscomb University[^\n]+recruiting2\.ultipro\.com/);
  assert.match(server, /Madonna University[^\n]+madonna\.edu\/resources\/human-resources/);
});

test("new platform routes dispatch through supported scrapers", () => {
  assert.match(server, /type === "ultipro-ukg"[\s\S]{0,240}scrapeUltiproUkgAs\(context, url, campus, "TN"\)/);
});

test("new generic and UKG routes reject known faculty-label false positives", () => {
  assert.match(server, /Lawrence Technological University[^\n]+faculty policies/);
  assert.match(server, /Madonna University[^\n]+faculty benefits/);
  assert.match(server, /Lipscomb University[^\n]+group fitness instructor/);
});

test("closures and non-durable sources remain held", () => {
  const held = new Set(validation.held.flatMap((row) => row.names));
  assert.ok(held.has("Laboure College of Healthcare"));
  assert.ok(held.has("Limestone University"));
  assert.ok(held.has("Le Moyne-Owen College"));
  assert.ok(held.has("Livingstone College"));
});

test("all promoted institutions are covered and retain source evidence", () => {
  assert.equal(milestone.appliedCount, 6);
  assert.equal(milestone.newlyCoveredCount, 6);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url, control.url);
    assert.equal(institution?.career_url.replace(/\/$/, ""), control.url.replace(/\/$/, ""));
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.verification_status, "healthy");
  }
});
