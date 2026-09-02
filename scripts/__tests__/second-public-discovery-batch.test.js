import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/second-public-discovery-batch-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/second-public-discovery-batch-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("second public discovery batch reviews exactly forty institutions", () => {
  assert.equal(validation.reviewedCount, 40);
  assert.equal(validation.promotedCount, 32);
  assert.equal(validation.heldCount, 8);
  assert.equal(validation.promoted.length, 32);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 8);
});

test("new routes use institution-scoped official controls", () => {
  assert.match(server, /University of Memphis[^\n]+workforum\.memphis\.edu/);
  assert.match(server, /University of Arkansas for Medical Sciences[^\n]+UAMS_All_Careers/);
  assert.match(server, /University of Nebraska at Kearney[^\n]+University-of-Nebraska-at-Kearney/);
  assert.match(server, /Wayne State College[^\n]+Faculty-Wayne-State-College/);
  assert.match(server, /West Virginia School of Osteopathic Medicine[^\n]+careers\.wvsom\.edu/);
  assert.match(server, /Sitting Bull College[^\n]+online\.sittingbull\.edu\/ICS\/Jobs/);
});

test("ambiguous shared-system employers remain held", () => {
  const held = new Set(validation.held.flatMap((row) => row.names));
  assert.ok(held.has("The University of Tennessee-Knoxville"));
  assert.ok(held.has("University of Arkansas at Pine Bluff"));
  assert.ok(held.has("University System of Maryland-Research Centers"));
  assert.ok(held.has("University of Missouri-System Office"));
});

test("all promoted institutions are covered and retain source evidence", () => {
  assert.equal(milestone.appliedCount, 32);
  assert.equal(milestone.newlyCoveredCount, 32);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url?.replace(/\/$/, ""), control.url.replace(/\/$/, ""));
    assert.equal(institution?.career_url.replace(/\/$/, ""), control.url.replace(/\/$/, ""));
    assert.equal(institution?.coverage_status, "covered");
    assert.ok(["healthy", "bot_blocked", "broken"].includes(institution?.verification_status));
  }
});
