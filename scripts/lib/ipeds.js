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
      state: firstField(row, ["STABBR", "stabbr", "STATE", "state"]) || null,
      sector: sectorRaw ? toInt(sectorRaw) : null,
      level: mapLevel(levelRaw),
      control,
      is_degree_granting: isDegreeGrantingBySector(sectorRaw),
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
// where most records have no unitid and must match on name.
export function buildLookupByName(mappedRows) {
  const byName = new Map();
  for (const r of mappedRows) {
    byName.set(key(r.name), r);
  }
  return byName;
}
