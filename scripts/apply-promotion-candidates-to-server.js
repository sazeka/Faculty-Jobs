#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SERVER_PATH = path.join(ROOT, "server.js");
const CANDIDATES_PATH = path.join(ROOT, "generated", "promotion-candidates.json");
const REPORT_PATH = path.join(ROOT, "generated", "promotion-apply-report.json");

const STATE_TO_ARRAY = {
  AK: "AK_CAMPUSES",
  AL: "AL_CAMPUSES",
  AR: "AR_CAMPUSES",
  AZ: "AZ_CAMPUSES",
  CA: "CA_PRIVATE_CAMPUSES",
  CO: "CO_CAMPUSES",
  CT: "CT_PRIVATE_CAMPUSES",
  DE: "DE_CAMPUSES",
  FL: "FL_CAMPUSES",
  GA: "GA_CAMPUSES",
  HI: "HI_CAMPUSES",
  IA: "IA_CAMPUSES",
  ID: "ID_CAMPUSES",
  IL: "IL_CAMPUSES",
  IN: "IN_CAMPUSES",
  KS: "KS_CAMPUSES",
  KY: "KY_CAMPUSES",
  LA: "LA_CAMPUSES",
  MA: "MA_PRIVATE_CAMPUSES",
  MD: "MD_CAMPUSES",
  ME: "ME_CAMPUSES",
  MI: "MI_CAMPUSES",
  MN: "MN_CAMPUSES",
  MO: "MO_CAMPUSES",
  MS: "MS_CAMPUSES",
  MT: "MT_CAMPUSES",
  NC: "NC_CAMPUSES",
  ND: "ND_CAMPUSES",
  NE: "NE_CAMPUSES",
  NJ: "NJ_PRIVATE_CAMPUSES",
  NM: "NM_CAMPUSES",
  NV: "NV_CAMPUSES",
  NH: "NH_CAMPUSES",
  NY: "NY_PRIVATE_CAMPUSES",
  OH: "OH_CAMPUSES",
  OK: "OK_CAMPUSES",
  OR: "OR_CAMPUSES",
  PA: "PA_PRIVATE_CAMPUSES",
  RI: "RI_PRIVATE_CAMPUSES",
  SC: "SC_CAMPUSES",
  SD: "SD_CAMPUSES",
  TN: "TN_CAMPUSES",
  TX: "TX_CAMPUSES",
  UT: "UT_CAMPUSES",
  VA: "VA_CAMPUSES",
  VT: "VT_CAMPUSES",
  WA: "WA_CAMPUSES",
  WV: "WV_CAMPUSES",
  WI: "WI_CAMPUSES",
  WY: "WY_CAMPUSES",
};

const UNKNOWN_NAME_TO_ARRAY = {
  "binghamton university (suny)": "NY_SUNY_CAMPUSES",
  "cheyney university": "PA_CAMPUSES",
  "east stroudsburg university": "PA_CAMPUSES",
  "kent state university": "OH_CAMPUSES",
  "kutztown university": "PA_CAMPUSES",
  "missouri state university": "MO_CAMPUSES",
  "south dakota board of regents": "SD_CAMPUSES",
  "southern illinois university carbondale": "IL_CAMPUSES",
  "the citadel": "SC_CAMPUSES",
  "university at albany (suny)": "NY_SUNY_CAMPUSES",
  "university of south carolina": "SC_CAMPUSES",
  "west chester university": "PA_CAMPUSES",
  "wright state university": "OH_CAMPUSES",
};

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function norm(v) {
  return clean(v).toLowerCase();
}

