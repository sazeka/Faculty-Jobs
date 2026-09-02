#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  COVERAGE_QUALITY_LEVELS,
  classifyInstitutionCoverage,
} from "./lib/institution-coverage-quality.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const EXCLUSIONS_PATH = path.join(ROOT, "generated", "policy-excluded-colleges.json");
const REPORT_PATH = path.join(ROOT, "generated", "institution-coverage-reconciliation.json");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function key(value) {
  return clean(value).toLowerCase();
}

function countsFor(institutions) {
  const counts = { totalInstitutions: institutions.length };
  for (const row of institutions) {
    const status = key(row.coverage_status) || "pending_review";
    counts[status] = (counts[status] || 0) + 1;
  }
  for (const status of ["covered", "missing", "quarantined", "excluded_policy", "pending_review"]) {
    if (!Number.isFinite(counts[status])) counts[status] = 0;
  }
  return counts;
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const exclusions = JSON.parse(fs.readFileSync(EXCLUSIONS_PATH, "utf8"));
  const exclusionByName = new Map((exclusions.items || []).map((item) => [key(item.college), item]));
  let newlyResolved = 0;

  for (const row of master.institutions || []) {
    const exclusion = exclusionByName.get(key(row.name)) || null;
    if (key(row.coverage_status) === "missing" && exclusion) {
      const inactive = key(row.verification_status) === "verified_inactive";
      row.coverage_status = "excluded_policy";
      row.coverage_resolution = inactive ? "closed_or_out_of_scope" : "active_no_public_hiring_source";
      row.coverage_resolution_reason = clean(exclusion.reason);
      newlyResolved += 1;
    }
    row.coverage_quality = classifyInstitutionCoverage(row, exclusion);
  }

  master.generatedAt = new Date().toISOString();
  master.counts = countsFor(master.institutions || []);
  master.source = {
    ...(master.source || {}),
    coverageQualityLevels: COVERAGE_QUALITY_LEVELS,
    coverageQualityNote: "Quality is source-specific and independent of scraper policy exclusion. Homepage-only and no-public-source records are not counted as verified hiring links.",
  };

  const qualityCounts = Object.fromEntries(Object.keys(COVERAGE_QUALITY_LEVELS).map((level) => [level, 0]));
  for (const row of master.institutions || []) qualityCounts[row.coverage_quality] += 1;
  const resolved = (master.institutions || [])
    .filter((row) => ["active_no_public_hiring_source", "closed_or_out_of_scope"].includes(row.coverage_resolution))
    .map((row) => ({
      name: row.name,
      state: row.state || null,
      resolution: row.coverage_resolution,
      reason: row.coverage_resolution_reason || null,
    }));

  const report = {
    generatedAt: master.generatedAt,
    dryRun,
    newlyResolved,
    resolvedCount: resolved.length,
    resolutions: {
      active_no_public_hiring_source: resolved.filter((row) => row.resolution === "active_no_public_hiring_source").length,
      closed_or_out_of_scope: resolved.filter((row) => row.resolution === "closed_or_out_of_scope").length,
    },
    masterCounts: master.counts,
    qualityCounts,
    resolved,
  };

  if (!dryRun) {
    fs.writeFileSync(MASTER_PATH, `${JSON.stringify(master, null, 2)}\n`, "utf8");
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({ dryRun, ...report.resolutions, masterCounts: report.masterCounts, qualityCounts }, null, 2));
}

main();
