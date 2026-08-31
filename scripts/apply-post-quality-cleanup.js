#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirmedNonFacultyReason } from "./lib/post-quality.js";
import { loadReviewedExclusions, reviewedExclusionReason } from "./lib/post-quality-exclusions.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const TARGETS = [
  "public/jobs.json",
  "docs/jobs.json",
  "web-vue/public/jobs.json",
];
const REPORT_PATH = path.join(ROOT, "generated", "post-quality-cleanup-report.json");
const REVIEWED_EXCLUSIONS = loadReviewedExclusions(path.join(ROOT, "data", "post-quality-exclusions.json"));

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readPayload(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const primaryPath = path.join(ROOT, TARGETS[0]);
const payload = readPayload(primaryPath);
const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
const kept = [];
const removed = [];
const reasonCounts = {};

for (const job of jobs) {
  const reason = reviewedExclusionReason(job, REVIEWED_EXCLUSIONS) || confirmedNonFacultyReason(job);
  if (!reason) {
    kept.push(job);
    continue;
  }
  reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  removed.push({
    reason,
    title: clean(job?.title),
    college: clean(job?.college),
    source: clean(job?.source),
    url: clean(job?.url),
  });
}

const nextPayload = { ...payload, jobs: kept, count: kept.length };
for (const relativePath of TARGETS) {
  const filePath = path.join(ROOT, relativePath);
  fs.writeFileSync(filePath, `${JSON.stringify(nextPayload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${relativePath} (${kept.length} jobs)`);
}

const report = {
  generatedAt: new Date().toISOString(),
  beforeCount: jobs.length,
  afterCount: kept.length,
  removedCount: removed.length,
  reasonCounts,
  removed,
};
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Removed ${removed.length} confirmed non-faculty listings`);
console.log(`Wrote ${path.relative(ROOT, REPORT_PATH)}`);
