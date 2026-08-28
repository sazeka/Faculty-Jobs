#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(value, null, 2)}\n`);
const validation = read("generated/sixth-private-discovery-batch-validation.json");
const overrides = read("data/career-url-overrides.json");
const master = read("data/institutions-master.json");
const overrideMap = new Map(overrides.overrides.map((row) => [row.name.toLowerCase(), row]));
const institutionMap = new Map(master.institutions.map((row) => [row.name.toLowerCase(), row]));

for (const control of validation.promoted) {
  const notes = `Verified in the sixth private-nonprofit discovery batch on 2026-08-28. ${control.evidence}`;
  const replacement = { name: control.name, career_url: control.url, platform_type: control.platformType, coverage_source: control.name, notes };
  const prior = overrideMap.get(control.name.toLowerCase());
  if (prior) Object.assign(prior, replacement);
  else overrides.overrides.push(replacement);
  const institution = institutionMap.get(control.name.toLowerCase());
  if (!institution) throw new Error(`Institution missing from master: ${control.name}`);
  Object.assign(institution, {
    career_url: control.url,
    platform_type: control.platformType,
    coverage_source: control.name,
    coverage_status: "covered",
    verification_status: "healthy",
    last_verified_at: validation.generatedAt,
    last_seen_job_count: 0,
    last_discovery_status: "official_scoped_source_validated",
    last_discovery_confidence: 1,
    last_discovery_attempt_at: validation.generatedAt,
    notes
  });
}

overrides.updatedAt = validation.generatedAt;
master.generatedAt = validation.generatedAt;
master.counts.covered = master.institutions.filter((row) => row.coverage_status === "covered").length;
master.counts.missing = master.institutions.filter((row) => row.coverage_status === "missing").length;
write("data/career-url-overrides.json", overrides);
write("data/institutions-master.json", master);
write("generated/sixth-private-discovery-batch-milestone.json", {
  generatedAt: validation.generatedAt,
  scope: validation.scope,
  reviewedCount: validation.reviewedCount,
  appliedCount: validation.promotedCount,
  heldCount: validation.heldCount,
  newlyCoveredCount: validation.promotedCount,
  coveredAfter: master.counts.covered,
  missingAfter: master.counts.missing,
  safeguards: validation.safeguards
});

console.log(`Applied ${validation.promotedCount} sources; ${validation.promotedCount} newly covered in this batch; ${validation.heldCount} held.`);
