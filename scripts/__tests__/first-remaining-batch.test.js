import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/first-remaining-batch-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/first-remaining-batch-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("first remaining batch reviews exactly forty institutions", () => {
  assert.equal(validation.reviewedCount, 40);
  assert.equal(validation.promotedCount, 12);
  assert.equal(validation.heldCount, 28);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 28);
});

test("shared public boards retain exact scope controls", () => {
  assert.match(server, /Los Angeles Mission College"[^\n]+locationFilter: "Los Angeles Mission College"[^\n]+employmentFilter: "Faculty - Full-Time"/);
  assert.match(server, /West Los Angeles College"[^\n]+locationFilter: "West Los Angeles College"[^\n]+employmentFilter: "Faculty - Full-Time"/);
  assert.match(server, /District-District Office"[^\n]+query_organizational_tier_2_id%5B%5D=264/);
  assert.match(server, /State Center Community College District"[^\n]+615%5B%5D=1/);
  assert.match(server, /SUNY Brockport", patterns:/);
});

test("all promoted institutions are covered and retain source evidence", () => {
  assert.equal(milestone.appliedCount, 12);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url, control.url);
    assert.equal(institution?.career_url.replace(/\/$/, ""), control.url.replace(/\/$/, ""));
    assert.equal(institution?.coverage_status, "covered");
    assert.ok(["healthy", "bot_blocked", "broken", "quarantined_broken_link"].includes(institution?.verification_status));
  }
});