function escapeJs(v) {
  return String(v || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findArrayBounds(text, constName) {
  const startNeedle = `const ${constName} = [`;
  const start = text.indexOf(startNeedle);
  if (start < 0) return null;
  const from = start + startNeedle.length;
  const end = text.indexOf("\n];", from);
  if (end < 0) return null;
  return { start, from, end };
}

function targetArrayForCandidate(item) {
  const state = clean(item.state);
  if (state && state !== "Unknown") return STATE_TO_ARRAY[state] || null;
  return UNKNOWN_NAME_TO_ARRAY[norm(item.name)] || null;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    input: CANDIDATES_PATH,
    report: REPORT_PATH,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--input" && args[i + 1]) out.input = path.resolve(ROOT, args[++i]);
    else if (a === "--report" && args[i + 1]) out.report = path.resolve(ROOT, args[++i]);
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv);
  const serverText = fs.readFileSync(SERVER_PATH, "utf8");
  const candidatesPayload = JSON.parse(fs.readFileSync(opts.input, "utf8"));
  const items = Array.isArray(candidatesPayload?.items) ? candidatesPayload.items : [];

  const existingCampusNames = new Set();
  const campusRe = /campus:\s*"([^"]+)"/g;
  let m;
  while ((m = campusRe.exec(serverText)) !== null) existingCampusNames.add(norm(m[1]));

  const toInsertByArray = new Map();
  const skippedExisting = [];
  const skippedNoArray = [];
  const updated = [];

  let outText = serverText;

  for (const item of items) {
    const nameKey = norm(item.name);
    if (!nameKey) continue;

    // Locate the campus entry by finding the exact campus: "Name" needle, then
    // walking backwards to the nearest '{' and forwards to the nearest '},'.
    // This avoids the cross-entry regex that previously matched Yale's opening '{'
    // and WIU's closing '},' and corrupted Yale's type/url fields.
    const needle = `campus: "${escapeJs(item.name)}"`;
    const needleIdx = outText.indexOf(needle);
    if (needleIdx >= 0) {
      const openBrace = outText.lastIndexOf("{", needleIdx);
      const closeComma = outText.indexOf("},", needleIdx);
      if (openBrace >= 0 && closeComma > needleIdx) {
        const original = outText.slice(openBrace, closeComma + 2);
        // Only update if the object contains exactly this campus name (sanity check)
        if (original.includes(needle)) {
          // Never let the probe's platform-type guess downgrade an existing
          // specialized type back to "generic". The probe's classifier defaults
          // to "generic" whenever it doesn't recognize a URL's ATS signature —
          // including URLs that are already correctly configured with a specific
          // scraper (e.g. a myworkdayjobs.com URL it doesn't happen to detect as
          // Workday). Unconditionally trusting it here silently reverted ~13
          // previously-fixed institutions in one run (2026-08-02) back to
          // "workday"/"pageup"/"schooljobs"/"peopleadmin"/"stockton"/"nau-search"
          // → "generic", several of whose dispatchers hard-fail (return []) on
          // an unrecognized type rather than falling back to generic parsing.
          // Only apply the probe's guess when there's nothing specific to lose.
          const existingTypeMatch = original.match(/type:\s*"([^"]*)"/);
          const existingType = existingTypeMatch ? existingTypeMatch[1] : "";
          const typeToApply = existingType && existingType !== "generic" ? existingType : item.platform_type;

          let next = original;
          next = next.replace(/(type:\s*")[^"]*(")/, `$1${escapeJs(typeToApply)}$2`);
          next = next.replace(/(url:\s*")[^"]*(")/, `$1${escapeJs(item.career_url)}$2`);
          if (next !== original) {
            outText = outText.slice(0, openBrace) + next + outText.slice(closeComma + 2);
            updated.push({ name: item.name, state: item.state });
          } else {
            skippedExisting.push({ name: item.name, state: item.state, reason: "already present with same type/url" });
          }
          continue;
        }
      }
    }

    const arrayName = targetArrayForCandidate(item);
    if (!arrayName) {
      skippedNoArray.push({ name: item.name, state: item.state, reason: "no array mapping found" });
      continue;
    }

    const entry = `  { campus: "${escapeJs(item.name)}", type: "${escapeJs(item.platform_type)}", url: "${escapeJs(item.career_url)}" },`;
    if (!toInsertByArray.has(arrayName)) toInsertByArray.set(arrayName, []);
    toInsertByArray.get(arrayName).push({
      name: item.name,
      state: item.state,
      arrayName,
      entry,
    });
    existingCampusNames.add(nameKey);
  }

  const applied = [];
  const arrays = [...toInsertByArray.keys()];
  // Insert from bottom to top to avoid index shifting.
  const arrayWithPos = arrays
    .map((name) => ({ name, bounds: findArrayBounds(outText, name) }))
    .filter((x) => x.bounds)
    .sort((a, b) => b.bounds.end - a.bounds.end);

  const missingArrays = arrays.filter((name) => !arrayWithPos.some((x) => x.name === name));
  for (const name of missingArrays) {
    for (const row of toInsertByArray.get(name) || []) {
      skippedNoArray.push({ name: row.name, state: row.state, reason: `array ${name} not found in server.js` });
    }
  }

  for (const { name, bounds } of arrayWithPos) {
    const rows = (toInsertByArray.get(name) || []).sort((a, b) => a.name.localeCompare(b.name));
    if (rows.length === 0) continue;
    const block = `\n${rows.map((r) => r.entry).join("\n")}`;
    outText = outText.slice(0, bounds.end) + block + outText.slice(bounds.end);
    for (const row of rows) applied.push({ name: row.name, state: row.state, array: name });
  }

  fs.writeFileSync(SERVER_PATH, outText, "utf8");

  const report = {
    generatedAt: new Date().toISOString(),
    inputCount: items.length,
    updatedCount: updated.length,
    appliedCount: applied.length,
    skippedExistingCount: skippedExisting.length,
    skippedNoArrayCount: skippedNoArray.length,
    updated: updated.sort((a, b) => a.name.localeCompare(b.name)),
    applied: applied.sort((a, b) => a.name.localeCompare(b.name)),
    skippedExisting: skippedExisting.sort((a, b) => a.name.localeCompare(b.name)),
    skippedNoArray: skippedNoArray.sort((a, b) => a.name.localeCompare(b.name)),
  };
  fs.writeFileSync(opts.report, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(`Updated existing candidates: ${report.updatedCount}`);
  console.log(`Applied new candidates: ${report.appliedCount}`);
  console.log(`Skipped existing: ${report.skippedExistingCount}`);
  console.log(`Skipped no-array: ${report.skippedNoArrayCount}`);
  console.log(`Wrote ${path.relative(ROOT, opts.report)}`);
}

main();
