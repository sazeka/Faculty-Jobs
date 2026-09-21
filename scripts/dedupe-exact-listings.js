#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dedupeExactListings } from "./lib/exact-job-dedup.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = ["public/jobs.json", "docs/jobs.json", "web-vue/public/jobs.json"];
const primary = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), "utf8"));
const result = dedupeExactListings(primary.jobs || []);
const payload = { ...primary, count: result.jobs.length, jobs: result.jobs };

for (const target of TARGETS) {
  fs.writeFileSync(path.join(ROOT, target), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${target} (${result.jobs.length} jobs)`);
}

const report = {
  generatedAt: new Date().toISOString(),
  beforeCount: (primary.jobs || []).length,
  afterCount: result.jobs.length,
  removedCount: result.removed,
  duplicateGroupCount: result.duplicateGroups.length,
  duplicateGroups: result.duplicateGroups,
};
fs.writeFileSync(
  path.join(ROOT, "generated", "exact-listing-dedup-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
console.log(`Removed ${result.removed} exact duplicate listing copies`);
