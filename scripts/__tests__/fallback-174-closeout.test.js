import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => JSON.parse(fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));

test("the fallback-174 campaign is completely and uniquely accounted for", () => {
  const report = read("generated/fallback-174-closeout-report.json");
  const groups = [report.previouslyMapped, report.verifiedNew, report.inactive, report.noPublicHiringPage];
  const names = groups.flat().map((row) => row.name);

  assert.equal(report.originalBatch, 174);
  assert.equal(report.accounted, 174);
  assert.equal(report.totals.unresolved, 0);
  assert.equal(new Set(names).size, 174);
  assert.deepEqual(report.totals, {
    previouslyMapped: 12,
    verifiedNew: 15,
    inactive: 5,
    noPublicHiringPage: 142,
    unresolved: 0,
  });
});

test("new sources are active and every closeout is represented in policy", () => {
  const report = read("generated/fallback-174-closeout-report.json");
  const overrides = read("data/career-url-overrides.json").overrides;
  const rules = read("data/policy-rules.json").institutionOverrides;
  const server = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
  const overrideMap = new Map(overrides.map((row) => [row.name, row]));

  for (const item of report.verifiedNew) {
    assert.equal(overrideMap.get(item.name)?.career_url, item.career_url);
    assert.match(server, new RegExp(`campus: "${item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.notEqual(rules[item.name]?.action, "exclude");
  }
  for (const item of [...report.inactive, ...report.noPublicHiringPage]) {
    assert.equal(rules[item.name]?.action, "exclude");
    assert.ok(rules[item.name].sources.every((source) => /^https?:\/\//.test(source)));
  }
});
