#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const RULES_PATH = path.join(ROOT, "data", "policy-rules.json");
const SERVER_PATH = path.join(ROOT, "server.js");
const OUT_PATH = path.join(ROOT, "generated", "promotion-candidates-next-batch.json");

const MAPPED_STATES = new Set([
  "AL", "CT", "DE", "FL", "GA", "IL", "IN", "MA", "MD", "MN", "NC", "NE", "NJ", "NY", "OH", "RI", "SC", "TX", "UT", "VA", "WI",
  "AZ", "CA", "PA", "OR", "WA", "ME", "VT", "ND", "SD", "IA", "WY", "MT", "CO", "NM", "NV", "ID", "WV", "MS", "LA", "AR", "KS", "OK", "MO", "KY", "TN", "AK", "HI", "MI",
]);

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function norm(v) {
  return clean(v).toLowerCase();
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { limit: 100, minScore: 0 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--limit" && args[i + 1]) out.limit = Math.max(1, Number(args[++i]));
    else if (a === "--min-score" && args[i + 1]) out.minScore = Number(args[++i]);
  }
  return out;
}

function scoreGenericUrl(url) {
  const u = norm(url);
  let score = 0;
  if (/(careers|jobs|employment|job-opportunities|faculty|open-positions|vacancies|work-with-us|join-our-team)/.test(u)) score += 0.6;
  if (/(human-resources|\/hr\b|\/hr\/)/.test(u)) score += 0.2;
  if (u.includes(".edu")) score += 0.1;
  if (/(admissions|apply|alumni|giving|donate|news|events|athletics|student-life)/.test(u)) score -= 0.25;
  try {
    const x = new URL(url);
    if (!x.pathname || x.pathname === "/") score -= 0.2;
  } catch {
    score -= 0.5;
  }
  return Number(score.toFixed(2));
}

function main() {
  const opts = parseArgs(process.argv);
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  const serverText = fs.readFileSync(SERVER_PATH, "utf8");

  const existingCampuses = new Set(
    [...serverText.matchAll(/campus:\s*"([^"]+)"/g)].map((x) => norm(x[1]))
  );
  const excludedByOverride = new Set(
    Object.entries(rules.institutionOverrides || {})
      .filter(([, cfg]) => norm(cfg?.action) === "exclude")
      .map(([name]) => norm(name))
  );

  const candidates = (master.institutions || [])
    .filter((r) => norm(r.coverage_status) === "missing")
    .filter((r) => norm(r.platform_type) === "generic")
    .filter((r) => clean(r.career_url))
    .filter((r) => !existingCampuses.has(norm(r.name)))
    .filter((r) => !excludedByOverride.has(norm(r.name)))
    .map((r) => ({
      unitid: r.unitid || null,
      name: clean(r.name),
      state: clean(r.state),
      level: clean(r.level) || "Unknown",
      control: clean(r.control) || "Unknown",
      platform_type: "generic",
      career_url: clean(r.career_url),
      score: scoreGenericUrl(r.career_url) + (MAPPED_STATES.has(clean(r.state)) ? 0.1 : 0),
      source: "institutions-master generic promotion scoring",
    }))
    .filter((r) => r.score >= opts.minScore)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, opts.limit);

  const byState = {};
  for (const c of candidates) byState[c.state] = (byState[c.state] || 0) + 1;

  const out = {
    generatedAt: new Date().toISOString(),
    options: opts,
    count: candidates.length,
    byState,
    items: candidates,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (${out.count} candidates)`);
}

main();
