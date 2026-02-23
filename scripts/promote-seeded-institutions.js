#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const RULES_PATH = path.join(ROOT, "data", "policy-rules.json");
const OUT_JSON_PATH = path.join(ROOT, "generated", "promotion-candidates.json");
const OUT_SNIPPET_PATH = path.join(ROOT, "generated", "promotion-candidates-snippets.js");

const PROMOTABLE_PLATFORMS = new Set([
  "peopleadmin",
  "pageup",
  "schooljobs",
  "csod",
  "interviewexchange",
  "icims",
  "interfolio",
  "jobvite",
  "paycom",
]);

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function normalize(v) {
  return clean(v).toLowerCase();
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { limit: 1000, seededOnly: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--limit" && args[i + 1]) out.limit = Math.max(1, Number(args[++i]));
    else if (a === "--seeded-only") out.seededOnly = true;
  }
  return out;
}

function isExcludedByRules(name, platform, rules) {
  const ov = (rules.institutionOverrides || {})[name];
  if (ov?.action === "exclude") return true;
  const platformRule = (rules.platformRules || []).find(
    (r) => normalize(r.platformType) === normalize(platform) && normalize(r.action) === "exclude"
  );
  return Boolean(platformRule);
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toSnippetLine(row) {
  const campus = row.name.replace(/"/g, '\\"');
  const type = row.platform_type.replace(/"/g, '\\"');
  const url = row.career_url.replace(/"/g, '\\"');
  return `  { campus: "${campus}", type: "${type}", url: "${url}" },`;
}

function main() {
  const opts = parseArgs(process.argv);
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  const rows = Array.isArray(master?.institutions) ? master.institutions : [];

  const candidates = rows
    .filter((r) => normalize(r.coverage_status) === "missing")
    .filter((r) => clean(r.career_url) && clean(r.platform_type))
    .filter((r) => PROMOTABLE_PLATFORMS.has(normalize(r.platform_type)))
    .filter((r) => !isExcludedByRules(r.name, r.platform_type, rules))
    .filter((r) => {
      if (!opts.seededOnly) return true;
      return normalize(r.notes).includes("seeded from ipeds webaddr");
    })
    .sort((a, b) => clean(a.name).localeCompare(clean(b.name)))
    .slice(0, opts.limit)
    .map((r) => ({
      unitid: r.unitid || null,
      name: r.name,
      state: r.state || "Unknown",
      level: r.level || "Unknown",
      control: r.control || "Unknown",
      platform_type: clean(r.platform_type),
      career_url: clean(r.career_url),
      seeded: normalize(r.notes).includes("seeded from ipeds webaddr"),
      notes: r.notes || null,
    }));

  const byState = {};
  const byPlatform = {};
  for (const c of candidates) {
    byState[c.state] = (byState[c.state] || 0) + 1;
    byPlatform[c.platform_type] = (byPlatform[c.platform_type] || 0) + 1;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    options: opts,
    promotablePlatforms: [...PROMOTABLE_PLATFORMS],
    count: candidates.length,
    byState,
    byPlatform,
    items: candidates,
  };

  const lines = [];
  lines.push("// Candidate campus config entries generated from institutions-master");
  lines.push(`// Generated: ${payload.generatedAt}`);
  lines.push("");
  const stateKeys = Object.keys(byState).sort((a, b) => a.localeCompare(b));
  for (const state of stateKeys) {
    const stateRows = candidates.filter((c) => c.state === state);
    lines.push(`// ${state} (${stateRows.length})`);
    lines.push("const CANDIDATES = [");
    for (const row of stateRows) lines.push(toSnippetLine(row));
    lines.push("];");
    lines.push("");
  }

  const csvHeaders = ["name", "state", "platform_type", "career_url", "unitid", "level", "control", "seeded"];
  const csvLines = [csvHeaders.join(",")];
  for (const row of candidates) {
    csvLines.push(csvHeaders.map((h) => csvEscape(row[h])).join(","));
  }
  const csvPath = path.join(ROOT, "generated", "promotion-candidates.csv");

  fs.mkdirSync(path.dirname(OUT_JSON_PATH), { recursive: true });
  fs.writeFileSync(OUT_JSON_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.writeFileSync(OUT_SNIPPET_PATH, lines.join("\n") + "\n", "utf8");
  fs.writeFileSync(csvPath, csvLines.join("\n") + "\n", "utf8");

  console.log(`Wrote ${path.relative(ROOT, OUT_JSON_PATH)} (${payload.count} candidates)`);
  console.log(`Wrote ${path.relative(ROOT, OUT_SNIPPET_PATH)}`);
  console.log(`Wrote ${path.relative(ROOT, csvPath)}`);
}

main();
