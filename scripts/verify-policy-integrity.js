#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const RULES_PATH = path.join(ROOT, "data", "policy-rules.json");
const EXCLUSIONS_PATH = path.join(ROOT, "generated", "policy-excluded-colleges.json");
const JOBS_PATH = path.join(ROOT, "public", "jobs.json");
const SKIP_JOBS_CHECK = process.argv.includes("--skip-jobs-check");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function key(v) {
  return clean(v).toLowerCase();
}

function isHttpUrl(v) {
  return /^https?:\/\//i.test(String(v || ""));
}

function fail(errors) {
  console.error("\nPolicy integrity checks failed:\n");
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

function main() {
  const errors = [];

  let rules;
  let exclusions;
  let jobsData;
  try {
    rules = readJson(RULES_PATH);
  } catch (e) {
    errors.push(`Unable to read ${path.relative(ROOT, RULES_PATH)}: ${e?.message || e}`);
  }
  try {
    exclusions = readJson(EXCLUSIONS_PATH);
  } catch (e) {
    errors.push(`Unable to read ${path.relative(ROOT, EXCLUSIONS_PATH)}: ${e?.message || e}`);
  }
  if (!SKIP_JOBS_CHECK) {
    try {
      jobsData = readJson(JOBS_PATH);
    } catch (e) {
      errors.push(`Unable to read ${path.relative(ROOT, JOBS_PATH)}: ${e?.message || e}`);
    }
  }
  if (errors.length) fail(errors);

  const excludedItems = Array.isArray(exclusions.items) ? exclusions.items : [];
  const excludedColleges = Array.isArray(exclusions.colleges) ? exclusions.colleges : [];
  const jobs = Array.isArray(jobsData?.jobs) ? jobsData.jobs : [];

  const dupCheck = new Set();
  for (const name of excludedColleges) {
    const k = key(name);
    if (dupCheck.has(k)) errors.push(`Duplicate excluded college: "${name}"`);
    dupCheck.add(k);
  }

  // Every excluded item should include source attribution.
  for (const item of excludedItems) {
    const college = clean(item.college);
    const sources = Array.isArray(item.sources) ? item.sources : [];
    if (!college) errors.push("Excluded item contains empty college name.");
    if (sources.length === 0) errors.push(`Excluded college missing policy source links: "${college}"`);
    for (const src of sources) {
      if (!isHttpUrl(src)) errors.push(`Invalid source URL for "${college}": ${src}`);
    }
  }

  // Every exclude platform rule should have at least one source URL.
  for (const rule of rules.platformRules || []) {
    if (String(rule.action).toLowerCase() !== "exclude") continue;
    const sources = Array.isArray(rule.sources) ? rule.sources : [];
    if (sources.length === 0) {
      errors.push(`Exclude platform rule missing sources: platformType="${rule.platformType}"`);
      continue;
    }
    for (const src of sources) {
      if (!isHttpUrl(src)) {
        errors.push(`Exclude platform rule has invalid source URL for "${rule.platformType}": ${src}`);
      }
    }
  }

  // No institution override should be both include and exclude (guard against malformed values).
  for (const [name, cfg] of Object.entries(rules.institutionOverrides || {})) {
    const action = String(cfg?.action || "").toLowerCase();
    if (action && !["include", "exclude"].includes(action)) {
      errors.push(`Invalid institution override action for "${name}": ${cfg?.action}`);
    }
  }

  // Excluded colleges should not appear in output jobs.
  if (!SKIP_JOBS_CHECK) {
    const excludedKeys = new Set(excludedColleges.map(key));
    const leaked = [];
    for (const j of jobs) {
      const college = clean(j?.college);
      if (!college) continue;
      if (excludedKeys.has(key(college))) leaked.push(college);
    }
    if (leaked.length > 0) {
      const uniqueLeaked = [...new Set(leaked)].sort();
      errors.push(`Excluded colleges present in jobs output (${uniqueLeaked.length}): ${uniqueLeaked.join(", ")}`);
    }
  }

  if (errors.length) fail(errors);

  const jobsMsg = SKIP_JOBS_CHECK ? "jobs check skipped" : `${jobs.length} jobs checked`;
  console.log(
    `Policy integrity checks passed (${excludedColleges.length} excluded colleges, ${excludedItems.length} excluded items, ${jobsMsg}).`
  );
}

main();
