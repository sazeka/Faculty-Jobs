import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/public-discovery-closeout-validation.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/public-discovery-closeout-milestone.json"), "utf8"));
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));

test("public discovery closeout accounts for both remaining institutions", () => {
  assert.equal(validation.reviewedCount, 2);
  assert.equal(validation.promotedCount, 1);
  assert.equal(validation.heldCount, 1);
  assert.equal(milestone.unreviewedEligibleAfter, 0);
});

test("the Chancellor's Office uses its institution-exclusive official board", () => {
  const row = server.match(/^\s*\{ campus: "Vermont State Colleges-Office of the Chancellor"[^\n]+/m)?.[0] || "";
  assert.match(row, /type: "ultipro-ukg"/);
  assert.match(row, /VER1019VTSC/);
  assert.match(row, /ee83245b-769f-4023-bd07-1e4a3d517e64/);
  assert.match(server.match(/async function scrapeVtAll[\s\S]*?\/\* ============================== MN/)[0], /type === "ultipro-ukg"/);
});

test("Pitt Pittsburgh remains held without an exact campus control", () => {
  assert.deepEqual(validation.held[0].names, ["University of Pittsburgh-Pittsburgh Campus"]);
  assert.doesNotMatch(server, /^\s*\{ campus: "University of Pittsburgh-Pittsburgh Campus"/m);
});

test("the promoted source is covered and retains evidence", () => {
  const control = validation.promoted[0];
  const override = overrides.overrides.find((row) => row.name === control.name);
  const institution = master.institutions.find((row) => row.name === control.name);
  assert.equal(override?.career_url, control.url);
  assert.equal(institution?.career_url.replace(/\/$/, ""), control.url.replace(/\/$/, ""));
  assert.equal(institution?.coverage_status, "covered");
  assert.equal(institution?.verification_status, "healthy");
});
