import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (url) => JSON.parse(fs.readFileSync(url, "utf8"));
const report = read(new URL("../../generated/remaining-69-closeout-report.json", import.meta.url));
const coverage = read(new URL("../../generated/coverage-report.json", import.meta.url));
const overrides = read(new URL("../../data/career-url-overrides.json", import.meta.url));
const rules = read(new URL("../../data/policy-rules.json", import.meta.url));
const policyExclusions = read(new URL("../../generated/policy-excluded-colleges.json", import.meta.url));
const server = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const canonical = (url) => String(url || "").replace(/\/(?=$|\?)/, "");

test("the final 69-institution closeout is fully and uniquely accounted for", () => {
  assert.equal(report.originalBatch, 69);
  assert.equal(report.accounted, 69);
  assert.deepEqual(report.totals, { verified: 40, excluded: 29, unresolved: 0 });
  const names = [...report.verified, ...report.excluded].map((row) => row.name);
  assert.equal(new Set(names).size, 69);
});

test("every verified source is active in metadata and server routing", () => {
  for (const item of report.verified) {
    const override = overrides.overrides.find((row) => row.name === item.name);
    assert.equal(canonical(override?.career_url), canonical(item.career_url), item.name);
    assert.match(server, new RegExp(`campus: ${JSON.stringify(item.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), item.name);
  }
});

test("excluded rows have explicit policy evidence and the audited backlog is zero", () => {
  const excludedNames = new Set(policyExclusions.colleges);
  for (const item of report.excluded) {
    assert.equal(overrides.overrides.some((row) => row.name === item.name), false, item.name);
    assert.equal(rules.institutionOverrides[item.name]?.action, "exclude", item.name);
    assert.equal(excludedNames.has(item.name), true, item.name);
  }
  assert.equal(coverage.totals.missing, 0);
  assert.equal(coverage.totals.pending_review, 0);
});

test("previous policy exclusions are reconciled by the authoritative coverage layer", () => {
  const excludedNames = new Set(policyExclusions.colleges);
  assert.equal(report.normalizedPriorPolicyRows.length, 6);
  for (const name of report.normalizedPriorPolicyRows) {
    assert.equal(excludedNames.has(name), true, name);
  }
});
