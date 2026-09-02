// Shared IPEDS (hd20xx.csv) parsing and code→label mapping.
// Used by both scripts/import-ipeds-csv.js and scripts/build-institutions-master.js
// so institution metadata (state/control/level) has a single source of truth.

export function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

export function key(v) {
  return clean(v).toLowerCase();
}

export function toInt(v) {
  const n = Number.parseInt(String(v || "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, CRLF.
export function parseCsv(text) {
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

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // Ignore CR; LF handles record end.
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  // Strip a UTF-8 BOM that IPEDS prepends to the first header cell.
  const headers = rows[0].map((h) => clean(h).replace(/^﻿/, ""));
  const out = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = r[c] ?? "";
    }
    out.push(obj);
  }
  return out;
}

export function firstField(row, candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined && clean(row[c]) !== "") return clean(row[c]);
  }
  return "";
}

export function normalizeHomepageUrl(value) {
  let url = clean(value);
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

export function mapControl(controlCode, sectorCode) {
  const c = toInt(controlCode);
  if (c === 1) return "public";
  if (c === 2) return "private nonprofit";
  if (c === 3) return "private for-profit";

  // Fallback from sector code.
  const s = toInt(sectorCode);
  if ([1, 4, 7].includes(s)) return "public";
  if ([2, 5, 8].includes(s)) return "private nonprofit";
  if ([3, 6, 9].includes(s)) return "private for-profit";
  return null;
}

export function mapLevel(iclevelCode) {
  const lvl = toInt(iclevelCode);
  if (lvl === 1) return "4-year";
  if (lvl === 2) return "2-year";
  if (lvl === 3) return "less-than-2-year";
  return null;
}

export function isDegreeGrantingBySector(sectorCode) {
  const s = toInt(sectorCode);
  if (s === null) return null;
  // IPEDS sectors 1-6 are degree-granting; 7-9 are non-degree-granting.
  if (s >= 1 && s <= 6) return true;
  if (s >= 7 && s <= 9) return false;
  return null;
}

export function mapDegreeGranting(degreeGrantingCode, sectorCode) {
  const explicit = toInt(degreeGrantingCode);
  if (explicit === 1) return true;
  if (explicit === 2) return false;
  return isDegreeGrantingBySector(sectorCode);
}

// IPEDS's IALIAS column packs multiple alternate names into one field with an
// inconsistent delimiter — usually "|", sometimes 2+ spaces, occasionally ";".
// A single space is never a delimiter (aliases are themselves multi-word), so
// splitting on any of the other three and dropping empties is safe.
export function parseIalias(raw) {
  return String(raw || "")
    .split(/\s*\|\s*|\s{2,}|\s*;\s*/)
    .map((a) => clean(a))
    .filter(Boolean);
}

// Map raw CSV rows → normalized institution metadata, dropping for-profits and
// deduplicating by unitid (preferred) or normalized name.
export function mapIpedsRows(rows) {
  const mapped = [];
  for (const row of rows) {
    const unitidRaw = firstField(row, ["UNITID", "unitid"]);
    const unitid = toInt(unitidRaw);
    const name = firstField(row, ["INSTNM", "instnm", "NAME", "name"]);
    if (!name) continue;

    const sectorRaw = firstField(row, ["SECTOR", "sector"]);
    const controlRaw = firstField(row, ["CONTROL", "control"]);
    const levelRaw = firstField(row, ["ICLEVEL", "iclevel", "LEVEL", "level"]);

    const control = mapControl(controlRaw, sectorRaw);
    if (control === "private for-profit") continue;

    mapped.push({
      unitid,
      name,
      // Raw field, not firstField()'s clean()-ed version — clean() collapses
      // runs of whitespace to one space, which destroys the 2+-space delimiter
      // parseIalias relies on to split multi-alias values.
      aliases: parseIalias(row.IALIAS ?? row.ialias ?? ""),
      homepage_url: normalizeHomepageUrl(
        firstField(row, ["WEBADDR", "webaddr"])
      ),
      state: firstField(row, ["STABBR", "stabbr", "STATE", "state"]) || null,
      sector: sectorRaw ? toInt(sectorRaw) : null,
      level: mapLevel(levelRaw),
      control,
      is_degree_granting: mapDegreeGranting(
        firstField(row, ["DEGGRANT", "deggrant"]),
        sectorRaw
      ),
    });
  }

  const dedup = new Map();
  for (const r of mapped) {
    const k = r.unitid ? `id:${r.unitid}` : `name:${key(r.name)}`;
    if (!dedup.has(k)) dedup.set(k, r);
  }
  return [...dedup.values()];
}

// Build a normalized-name → metadata lookup for joining against the master,
// where most records have no unitid and must match on name. Falls back to
// IALIAS (e.g. "UC Berkeley" for "University of California-Berkeley") for
// names that don't match any INSTNM directly — otherwise institutions whose
// scraper/config uses a common short name instead of IPEDS's full legal name
// silently lose unitid/state/control/level enrichment. An alias is only
// trusted when it resolves to exactly one institution: never let an alias
// override a real INSTNM slot (that would misattribute a different real
// institution), and never use an alias that's ambiguous across institutions
// (same "no silent false attribution" rule the TCSG/USG slug matchers use).
export function buildLookupByName(mappedRows) {
  const byName = new Map();
  for (const r of mappedRows) {
    byName.set(key(r.name), r);
  }

  const aliasCandidates = new Map(); // aliasKey -> Set of distinct institutions
  for (const r of mappedRows) {
    for (const alias of r.aliases || []) {
      const aliasKey = key(alias);
      if (!aliasKey || byName.has(aliasKey)) continue; // never shadow a real INSTNM
      if (!aliasCandidates.has(aliasKey)) aliasCandidates.set(aliasKey, new Set());
      aliasCandidates.get(aliasKey).add(r.unitid ? `id:${r.unitid}` : `name:${key(r.name)}`);
    }
  }
  for (const r of mappedRows) {
    for (const alias of r.aliases || []) {
      const aliasKey = key(alias);
      if (!aliasKey || byName.has(aliasKey)) continue;
      if (aliasCandidates.get(aliasKey)?.size === 1) byName.set(aliasKey, r);
    }
  }

  return byName;
}

// Conservative secondary key for legal-name punctuation and common system
// abbreviations used by scraper labels. Callers must still require uniqueness:
// this is intentionally not a fuzzy/string-distance match.
export function relaxedInstitutionNameKey(value) {
  return clean(value)
    .replace(/\((?:SUNY|WV|KS|UTAH)\)$/i, "")
    .replace(/^SUNY\s+/i, "")
    .replace(/^UMass\s+/i, "University of Massachusetts ")
    .replace(/^UNC[-\s]+/i, "University of North Carolina ")
    .replace(/^UW[-\s]+/i, "University of Wisconsin ")
    .replace(/^CU\s+/i, "University of Colorado ")
    .replace(/\bCCD\b/gi, "Community College District")
    .replace(/&/g, " and ")
    .replace(/\bthe\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function relaxedNameVariants(value) {
  const base = clean(value);
  const variants = new Set([relaxedInstitutionNameKey(base)]);
  const withoutCampusQualifier = base
    .replace(/-(?:Main Campus|Fort Collins|Springfield|Columbia|Twin Cities|Seattle Campus|Ann Arbor)$/i, "")
    .replace(/\s+Campus Immersion$/i, "")
    .replace(/\s+at Kent$/i, "")
    .replace(/\s+of Pennsylvania$/i, "")
    .replace(/\s+of New Jersey$/i, "");
  variants.add(relaxedInstitutionNameKey(withoutCampusQualifier));
  return [...variants].filter(Boolean);
}

export function buildRelaxedLookupByName(mappedRows) {
  const candidates = new Map();
  for (const row of mappedRows) {
    for (const candidate of [row.name, ...(row.aliases || [])]) {
      for (const candidateKey of relaxedNameVariants(candidate)) {
        if (!candidates.has(candidateKey)) candidates.set(candidateKey, new Map());
        const identity = row.unitid ? `id:${row.unitid}` : `name:${key(row.name)}`;
        candidates.get(candidateKey).set(identity, row);
      }
    }
  }

  const lookup = new Map();
  for (const [candidateKey, rows] of candidates) {
    if (rows.size === 1) lookup.set(candidateKey, [...rows.values()][0]);
  }
  return lookup;
}
