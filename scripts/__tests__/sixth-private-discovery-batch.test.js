import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/sixth-private-discovery-batch-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/sixth-private-discovery-batch-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("sixth private discovery batch accounts for twelve institutions", () => {
  assert.equal(validation.reviewedCount, 12);
  assert.equal(validation.promotedCount, 7);
  assert.equal(validation.heldCount, 5);
  assert.equal(validation.promoted.length, 7);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 5);
  assert.equal(validation.liveChecks.reduce((sum, row) => sum + row.publishedFacultyMatches, 0), 58);
});

test("the healthy zero-opening page rejects its navigation false positive", () => {
  assert.match(server, /Mary Baldwin University[^\n]+faculty support/);
  const virginia = server.match(/async function scrapeVaAll[\s\S]*?async function scrapeScAll/)[0];
  assert.match(virginia, /excludeTitleFilter[\s\S]+type === "generic"[\s\S]+new RegExp\(excludeTitleFilter/);
});

test("new routes use official institution-scoped sources", () => {
  for (const name of validation.promoted.map((row) => row.name)) assert.match(server, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(server, /Manchester University[^\n]+workforcenow\.adp\.com/);
  assert.match(server, /Marymount University[^\n]+marymount\.wd5\.myworkdayjobs\.com/);
  assert.match(server, /Messiah University[^\n]+careers\.messiah\.edu\/postings\/search/);
  assert.match(server, /Methodist University[^\n]+paycomonline\.net/);
});

test("new platform routes dispatch through supported scrapers", () => {
  const nc = server.match(/async function scrapeNcAll[\s\S]*?async function scrapeVaAll/)[0];
  const indiana = server.match(/async function scrapeInAll[\s\S]*?async function scrapeAdpCareerCenterAs/)[0];
  assert.match(nc, /type === "paycom"[\s\S]{0,160}scrapePaycomAs/);
  assert.match(indiana, /type === "adp"[\s\S]{0,160}scrapeAdpAs/);
});

test("all promoted institutions are covered and retain source evidence", () => {
  assert.equal(milestone.appliedCount, 7);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url?.replace(/\/(?=\?|$)/, ""), control.url.replace(/\/(?=\?|$)/, ""));
    assert.equal(institution?.career_url?.replace(/\/(?=\?|$)/, ""), control.url.replace(/\/(?=\?|$)/, ""));
    assert.equal(institution?.coverage_status, "covered");
    assert.ok(["healthy", "bot_blocked", "broken"].includes(institution?.verification_status));
  }
});
