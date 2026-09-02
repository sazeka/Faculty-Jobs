import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/fourth-private-discovery-batch-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/fourth-private-discovery-batch-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("fourth private discovery batch reviews exactly forty institutions", () => {
  assert.equal(validation.reviewedCount, 40);
  assert.equal(validation.promotedCount, 12);
  assert.equal(validation.heldCount, 28);
  assert.equal(validation.promoted.length, 12);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 28);
});

test("new routes use official institution-scoped employee sources", () => {
  assert.match(server, /Bethany College \(KS\)[^\n]+bethanylb\.edu\/employment/);
  assert.match(server, /Hallmark University[^\n]+job-type\/faculty/);
  assert.match(server, /Harrisburg University of Science and Technology[^\n]+workforcenow\.adp\.com/);
  assert.match(server, /Haverford College[^\n]+human-resources\/jobs/);
  assert.match(server, /Hult International Business School[^\n]+Faculty\+%26\+research/);
});

test("new platform routes dispatch through their supported scrapers", () => {
  assert.match(server, /type === "oracle-cx"[^\n]+scrapeOracleCxAs\(context, url, campus, "MA"\)/);
  assert.match(server, /type === "adp"[^\n]+scrapeAdpAs\(context, url, campus, "PA"\)/);
});

test("unscoped, stale, closing, and non-employee sources remain held", () => {
  const held = new Set(validation.held.flatMap((row) => row.names));
  assert.ok(held.has("Icahn School of Medicine at Mount Sinai"));
  assert.ok(held.has("Hood Theological Seminary"));
  assert.ok(held.has("Hampshire College"));
  assert.ok(held.has("Institute for Doctoral Studies in the Visual Arts"));
});

test("all promoted institutions are covered and retain source evidence", () => {
  assert.equal(milestone.appliedCount, 12);
  assert.equal(milestone.newlyCoveredCount, 11);
  assert.equal(milestone.coveredAfter, 2929);
  assert.equal(milestone.missingAfter, 429);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url?.replace(/\/$/, ""), control.url.replace(/\/$/, ""));
    assert.equal((institution?.career_url || institution?.quarantined_career_url)?.replace(/\/(?=\?|$)/, ""), control.url.replace(/\/(?=\?|$)/, ""));
    assert.equal(institution?.coverage_status, "covered");
    assert.ok(["healthy", "bot_blocked", "broken", "quarantined_broken_link"].includes(institution?.verification_status));
  }
});
