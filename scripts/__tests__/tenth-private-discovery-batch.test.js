import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const validation = read("generated/tenth-private-discovery-batch-validation.json");
const milestone = read("generated/tenth-private-discovery-batch-milestone.json");
const overrides = read("data/career-url-overrides.json");
const master = read("data/institutions-master.json");

test("tenth private discovery batch accounts for all forty-five unaudited controls", () => {
  assert.equal(validation.reviewedCount, 45);
  assert.equal(validation.promotedCount, 11);
  assert.equal(validation.heldCount, 34);
  assert.equal(validation.promoted.length, 11);
  assert.equal(validation.held.reduce((sum, group) => sum + group.names.length, 0), 34);
  const names = [...validation.promoted.map((row) => row.name), ...validation.held.flatMap((group) => group.names)];
  assert.equal(new Set(names).size, 45);
});

test("new institution routes and ATS adapters are wired", () => {
  for (const control of validation.promoted) {
    assert.match(server, new RegExp(control.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(server, /Moravian University[^\n]+oracle-cx/);
  assert.match(server, /Muhlenberg College[^\n]+workday/);
  assert.match(server, /Midland University[^\n]+paycom/);
  assert.match(server, /type === "oracle-cx"[^\n]+campus, "PA"/);
  assert.match(server, /type === "paycom"[^\n]+campus, "NE"/);
});

test("the earlier batch held ambiguous employers until final manual verification", () => {
  const held = new Set(validation.held.flatMap((group) => group.names));
  for (const name of ["Mayo Clinic College of Medicine and Science", "MGH Institute of Health Professions", "Mount Sinai Phillips School of Nursing", "Missouri Valley College"]) {
    assert.ok(held.has(name), name);
  }
  assert.match(server, /campus: "Missouri Valley College"[^\n]+careers-at-mvc/);
  assert.match(server, /campus: "MGH Institute of Health Professions"[^\n]+massgeneral\.org\/careers/);
});

test("all promoted institutions are covered and retain live evidence", () => {
  assert.equal(milestone.appliedCount, 11);
  assert.equal(milestone.newlyCoveredCount, 11);
  for (const control of validation.promoted) {
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.career_url, control.url);
    assert.equal(institution?.career_url, control.url);
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.verification_status, "healthy");
    assert.equal(institution?.last_discovery_status, "official_scoped_source_validated");
  }
});
