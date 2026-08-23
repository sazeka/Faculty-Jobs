import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));

test("the legacy final-38 queue is completely reconciled", () => {
  const queue = readJson("generated/missing-institutions-without-career-url.json");
  const resolution = readJson("generated/remaining-missing-resolution.json");

  assert.equal(queue.count, 0);
  assert.deepEqual(queue.items, []);
  assert.equal(resolution.originalCount, 38);
  assert.equal(resolution.resolvedCount, 38);
  assert.equal(resolution.mappedCount + resolution.excludedCount, 38);
  assert.equal(resolution.unresolvedCount, 0);
});

test("active members use curated shared sources and are not policy-excluded", () => {
  const resolution = readJson("generated/remaining-missing-resolution.json");
  const careerOverrides = readJson("data/career-url-overrides.json").overrides;
  const policyOverrides = readJson("data/policy-rules.json").institutionOverrides;
  const byName = new Map(careerOverrides.map((row) => [row.name, row]));

  for (const item of resolution.mapped) {
    const override = byName.get(item.name);
    assert.ok(override, `missing career override for ${item.name}`);
    assert.equal(override.coverage_source, item.coverage_source);
    assert.match(override.career_url, /^https:\/\//);
    assert.notEqual(policyOverrides[item.name]?.action, "exclude", `${item.name} remains excluded`);
  }
});

test("closed and out-of-scope members retain policy exclusions", () => {
  const resolution = readJson("generated/remaining-missing-resolution.json");
  const policyOverrides = readJson("data/policy-rules.json").institutionOverrides;

  for (const item of resolution.excluded) {
    assert.equal(policyOverrides[item.name]?.action, "exclude", `missing exclusion for ${item.name}`);
  }
});
