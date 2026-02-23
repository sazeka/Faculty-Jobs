#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const IPEDS_CSV_PATH = path.join(ROOT, "data", "ipeds", "hd2024.csv");
const OUT_PREP_PATH = path.join(ROOT, "generated", "scrape-config-additions.json");

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function normalize(v) {
  return clean(v).toLowerCase();
}

function usage() {
  console.log("Usage: node scripts/seed-missing-from-ipeds-webaddr.js [--limit 25]");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { limit: 25 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      usage();
      process.exit(0);
    }
    if (args[i] === "--limit" && args[i + 1]) out.limit = Math.max(1, Number(args[++i]));
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = "";
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === '\r') {
      // ignore
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const headers = (rows[0] || []).map((h) => clean(h).replace(/^\uFEFF/, ""));
  return rows.slice(1).map((r) => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = r[i] ?? "";
    return obj;
  });
}

function inferPlatformFromUrl(url) {
  const u = normalize(url);
  if (!u) return null;
  if (u.includes("myworkdayjobs.com") || u.includes("myworkdaysite.com")) return "workday";
  if (u.includes("pageuppeople.com")) return "pageup";
  if (u.includes("taleo.net")) return "taleo";
  if (u.includes("peopleadmin.com")) return "peopleadmin";
  if (u.includes("schooljobs.com")) return "schooljobs";
  if (u.includes("csod.com")) return "csod";
  if (u.includes("paycomonline.net")) return "paycom";
  if (u.includes("interviewexchange.com")) return "interviewexchange";
  if (u.includes("jobvite.com")) return "jobvite";
  if (u.includes("interfolio.com")) return "interfolio";
  if (u.includes("icims.com")) return "icims";
  if (u.includes("greenhouse.io")) return "greenhouse";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("/en-us/filter")) return "enusfilter";
  return "generic";
}

function normalizeUrl(v) {
  let u = clean(v);
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const x = new URL(u);
    return x.toString();
  } catch {
    return null;
  }
}

function isEligible(inst) {
  const level = normalize(inst.level);
  if (level && !["2-year", "4-year"].includes(level)) return false;
  if (inst.is_degree_granting === false) return false;
  return true;
}

function main() {
  const opts = parseArgs(process.argv);
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const rows = parseCsv(fs.readFileSync(IPEDS_CSV_PATH, "utf8"));

  const byUnitid = new Map();
  const byName = new Map();
  for (const r of rows) {
    const uid = Number.parseInt(clean(r.UNITID), 10);
    if (Number.isFinite(uid)) byUnitid.set(uid, r);
    const nm = clean(r.INSTNM);
    if (nm) byName.set(normalize(nm), r);
  }

  const unresolved = (master.institutions || [])
    .filter((i) => normalize(i.coverage_status) === "missing")
    .filter((i) => !clean(i.career_url) || !clean(i.platform_type))
    .filter(isEligible)
    .sort((a, b) => clean(a.name).localeCompare(clean(b.name)));

  const selected = [];

  for (const inst of unresolved) {
    if (selected.length >= opts.limit) break;

    let row = null;
    const uid = Number(inst.unitid);
    if (Number.isFinite(uid) && byUnitid.has(uid)) row = byUnitid.get(uid);
    if (!row) row = byName.get(normalize(inst.name));
    if (!row) continue;

    const web = normalizeUrl(row.WEBADDR);
    if (!web) continue;

    const platform = inferPlatformFromUrl(web);
    inst.career_url = web;
    if (!clean(inst.platform_type)) inst.platform_type = platform;
    inst.last_checked_at = new Date().toISOString();
    inst.notes = clean(`${inst.notes || ""} Seeded from IPEDS WEBADDR on ${new Date().toISOString()}.`).trim();

    selected.push({
      name: inst.name,
      state: inst.state || null,
      level: inst.level || null,
      unitid: inst.unitid || null,
      career_url: inst.career_url,
      platform_type: inst.platform_type || platform || "generic",
      source: "IPEDS WEBADDR",
      confidence: "low",
      needs_manual_review: true,
    });
  }

  fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n", "utf8");

  const grouped = {};
  for (const s of selected) {
    const k = s.platform_type || "generic";
    (grouped[k] ||= []).push(s);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    method: "Seed from IPEDS WEBADDR for unresolved eligible institutions",
    limit: opts.limit,
    selectedCount: selected.length,
    groupedByPlatform: grouped,
    items: selected,
  };

  fs.mkdirSync(path.dirname(OUT_PREP_PATH), { recursive: true });
  fs.writeFileSync(OUT_PREP_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(`Updated ${selected.length} institutions in data/institutions-master.json`);
  console.log(`Wrote ${path.relative(ROOT, OUT_PREP_PATH)}`);
}

main();
