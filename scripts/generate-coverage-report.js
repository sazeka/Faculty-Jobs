#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { attachUniversityCoverage } from "./lib/site-coverage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const INSTITUTIONS_PATH = path.join(ROOT, "data", "institutions-master.json");
const RULES_PATH = path.join(ROOT, "data", "policy-rules.json");
const EXCLUSIONS_PATH = path.join(ROOT, "generated", "policy-excluded-colleges.json");
const OUT_PATH = path.join(ROOT, "generated", "coverage-report.json");
const SITE_STATS_PATHS = [
  path.join(ROOT, "docs", "data", "site-stats.json"),
  path.join(ROOT, "public", "data", "site-stats.json"),
  path.join(ROOT, "web-vue", "public", "data", "site-stats.json"),
];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function key(v) {
  return clean(v).toLowerCase();
}

function isEligible(inst, scope) {
  if (!inst || typeof inst !== "object") return false;
  const level = clean(inst.level).toLowerCase();
  const control = clean(inst.control).toLowerCase();
  const includeLevels = (scope?.levelsIncluded || []).map((x) => String(x).toLowerCase());
  const excludeLevels = (scope?.excludeLevels || []).map((x) => String(x).toLowerCase());
  const excludeControls = (scope?.excludeControls || []).map((x) => String(x).toLowerCase());
  if (includeLevels.length > 0 && level && !includeLevels.includes(level)) return false;
  if (excludeLevels.length > 0 && level && excludeLevels.includes(level)) return false;
  if (excludeControls.length > 0 && control && excludeControls.includes(control)) return false;
  // While metadata is being backfilled from IPEDS, null means "unknown" (provisionally include).
  if (scope?.target === "degree-granting" && inst.is_degree_granting === false) return false;
  return true;
}

function addBreakdown(bucket, inst, status) {
  const state = clean(inst.state) || "Unknown";
  const control = clean(inst.control) || "Unknown";
  const level = clean(inst.level) || "Unknown";

  if (!bucket.byState[state]) bucket.byState[state] = { total: 0, covered: 0, missing: 0, excluded_policy: 0, pending_review: 0 };
  if (!bucket.byControl[control]) bucket.byControl[control] = { total: 0, covered: 0, missing: 0, excluded_policy: 0, pending_review: 0 };
  if (!bucket.byLevel[level]) bucket.byLevel[level] = { total: 0, covered: 0, missing: 0, excluded_policy: 0, pending_review: 0 };

  for (const group of [bucket.byState[state], bucket.byControl[control], bucket.byLevel[level]]) {
    group.total += 1;
    if (group[status] !== undefined) group[status] += 1;
  }
}

function main() {
  const institutionsPayload = readJson(INSTITUTIONS_PATH);
  const rules = readJson(RULES_PATH);
  const exclusionsPayload = readJson(EXCLUSIONS_PATH);

  const institutions = Array.isArray(institutionsPayload?.institutions) ? institutionsPayload.institutions : [];
  const excludedSet = new Set((exclusionsPayload?.colleges || []).map(key));

  const eligible = institutions.filter((inst) => isEligible(inst, rules.scope));

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      institutions: path.relative(ROOT, INSTITUTIONS_PATH),
      rules: path.relative(ROOT, RULES_PATH),
      exclusions: path.relative(ROOT, EXCLUSIONS_PATH),
    },
    scope: rules.scope || {},
    totals: {
      eligible_universe: eligible.length,
      covered: 0,
      missing: 0,
      excluded_policy: 0,
      pending_review: 0,
    },
    percentages: {},
    byState: {},
    byControl: {},
    byLevel: {},
  };

  for (const inst of eligible) {
    const normalizedName = key(inst.name);
    let status = clean(inst.coverage_status).toLowerCase() || "pending_review";
    if (!status || !["covered", "missing", "pending_review", "excluded_policy"].includes(status)) status = "pending_review";
    if (excludedSet.has(normalizedName)) status = "excluded_policy";

    report.totals[status] += 1;
    addBreakdown(report, inst, status);
  }

  const denom = report.totals.eligible_universe || 1;
  for (const k of ["covered", "missing", "excluded_policy", "pending_review"]) {
    report.percentages[k] = Number(((report.totals[k] / denom) * 100).toFixed(2));
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  for (const siteStatsPath of SITE_STATS_PATHS) {
    let siteStats = {};
    try {
      siteStats = readJson(siteStatsPath);
    } catch {
      // Coverage should still be available on a fresh checkout before a scrape.
    }
    fs.mkdirSync(path.dirname(siteStatsPath), { recursive: true });
    fs.writeFileSync(
      siteStatsPath,
      JSON.stringify(attachUniversityCoverage(siteStats, report), null, 2) + "\n",
      "utf8"
    );
  }
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (eligible universe: ${report.totals.eligible_universe})`);
  console.log("Synced audited university coverage into site-stats.json");
}

main();
