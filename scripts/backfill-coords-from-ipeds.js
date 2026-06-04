// Fill missing campus coordinates in college-coords.json from IPEDS hd20xx.csv,
// which carries authoritative LATITUDE/LONGITUD for every accredited US
// institution — offline, no rate-limited geocoder needed. Seeds from jobs.json
// (colleges with no coord entry at all), only adds colleges that currently lack
// valid coords, and disambiguates same-named institutions by state.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseCsv, clean } from "./lib/ipeds.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IPEDS = path.join(ROOT, "data", "ipeds", "hd2024.csv");
const JOBS = path.join(ROOT, "public", "jobs.json");
const COORD_PATHS = [path.join(ROOT, "public", "college-coords.json"), path.join(ROOT, "docs", "college-coords.json")];

const STATE_ABBR = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
  Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
  Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA",
  Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH",
  Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA",
  Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};
const ABBR_STATE = Object.fromEntries(Object.entries(STATE_ABBR).map(([k, v]) => [v, k]));
// Non-abbrev source labels → full state name.
const SOURCE_STATE = {
  "CA - CSU": "California", UC: "California", "CA Private": "California", "Claremont Colleges": "California",
  Claremont: "California", UMass: "Massachusetts", "MA Private": "Massachusetts", "UMass Amherst": "Massachusetts",
  "CT State": "Connecticut",
};

// Scraper college name → IPEDS INSTNM, for institutions whose names don't
// normalize to the IPEDS spelling.
const NAME_ALIASES = {
  "University of South Carolina": "University of South Carolina-Columbia",
  "SUNY Herkimer": "Herkimer County Community College",
};

const norm = (s) =>
  clean(s).toLowerCase().replace(/\(.*?\)/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

function abbrevFor(source, systemGroup) {
  const s = clean(source);
  if (/^[A-Z]{2}$/.test(s) && ABBR_STATE[s]) return s;
  const full = SOURCE_STATE[s] || (systemGroup && STATE_ABBR[systemGroup] ? systemGroup : null);
  return full ? STATE_ABBR[full] || null : null;
}

// IPEDS name → [{lat, lon, st}]
const rows = parseCsv(fs.readFileSync(IPEDS, "utf8"));
const ipedsByName = new Map();
for (const r of rows) {
  const name = clean(r.INSTNM);
  const lat = Number(r.LATITUDE);
  const lon = Number(r.LONGITUD);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const k = norm(name);
  if (!ipedsByName.has(k)) ipedsByName.set(k, []);
  ipedsByName.get(k).push({ lat, lon, st: clean(r.STABBR).toUpperCase() });
}

// Distinct colleges from jobs.json with a representative source/systemGroup.
const jobs = readJson(JOBS)?.jobs || [];
const collegeMeta = new Map();
for (const j of jobs) {
  const c = clean(j?.college);
  if (!c || collegeMeta.has(c)) continue;
  collegeMeta.set(c, { source: j?.source, systemGroup: j?.systemGroup });
}

const existing = readJson(COORD_PATHS[0]) || { colleges: {} };
const colleges = existing.colleges || {};

let filled = 0;
const ambiguous = [];
const unmatched = [];
for (const [name, meta] of collegeMeta) {
  const cur = colleges[name];
  if (cur && Number.isFinite(Number(cur.lat)) && Number.isFinite(Number(cur.lon))) continue; // already good
  const cands = ipedsByName.get(norm(name)) || (NAME_ALIASES[name] && ipedsByName.get(norm(NAME_ALIASES[name])));
  if (!cands || cands.length === 0) { unmatched.push(name); continue; }
  const abbr = abbrevFor(meta.source, meta.systemGroup);
  let pick;
  if (cands.length === 1) pick = cands[0];
  else {
    const byState = abbr ? cands.filter((c) => c.st === abbr) : [];
    if (byState.length >= 1) pick = byState[0];
    else { ambiguous.push(`${name} [${abbr || "?"}]`); continue; }
  }
  colleges[name] = {
    ...(cur || {}),
    lat: pick.lat,
    lon: pick.lon,
    state: (cur && cur.state) || (abbr ? ABBR_STATE[abbr] : null),
    source: "ipeds",
  };
  filled += 1;
}

const payload = { ...existing, ipedsBackfilledAt: new Date().toISOString(), colleges };
for (const p of COORD_PATHS) fs.writeFileSync(p, JSON.stringify(payload, null, 2));

console.log(`IPEDS backfill: filled ${filled} colleges.`);
console.log(`Ambiguous (skipped): ${ambiguous.length}`, ambiguous.slice(0, 20));
console.log(`Unmatched in IPEDS: ${unmatched.length}`);
console.log(unmatched.slice(0, 40).map((n) => "  - " + n).join("\n"));
