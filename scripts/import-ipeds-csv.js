#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { clean, key, parseCsv, mapIpedsRows } from "./lib/ipeds.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const DEFAULT_OUT_PATH = MASTER_PATH;

function usage() {
  console.log("Usage: node scripts/import-ipeds-csv.js <ipeds_csv_path> [--out <output_json_path>]");
  console.log("Example: node scripts/import-ipeds-csv.js data/ipeds/HD2024.csv");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const csvPath = args[0];
  let outPath = DEFAULT_OUT_PATH;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      outPath = args[i + 1];
      i += 1;
    }
  }

  return {
    csvPath: path.isAbsolute(csvPath) ? csvPath : path.join(ROOT, csvPath),
    outPath: path.isAbsolute(outPath) ? outPath : path.join(ROOT, outPath),
  };
}

function loadMaster(p) {
  if (!fs.existsSync(p)) {
    return {
      generatedAt: null,
      source: { configuredFrom: null, jobsFrom: null, note: "" },
      counts: { totalInstitutions: 0, covered: 0, missing: 0 },
      institutions: [],
    };
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function recalcCounts(institutions) {
  return {
    totalInstitutions: institutions.length,
    covered: institutions.filter((r) => r.coverage_status === "covered").length,
    missing: institutions.filter((r) => r.coverage_status === "missing").length,
  };
}

function mergeMaster(master, ipedsRows) {
  const institutions = (Array.isArray(master.institutions) ? [...master.institutions] : [])
    .filter((inst) => clean(inst?.control).toLowerCase() !== "private for-profit");

  const byUnitid = new Map();
  const byName = new Map();
  for (let i = 0; i < institutions.length; i++) {
    const inst = institutions[i];
    if (inst?.unitid) byUnitid.set(Number(inst.unitid), i);
    if (inst?.name) byName.set(key(inst.name), i);
  }

  let updated = 0;
  let appended = 0;

  for (const row of ipedsRows) {
    let idx = -1;
    if (row.unitid && byUnitid.has(row.unitid)) idx = byUnitid.get(row.unitid);
    else if (byName.has(key(row.name))) idx = byName.get(key(row.name));

    if (idx >= 0) {
      const prev = institutions[idx];
      institutions[idx] = {
        ...prev,
        unitid: row.unitid || prev.unitid || null,
        name: prev.name || row.name,
        homepage_url: prev.homepage_url || row.homepage_url || null,
        state: row.state || prev.state || null,
        sector: row.sector ?? prev.sector ?? null,
        level: row.level || prev.level || null,
        control: row.control || prev.control || null,
        is_degree_granting:
          typeof row.is_degree_granting === "boolean"
            ? row.is_degree_granting
            : typeof prev.is_degree_granting === "boolean"
            ? prev.is_degree_granting
            : null,
        last_checked_at: new Date().toISOString(),
      };
      updated += 1;
      continue;
    }

    const next = {
      unitid: row.unitid || null,
      name: row.name,
      aliases: [],
      state: row.state || null,
      sector: row.sector ?? null,
      level: row.level || null,
      control: row.control || null,
      is_degree_granting: typeof row.is_degree_granting === "boolean" ? row.is_degree_granting : null,
      homepage_url: row.homepage_url || null,
      career_url: null,
      platform_type: null,
      coverage_status: "missing",
      last_seen_job_count: 0,
      last_checked_at: new Date().toISOString(),
      notes: "Imported from IPEDS; scraping config not yet mapped.",
    };

    institutions.push(next);
    const newIdx = institutions.length - 1;
    if (next.unitid) byUnitid.set(Number(next.unitid), newIdx);
    byName.set(key(next.name), newIdx);
    appended += 1;
  }

  institutions.sort((a, b) => clean(a.name).localeCompare(clean(b.name)));

  return {
    updated,
    appended,
    institutions,
  };
}

function main() {
  const { csvPath, outPath } = parseArgs(process.argv);

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(csvText);
  const mapped = mapIpedsRows(rows);

  if (mapped.length === 0) {
    console.error("No IPEDS institutions parsed. Check the CSV headers and format.");
    process.exit(1);
  }

  const master = loadMaster(MASTER_PATH);
  const merged = mergeMaster(master, mapped);

  const out = {
    ...master,
    generatedAt: new Date().toISOString(),
    source: {
      ...(master.source || {}),
      ipedsImport: {
        importedAt: new Date().toISOString(),
        sourceFile: path.relative(ROOT, csvPath),
        importedRows: mapped.length,
        updatedRows: merged.updated,
        appendedRows: merged.appended,
      },
      note:
        "Seeded from scraper config + jobs snapshot, then enriched via IPEDS import. Keep coverage_status and career_url fields for scraper targeting.",
    },
    counts: recalcCounts(merged.institutions),
    institutions: merged.institutions,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(`Imported IPEDS rows: ${mapped.length}`);
  console.log(`Updated institutions: ${merged.updated}`);
  console.log(`Appended institutions: ${merged.appended}`);
  console.log(`Wrote ${path.relative(ROOT, outPath)}`);
}

main();
