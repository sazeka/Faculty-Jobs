import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

test("the high/medium candidate review accounts for all 99 institutions", () => {
  const report = read("generated/reviewed-99-closeout-report.json");
  assert.equal(report.reviewed, 99);
  assert.deepEqual(report.totals, {
    high_signal_reviewed: 67,
    medium_confidence_reviewed: 32,
    verified: 85,
    excluded: 14,
    unresolved: 0,
  });
  assert.equal(new Set([...report.verified, ...report.excluded].map((row) => row.name.toLowerCase())).size, 99);
});

test("false-positive candidates use reviewed replacements or policy exclusions", () => {
  const report = read("generated/reviewed-99-closeout-report.json");
  const verified = new Map(report.verified.map((row) => [row.name, row]));
  const excluded = new Set(report.excluded.map((row) => row.name));

  assert.equal(verified.get("New England College of Optometry").career_url, "https://www.neco.edu/jobs/");
  assert.equal(verified.get("Nichols College").career_url, "https://www.nichols.edu/offices/human-resources/");
  assert.equal(verified.get("William Peace University").career_url, "https://peace.edu/about/work-at-wpu/");
  assert.equal(verified.get("Winebrenner Theological Seminary").career_url, "https://winebrenner.edu/career-opportunities/");
  assert.equal(verified.get("Sacred Heart Major Seminary").career_url, "https://www.shms.edu/human-resources");
  assert.ok(excluded.has("Siena Heights University"));
  assert.ok(excluded.has("World Mission University"));
});

test("all verified sources are wired and all exclusions are persisted", () => {
  const report = read("generated/reviewed-99-closeout-report.json");
  const overrides = read("data/career-url-overrides.json");
  const master = read("data/institutions-master.json");
  const rules = read("data/policy-rules.json");
  const overrideMap = new Map(overrides.overrides.map((row) => [row.name, row]));
  const institutionMap = new Map(master.institutions.map((row) => [row.name, row]));

  for (const row of report.verified) {
    assert.equal(overrideMap.get(row.name)?.career_url, row.career_url, row.name);
    assert.equal(institutionMap.get(row.name)?.coverage_status, "covered", row.name);
    const escaped = row.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(server, new RegExp(`^\\s*\\{ campus: "${escaped}"`, "m"), row.name);
  }
  for (const row of report.excluded) {
    assert.equal(rules.institutionOverrides[row.name]?.action, "exclude", row.name);
    assert.equal(institutionMap.get(row.name)?.coverage_status, "excluded_policy", row.name);
  }
});
