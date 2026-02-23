#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const RULES_PATH = path.join(ROOT, "data", "policy-rules.json");
const DEFAULT_INPUT = path.join(ROOT, "generated", "missing-institutions-without-career-url.json");
const REPORT_PATH = path.join(ROOT, "generated", "remaining-missing-resolution.json");

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function normalize(v) {
  return clean(v).toLowerCase();
}

function usage() {
  console.log(
    "Usage: node scripts/exclude-unresolved-missing.js [--input generated/missing-institutions-without-career-url.json] [--dry-run]"
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { input: DEFAULT_INPUT, apply: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    }
    if (a === "--input" && args[i + 1]) out.input = path.resolve(ROOT, args[++i]);
    if (a === "--dry-run") out.apply = false;
  }
  return out;
}

function reasonFor(item, stamp) {
  const sector = Number(item?.sector);
  if (sector === 99) {
    return `Excluded pending manual review (${stamp}): IPEDS sector 99 branch/placeholder record with no canonical careers URL.`;
  }
  return `Excluded pending manual review (${stamp}): no usable careers URL found in IPEDS WEBADDR or automated discovery.`;
}

function main() {
  const opts = parseArgs(process.argv);
  const stamp = new Date().toISOString().slice(0, 10);

  const unresolved = JSON.parse(fs.readFileSync(opts.input, "utf8"));
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));

  if (!rules.institutionOverrides || typeof rules.institutionOverrides !== "object") {
    rules.institutionOverrides = {};
  }

  const unresolvedItems = Array.isArray(unresolved?.items) ? unresolved.items : [];
  const targetNames = new Set(unresolvedItems.map((x) => normalize(x?.name)).filter(Boolean));
  const unresolvedByName = new Map(unresolvedItems.map((x) => [normalize(x?.name), x]));

  let overridesAdded = 0;
  let masterMarked = 0;
  const excluded = [];
  const skipped = [];

  for (const row of master.institutions || []) {
    const k = normalize(row?.name);
    if (!k || !targetNames.has(k)) continue;
    if (clean(row?.career_url)) {
      skipped.push({ name: row.name, reason: "career_url now present; skipped exclusion" });
      continue;
    }

    const item = unresolvedByName.get(k) || {};
    const reason = reasonFor(item, stamp);

    if (!rules.institutionOverrides[row.name] || rules.institutionOverrides[row.name].action !== "exclude") {
      rules.institutionOverrides[row.name] = {
        action: "exclude",
        reason,
        sources: [
          "data/ipeds/hd2024.csv",
          "generated/missing-institutions-without-career-url.json",
        ],
      };
      overridesAdded += 1;
    }

    if (normalize(row.coverage_status) !== "excluded_policy") {
      row.coverage_status = "excluded_policy";
      masterMarked += 1;
    }
    row.last_checked_at = new Date().toISOString();
    row.notes = clean(`${row.notes || ""} ${reason}`).trim();

    excluded.push({
      unitid: row.unitid || null,
      name: row.name,
      state: row.state || null,
      level: row.level || null,
      control: row.control || null,
      sector: row.sector ?? null,
      reason,
    });
  }

  excluded.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  skipped.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  if (opts.apply) {
    fs.writeFileSync(RULES_PATH, JSON.stringify(rules, null, 2) + "\n", "utf8");
    fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n", "utf8");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    input: path.relative(ROOT, opts.input),
    apply: opts.apply,
    unresolvedCount: unresolvedItems.length,
    excludedCount: excluded.length,
    skippedCount: skipped.length,
    overridesAdded,
    masterMarked,
    excluded,
    skipped,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(
    `${opts.apply ? "Applied" : "Dry-run"} unresolved exclusions: excluded=${excluded.length}, skipped=${skipped.length}, overridesAdded=${overridesAdded}, masterMarked=${masterMarked}`
  );
  console.log(`Wrote ${path.relative(ROOT, REPORT_PATH)}`);
}

main();

