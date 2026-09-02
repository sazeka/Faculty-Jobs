import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/third-public-discovery-batch-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/third-public-discovery-batch-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("third public discovery batch reviews exactly forty institutions", () => {
  assert.equal(validation.reviewedCount, 40);
  assert.equal(validation.promotedCount, 32);
  assert.equal(validation.heldCount, 8);
  assert.equal(validation.promoted.length, 32);
  assert.equal(validation.held.reduce((sum, row) => sum + row.names.length, 0), 8);
});

test("new routes use official institution-scoped controls", () => {
  assert.match(server, /University System of New Hampshire System Office[^\n]+jobs\.usnh\.edu/);
  assert.match(server, /Schoolcraft Community College District[^\n]+jobs\.schoolcraft\.edu/);
  assert.match(server, /University of Southern Mississippi[^\n]+usm\.csod\.com/);
  assert.match(server, /University of Mary Washington[^\n]+jobs\.umw\.edu/);
  assert.match(server, /Minnesota State Colleges and Universities System Office[^\n]+mnsystem\.peopleadmin\.com/);
  assert.match(server, /Thomas Edison State University[^\n]+089b582f-0a35-44db-98f2-170a98083ab9/);
});

test("non-employers and ambiguous shared-system campuses remain held", () => {
  const held = new Set(validation.held.flatMap((row) => row.names));
  assert.ok(held.has("University of New Hampshire at Manchester"));
  assert.ok(held.has("Oregon State University-Cascades Campus"));
  assert.ok(held.has("University of Wisconsin-Milwaukee Flex"));
  assert.ok(held.has("California State University-Chancellors Office"));
  assert.ok(held.has("University of North Carolina System"));
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
