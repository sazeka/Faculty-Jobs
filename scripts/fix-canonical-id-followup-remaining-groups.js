#!/usr/bin/env node
// Follow-up to the #135 canonical-ID fix (scripts/fix-canonical-and-quality-
// batch-135-145.js): after that migration, 228 canonical groups (675
// records) in the live dataset still held more than one record. Auditing
// those against scripts/lib/canonical-id.js's extractRequisitionId() found
// several URL shapes with a stable id hiding in them that the original fix
// didn't yet recognize (BambooHR, SelectMinds, PageUp ids followed by a
// slug, several more Workday requisition-id spellings, Interfolio, a
// generic "jobs|careers|requisition|preview/{id}" shape used by half a
// dozen otherwise-unrelated ATS vendors, and a few more -- see canonical-
// id.js for the full list and the evidence behind each one).
//
// This script only re-runs attachCanonicalIds() with the updated logic; no
// other field changes. That logic itself now also carries a dataset-wide
// safety net (computeRequisitionIdOverrides in canonical-id.js) that
// refuses to split a fallback-key cluster on a newly-extracted id unless at
// least two distinct ids appear in it, and unions together any two ids
// whose full descriptions are byte-identical -- both guards exist because
// auditing surfaced real same-posting duplicates that a naive "prefer any
// extracted id" rule would have wrongly separated (see canonical-id.js and
// its test file for the confirmed examples: a BambooHR repost, a Paycom/
// governmentjobs.com mirror pair, a Bryn Mawr Drupal alias).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachCanonicalIds } from "./lib/canonical-id.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
const TARGETS = ["public/jobs.json", "docs/jobs.json"];
const REPORT_PATH = path.join(ROOT, "generated", "canonical-id-followup-remaining-groups-fix-report.json");

function multiRecordGroups(jobs) {
  const byGroup = new Map();
  for (const job of jobs) {
    const key = job.canonicalGroupId;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(job);
  }
  return [...byGroup.values()].filter((group) => group.length > 1);
}

function main() {
  const sourcePath = path.join(ROOT, TARGETS[0]);
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const before = source.jobs;

  const beforeMulti = multiRecordGroups(before);
  const beforeSpanningLocation = beforeMulti.filter((group) => new Set(group.map((j) => j.location || "")).size > 1);

  const after = attachCanonicalIds(before);
  const afterMulti = multiRecordGroups(after);
  const afterSpanningLocation = afterMulti.filter((group) => new Set(group.map((j) => j.location || "")).size > 1);

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    recordCount: after.length,
    recordCountUnchanged: after.length === before.length,
    multiRecordGroups: {
      before: { groupCount: beforeMulti.length, recordCount: beforeMulti.reduce((sum, g) => sum + g.length, 0) },
      after: { groupCount: afterMulti.length, recordCount: afterMulti.reduce((sum, g) => sum + g.length, 0) },
    },
    groupsSpanningMultipleLocations: { before: beforeSpanningLocation.length, after: afterSpanningLocation.length },
    remainingGroupSamples: afterMulti.slice(0, 30).map((group) => ({
      title: group[0].titleClean || group[0].title,
      college: group[0].college,
      location: group[0].location,
      urls: group.map((j) => j.url),
    })),
  };

  console.log(JSON.stringify(report, null, 2).slice(0, 4000));

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n(Full report written to ${REPORT_PATH}${DRY_RUN ? " -- dry run, jobs.json files NOT modified" : ""})`);

  if (!DRY_RUN) {
    const output = { ...source, count: after.length, jobs: after };
    for (const relative of TARGETS) {
      fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`);
    }
  }
}

main();
