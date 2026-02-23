#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const INSTITUTIONS_PATH = path.join(ROOT, "data", "institutions-master.json");
const RULES_PATH = path.join(ROOT, "data", "policy-rules.json");
const OUT_PATH = path.join(ROOT, "generated", "policy-excluded-colleges.json");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function readJson(pathname) {
  return JSON.parse(fs.readFileSync(pathname, "utf8"));
}

function main() {
  const institutions = readJson(INSTITUTIONS_PATH);
  const rules = readJson(RULES_PATH);

  const ruleByPlatform = new Map();
  for (const r of rules.platformRules || []) {
    ruleByPlatform.set(normalize(r.platformType), r);
  }

  const overrides = new Map();
  for (const [name, cfg] of Object.entries(rules.institutionOverrides || {})) {
    overrides.set(normalize(name), cfg);
  }

  const excludedItems = [];
  for (const inst of institutions.institutions || []) {
    const name = clean(inst.name);
    if (!name) continue;

    const ov = overrides.get(normalize(name));
    if (ov && ov.action === "exclude") {
      excludedItems.push({
        college: name,
        platform_type: inst.platform_type || null,
        career_url: inst.career_url || null,
        reason: ov.reason || "Institution-level override",
        sources: Array.isArray(ov.sources) ? ov.sources : [],
      });
      continue;
    }
    if (ov && ov.action === "include") continue;

    const platformKey = normalize(inst.platform_type);
    const rule = platformKey ? ruleByPlatform.get(platformKey) : null;
    if (rule && rule.action === "exclude") {
      excludedItems.push({
        college: name,
        platform_type: inst.platform_type || null,
        career_url: inst.career_url || null,
        reason: rule.reason || `Excluded by platform rule (${inst.platform_type})`,
        sources: Array.isArray(rule.sources) ? rule.sources : [],
      });
    }
  }

  excludedItems.sort((a, b) => a.college.localeCompare(b.college));
  const colleges = excludedItems.map((x) => x.college);

  const out = {
    generatedAt: new Date().toISOString(),
    inputs: {
      institutions: path.relative(ROOT, INSTITUTIONS_PATH),
      rules: path.relative(ROOT, RULES_PATH),
    },
    count: colleges.length,
    colleges,
    items: excludedItems,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (${out.count} excluded institutions)`);
}

main();
