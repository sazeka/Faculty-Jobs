import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/second-private-discovery-batch-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/second-private-discovery-batch-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("second private discovery batch reviews exactly forty institutions", () => {
  assert.equal(validation.reviewedCount, 40);
  assert.equal(validation.promotedCount, 20);
  assert.equal(validation.heldCount, 20);
  assert.equal(validation.promoted.length, 20);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 20);
});

test("new routes use official institution-scoped employee sources", () => {
  assert.match(server, /Saybrook University[^\n]+SaybrookUniversityCareers/);
  assert.match(server, /Saint Leo University[^\n]+saintleo\.wd503\.myworkdayjobs\.com\/SLU/);
  assert.match(server, /Southeastern University[^\n]+2116258676BA57818683542956966222/);
  assert.match(server, /Warner University[^\n]+16D5A72295BEEA4BBF29A0DA73DAF892/);
  assert.match(server, /Interdenominational Theological Center[^\n]+itc\.edu\/about\/human-resources\/careers/);
});

test("ambiguous, merged, and non-employee sources remain held", () => {
  const held = new Set(validation.held.flatMap((row) => row.names));
  assert.ok(held.has("The Colleges of Law at Santa Barbara"));
  assert.ok(held.has("Keiser University-Ft Lauderdale"));
  assert.ok(held.has("Woodbury University"));
  assert.ok(held.has("University of the People"));
  assert.ok(held.has("Pontifical John Paul II Institute for Studies on Marriage and Family"));
});

test("all promoted institutions are covered and retain source evidence", () => {
  assert.equal(milestone.appliedCount, 20);
  assert.equal(milestone.newlyCoveredCount, 20);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url?.replace(/\/$/, ""), control.url.replace(/\/$/, ""));
    assert.equal((institution?.career_url || institution?.quarantined_career_url)?.replace(/\/(?=\?|$)/, ""), control.url.replace(/\/(?=\?|$)/, ""));
    assert.equal(institution?.coverage_status, "covered");
    assert.ok(["healthy", "bot_blocked", "broken", "quarantined_broken_link"].includes(institution?.verification_status));
  }
});
