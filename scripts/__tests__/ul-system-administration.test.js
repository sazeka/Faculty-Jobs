import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/ul-system-administration-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/ul-system-administration-validation.json"), "utf8"));

test("UL System Administration uses its exact state department filter", () => {
  const row = server.match(/campus: "University of Louisiana-System Administration"[^\n]+/)?.[0] || "";
  assert.match(row, /type: "schooljobs"/);
  assert.match(row, /department%5B0%5D=HED-Bd%20Supervisors%20U%20of%20LA%20Sys/);
  const dispatcher = server.match(/async function scrapeLaAll[\s\S]*?async function scrapeArAll/);
  assert.ok(dispatcher);
  assert.match(dispatcher[0], /type === "schooljobs"/);
});

test("NationsUniversity is not promoted without a recruitment source", () => {
  assert.doesNotMatch(server, /^\s*\{ campus: "NationsUniversity"/m);
});

test("UL System Administration retains live exact-scope evidence", () => {
  assert.equal(milestone.appliedCount, 1);
  assert.equal(milestone.newlyCoveredCount, 1);
  assert.equal(validation.healthySource, true);
  assert.equal(validation.invalidJobCount, 0);
  const override = overrides.overrides.find((row) => row.name === validation.name);
  const institution = master.institutions.find((row) => row.name === validation.name);
  assert.equal(override?.career_url, validation.url);
  assert.equal(institution?.coverage_status, "covered");
  assert.equal(institution?.last_discovery_status, "official_exact_department_filter_validated");
});
