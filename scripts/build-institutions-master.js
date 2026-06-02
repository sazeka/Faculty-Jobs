#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadCampusConfigs } from "./lib/campus-config.js";
import { canonicalizeUrl, clean, normalizeNameKey, inferPlatformFromUrl } from "./lib/url-normalization.js";
import { parseCsv, mapIpedsRows, buildLookupByName } from "./lib/ipeds.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const JOBS_PATH = path.join(ROOT, "public", "jobs.json");
const OUT_PATH = path.join(ROOT, "data", "institutions-master.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const LINK_STATUS_PATH = path.join(ROOT, "generated", "institution-link-status.json");
const QUARANTINE_PATH = path.join(ROOT, "generated", "career-link-quarantine.json");
const IPEDS_DIR = path.join(ROOT, "data", "ipeds");

// Load a normalized-name → metadata lookup from the latest IPEDS hd*.csv so that
// state/control/level/is_degree_granting are always populated from the source of
// truth, instead of perpetually carrying forward null from the previous master.
function buildIpedsLookup() {
  try {
    const files = fs
      .readdirSync(IPEDS_DIR)
      .filter((f) => /^hd\d{4}\.csv$/i.test(f))
      .sort();
    if (files.length === 0) return { lookup: new Map(), file: null };
    const file = files[files.length - 1]; // latest year
    const rows = parseCsv(fs.readFileSync(path.join(IPEDS_DIR, file), "utf8"));
    return { lookup: buildLookupByName(mapIpedsRows(rows)), file };
  } catch {
    return { lookup: new Map(), file: null };
  }
}

function readJsonOrNull(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function buildOverridesMap() {
  const data = readJsonOrNull(OVERRIDES_PATH);
  const rows = Array.isArray(data?.overrides) ? data.overrides : [];
  const map = new Map();
  for (const row of rows) {
    const name = clean(row?.name);
    if (!name) continue;
    map.set(normalizeNameKey(name), {
      homepage_url: canonicalizeUrl(row?.homepage_url),
      career_url: canonicalizeUrl(row?.career_url),
      platform_type: clean(row?.platform_type) || null,
      notes: clean(row?.notes) || null,
    });
  }
  return map;
}

function buildLinkStatusMap() {
  const data = readJsonOrNull(LINK_STATUS_PATH);
  const rows = Array.isArray(data?.institutions) ? data.institutions : [];
  const map = new Map();
  for (const row of rows) {
    const name = clean(row?.name);
    if (!name) continue;
    map.set(normalizeNameKey(name), row);
  }
  return map;
}

function buildQuarantineSet() {
  const data = readJsonOrNull(QUARANTINE_PATH);
  const rows = Array.isArray(data?.institutions) ? data.institutions : [];
  return new Set(rows.map((r) => normalizeNameKey(r?.name)).filter(Boolean));
}

function main() {
  const configured = loadCampusConfigs();

  const jobsData = readJsonOrNull(JOBS_PATH) || {};
  const jobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : [];
  const jobCountByCollege = new Map();
  for (const j of jobs) {
    const name = clean(j?.college);
    if (!name) continue;
    jobCountByCollege.set(name, (jobCountByCollege.get(name) || 0) + 1);
  }

  const existing = readJsonOrNull(OUT_PATH);
  const existingMap = new Map();
  for (const row of Array.isArray(existing?.institutions) ? existing.institutions : []) {
    existingMap.set(normalizeNameKey(row?.name), row);
  }

  const overrides = buildOverridesMap();
  const linkStatusByName = buildLinkStatusMap();
  const quarantinedNames = buildQuarantineSet();

  const result = [];
  const seen = new Set();

  const buildUrls = (name, configuredUrl, prev) => {
    const key = normalizeNameKey(name);
    const ov = overrides.get(key);

    const homepage_url = canonicalizeUrl(
      ov?.homepage_url || prev?.homepage_url || configuredUrl || prev?.career_url
    );
    const career_url = canonicalizeUrl(
      ov?.career_url || configuredUrl || prev?.career_url || prev?.homepage_url
    );
    const platform_type = clean(ov?.platform_type || prev?.platform_type) || inferPlatformFromUrl(career_url) || "generic";

    return {
      homepage_url,
      career_url,
      platform_type,
      override_notes: ov?.notes || null,
    };
  };

  const applyVerification = (row) => {
    const key = normalizeNameKey(row.name);
    const link = linkStatusByName.get(key);
    const isQuarantined = quarantinedNames.has(key);

    const verification_status =
      (isQuarantined ? "quarantined_broken_link" : null) ||
      clean(link?.verification_status) ||
      clean(row.verification_status) ||
      "unchecked";

    const last_verified_at = link?.last_verified_at || row.last_verified_at || null;

    const merged = {
      ...row,
      verification_status,
      last_verified_at,
      quarantined_career_url: isQuarantined ? row.career_url : null,
    };

    if (isQuarantined) {
      merged.career_url = null;
      if (merged.coverage_status === "covered") merged.coverage_status = "missing";
      merged.notes = clean(`${merged.notes || ""} Quarantined due to repeated broken career link checks.`) || null;
    }

    return merged;
  };

  for (const c of configured) {
    const key = normalizeNameKey(c.name);
    seen.add(key);
    const prev = existingMap.get(key) || {};
    const currentJobCount = jobCountByCollege.get(c.name) || 0;
    const urls = buildUrls(c.name, c.career_url, prev);

    result.push(
      applyVerification({
        unitid: prev.unitid || null,
        name: c.name,
        aliases: Array.isArray(prev.aliases) ? prev.aliases : [],
        state: prev.state || null,
        sector: prev.sector || null,
        level: prev.level || null,
        control: prev.control || null,
        is_degree_granting: typeof prev.is_degree_granting === "boolean" ? prev.is_degree_granting : null,
        homepage_url: urls.homepage_url,
        career_url: urls.career_url,
        platform_type: urls.platform_type,
        coverage_status: currentJobCount > 0 ? "covered" : "missing",
        last_seen_job_count: currentJobCount,
        last_checked_at: new Date().toISOString(),
        notes: clean(`${prev.notes || ""} ${urls.override_notes || ""}`) || null,
      })
    );
  }

  for (const [college, count] of jobCountByCollege.entries()) {
    const key = normalizeNameKey(college);
    if (seen.has(key)) continue;
    const prev = existingMap.get(key) || {};
    const urls = buildUrls(college, prev?.career_url, prev);

    result.push(
      applyVerification({
        unitid: prev.unitid || null,
        name: college,
        aliases: Array.isArray(prev.aliases) ? prev.aliases : [],
        state: prev.state || null,
        sector: prev.sector || null,
        level: prev.level || null,
        control: prev.control || null,
        is_degree_granting: typeof prev.is_degree_granting === "boolean" ? prev.is_degree_granting : null,
        homepage_url: urls.homepage_url,
        career_url: urls.career_url,
        platform_type: urls.platform_type,
        coverage_status: "covered",
        last_seen_job_count: count,
        last_checked_at: new Date().toISOString(),
        notes: prev.notes || "Present in jobs data but missing from explicit campus config.",
      })
    );
  }

  for (const [key, prev] of existingMap.entries()) {
    if (seen.has(key)) continue;
    const urls = buildUrls(prev.name, prev.career_url, prev);

    result.push(
      applyVerification({
        unitid: prev.unitid || null,
        name: prev.name || null,
        aliases: Array.isArray(prev.aliases) ? prev.aliases : [],
        state: prev.state || null,
        sector: prev.sector ?? null,
        level: prev.level || null,
        control: prev.control || null,
        is_degree_granting: typeof prev.is_degree_granting === "boolean" ? prev.is_degree_granting : null,
        homepage_url: urls.homepage_url,
        career_url: urls.career_url,
        platform_type: urls.platform_type,
        coverage_status: prev.coverage_status || "missing",
        last_seen_job_count: Number(prev.last_seen_job_count || 0),
        last_checked_at: new Date().toISOString(),
        notes: prev.notes || "Preserved from previous master snapshot.",
      })
    );
  }

  // Enrich every record with IPEDS metadata (state/control/level/sector/unitid).
  // IPEDS is the source of truth; fall back to the prior value only when the name
  // doesn't match a known institution.
  const { lookup: ipedsByName, file: ipedsFile } = buildIpedsLookup();
  let ipedsMatched = 0;
  for (const r of result) {
    const hit = ipedsByName.get(normalizeNameKey(r.name));
    if (!hit) continue;
    ipedsMatched += 1;
    r.unitid = r.unitid || hit.unitid || null;
    r.state = hit.state || r.state || null;
    r.sector = hit.sector ?? r.sector ?? null;
    r.level = hit.level || r.level || null;
    r.control = hit.control || r.control || null;
    if (typeof hit.is_degree_granting === "boolean") r.is_degree_granting = hit.is_degree_granting;
  }
  if (ipedsFile) {
    console.log(`Enriched ${ipedsMatched}/${result.length} institutions from IPEDS (${ipedsFile})`);
  } else {
    console.warn("No IPEDS hd*.csv found in data/ipeds — state/control/level not enriched.");
  }

  const filtered = result.filter((r) => String(r?.control || "").toLowerCase() !== "private for-profit");
  filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      configuredFrom: "server.js",
      jobsFrom: path.relative(ROOT, JOBS_PATH),
      overridesFrom: path.relative(ROOT, OVERRIDES_PATH),
      linkStatusFrom: path.relative(ROOT, LINK_STATUS_PATH),
      quarantineFrom: path.relative(ROOT, QUARANTINE_PATH),
      ipedsFrom: ipedsFile ? path.relative(ROOT, path.join(IPEDS_DIR, ipedsFile)) : null,
      note: "Includes homepage_url + career_url split, override priority, link verification/quarantine metadata, and IPEDS-enriched state/control/level.",
    },
    counts: {
      totalInstitutions: filtered.length,
      covered: filtered.filter((r) => r.coverage_status === "covered").length,
      missing: filtered.filter((r) => r.coverage_status === "missing").length,
      quarantined: filtered.filter((r) => r.verification_status === "quarantined_broken_link").length,
    },
    institutions: filtered,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (${out.counts.totalInstitutions} institutions)`);
}

main();
