import {
  clean,
  firstField,
  mapControl,
  mapDegreeGranting,
  mapLevel,
  toInt,
} from "./ipeds.js";

export const US_STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ")
);

export function normalizeHomepageUrl(value) {
  const raw = clean(value);
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString();
  } catch {
    return null;
  }
}

export function classifyIpedsRow(row) {
  const state = firstField(row, ["STABBR", "stabbr"]);
  const sectorRaw = firstField(row, ["SECTOR", "sector"]);
  const control = mapControl(firstField(row, ["CONTROL", "control"]), sectorRaw);
  const level = mapLevel(firstField(row, ["ICLEVEL", "iclevel"]));
  const isDegreeGranting = mapDegreeGranting(
    firstField(row, ["DEGGRANT", "deggrant"]),
    sectorRaw
  );

  if (!US_STATE_CODES.has(state)) return { eligible: false, reason: "outside_us_states" };
  if (!isDegreeGranting) return { eligible: false, reason: "not_degree_granting" };
  if (!["2-year", "4-year"].includes(level)) return { eligible: false, reason: "level_out_of_scope" };
  if (!["public", "private nonprofit"].includes(control)) return { eligible: false, reason: "control_out_of_scope" };
  if (clean(row.ACT).toUpperCase() !== "A" || clean(row.CYACTIVE) !== "1") {
    return { eligible: false, reason: "inactive_or_closed" };
  }

  return { eligible: true, reason: "active_eligible" };
}

export function nationalInstitutionFromIpeds(row, now = new Date().toISOString()) {
  const sectorRaw = firstField(row, ["SECTOR", "sector"]);
  return {
    unitid: toInt(firstField(row, ["UNITID", "unitid"])),
    name: firstField(row, ["INSTNM", "instnm"]),
    // IPEDS aliases are often short, ambiguous acronyms ("HCC", "LCC", etc.).
    // Keep identity joins UNITID-first and avoid introducing alias collisions
    // into the public master list.
    aliases: [],
    state: firstField(row, ["STABBR", "stabbr"]) || null,
    sector: toInt(sectorRaw),
    level: mapLevel(firstField(row, ["ICLEVEL", "iclevel"])),
    control: mapControl(firstField(row, ["CONTROL", "control"]), sectorRaw),
    is_degree_granting: mapDegreeGranting(
      firstField(row, ["DEGGRANT", "deggrant"]),
      sectorRaw
    ),
    homepage_url: normalizeHomepageUrl(firstField(row, ["WEBADDR", "webaddr"])),
    career_url: null,
    platform_type: null,
    coverage_source: null,
    coverage_status: "missing",
    verification_status: "unchecked",
    last_verified_at: null,
    last_seen_job_count: 0,
    job_presence_status: "no_jobs_found",
    last_checked_at: now,
    metadata_source: "IPEDS",
    reconciliation_source: "IPEDS national reconciliation",
    national_reconciliation_status: "missing_career_url",
    notes: "Active eligible institution added by IPEDS national reconciliation; career URL discovery pending.",
  };
}
