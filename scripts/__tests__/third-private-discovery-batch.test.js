import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/third-private-discovery-batch-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/third-private-discovery-batch-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("third private discovery batch reviews exactly forty institutions", () => {
  assert.equal(validation.reviewedCount, 40);
  assert.equal(validation.promotedCount, 26);
  assert.equal(validation.heldCount, 14);
  assert.equal(validation.promoted.length, 26);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 14);
});

test("new routes use official institution-scoped employee sources", () => {
  assert.match(server, /Morehouse College[^\n]+morehouse\.peopleadmin\.com/);
  assert.match(server, /Morehouse School of Medicine[^\n]+careers\.msm\.edu/);
  assert.match(server, /Savannah College of Art and Design[^\n]+string_field_1%5B%5D=Faculty/);
  assert.match(server, /North Central College[^\n]+query_position_type_id=2/);
  assert.match(server, /Lutheran School of Theology at Chicago[^\n]+lstc\.edu\/about\/employment/);
});

test("shared, merged, stale, and non-employee sources remain held", () => {
  const held = new Set(validation.held.flatMap((row) => row.names));
  assert.ok(held.has("Midwestern University-Downers Grove"));
  assert.ok(held.has("St Luke's College"));
  assert.ok(held.has("St. Augustine College"));
  assert.ok(held.has("McCormick Theological Seminary"));
  assert.ok(held.has("Saint Francis Medical Center College of Nursing"));
});

test("all promoted institutions are covered and retain source evidence", () => {
  assert.equal(milestone.appliedCount, 26);
  assert.equal(milestone.newlyCoveredCount, 26);
  assert.equal(milestone.coveredAfter, 2918);
  assert.equal(milestone.missingAfter, 440);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url?.replace(/\/$/, ""), control.url.replace(/\/$/, ""));
    assert.equal(institution?.career_url.replace(/\/$/, ""), control.url.replace(/\/$/, ""));
    assert.equal(institution?.coverage_status, "covered");
    assert.ok(["healthy", "bot_blocked", "broken"].includes(institution?.verification_status));
  }
});
