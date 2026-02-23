#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SERVER_PATH = path.join(ROOT, "server.js");
const JOBS_PATH = path.join(ROOT, "public", "jobs.json");
const OUT_PATH = path.join(ROOT, "data", "institutions-master.json");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return clean(value).toLowerCase();
}

function inferPlatformFromUrl(url) {
  const u = String(url || "").toLowerCase();
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
  if (u.includes("aprecruit") || u.includes("apol-recruit") || u.includes("recruit.ap.")) return "ap-recruit";
  if (u.includes("/en-us/filter")) return "enusfilter";
  return "generic";
}

function parseCampusConfigs(serverText) {
  const rows = [];
  const lines = serverText.split(/\r?\n/);
  let cur = null;

  const flush = () => {
    if (cur && cur.campus && cur.url) {
      rows.push({
        name: clean(cur.campus),
        career_url: clean(cur.url),
        platform_type: clean(cur.type) || inferPlatformFromUrl(cur.url),
      });
    }
    cur = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const campusMatch = line.match(/campus:\s*"([^"]+)"/);
    const typeMatch = line.match(/type:\s*"([^"]+)"/);
    const urlMatch = line.match(/url:\s*"([^"]+)"/);

    if (line.startsWith("{")) {
      // New object start; flush any incomplete previous object.
      if (cur && (cur.campus || cur.url || cur.type)) flush();
      cur = {};
    }

    if (!cur) continue;
    if (campusMatch) cur.campus = campusMatch[1];
    if (typeMatch) cur.type = typeMatch[1];
    if (urlMatch) cur.url = urlMatch[1];

    if (line.startsWith("},") || line === "}") {
      flush();
    }
  }
  flush();

  const dedup = new Map();
  for (const r of rows) {
    const k = normalizeKey(r.name);
    if (!dedup.has(k)) dedup.set(k, r);
  }
  return [...dedup.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readJsonOrNull(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const serverText = fs.readFileSync(SERVER_PATH, "utf8");
  const configured = parseCampusConfigs(serverText);

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
    existingMap.set(normalizeKey(row?.name), row);
  }

  const result = [];
  const seen = new Set();

  for (const c of configured) {
    const key = normalizeKey(c.name);
    seen.add(key);
    const prev = existingMap.get(key) || {};
    const currentJobCount = jobCountByCollege.get(c.name) || 0;

    result.push({
      unitid: prev.unitid || null,
      name: c.name,
      aliases: Array.isArray(prev.aliases) ? prev.aliases : [],
      state: prev.state || null,
      sector: prev.sector || null,
      level: prev.level || null,
      control: prev.control || null,
      is_degree_granting: typeof prev.is_degree_granting === "boolean" ? prev.is_degree_granting : null,
      career_url: c.career_url,
      platform_type: c.platform_type || null,
      coverage_status: currentJobCount > 0 ? "covered" : "missing",
      last_seen_job_count: currentJobCount,
      last_checked_at: new Date().toISOString(),
      notes: prev.notes || null,
    });
  }

  for (const [college, count] of jobCountByCollege.entries()) {
    const key = normalizeKey(college);
    if (seen.has(key)) continue;
    const prev = existingMap.get(key) || {};
    result.push({
      unitid: prev.unitid || null,
      name: college,
      aliases: Array.isArray(prev.aliases) ? prev.aliases : [],
      state: prev.state || null,
      sector: prev.sector || null,
      level: prev.level || null,
      control: prev.control || null,
      is_degree_granting: typeof prev.is_degree_granting === "boolean" ? prev.is_degree_granting : null,
      career_url: prev.career_url || null,
      platform_type: prev.platform_type || null,
      coverage_status: "covered",
      last_seen_job_count: count,
      last_checked_at: new Date().toISOString(),
      notes: prev.notes || "Present in jobs data but missing from explicit campus config.",
    });
  }

  // Preserve institutions that exist in the master (e.g., imported from IPEDS)
  // but are not currently in scraper config or current jobs snapshot.
  for (const [k, prev] of existingMap.entries()) {
    if (seen.has(k)) continue;
    result.push({
      unitid: prev.unitid || null,
      name: prev.name || null,
      aliases: Array.isArray(prev.aliases) ? prev.aliases : [],
      state: prev.state || null,
      sector: prev.sector ?? null,
      level: prev.level || null,
      control: prev.control || null,
      is_degree_granting: typeof prev.is_degree_granting === "boolean" ? prev.is_degree_granting : null,
      career_url: prev.career_url || null,
      platform_type: prev.platform_type || null,
      coverage_status: prev.coverage_status || "missing",
      last_seen_job_count: Number(prev.last_seen_job_count || 0),
      last_checked_at: new Date().toISOString(),
      notes: prev.notes || "Preserved from previous master snapshot.",
    });
  }

  // Enforce global exclusion of private for-profit institutions.
  const filtered = result.filter((r) => String(r?.control || "").toLowerCase() !== "private for-profit");
  filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      configuredFrom: path.relative(ROOT, SERVER_PATH),
      jobsFrom: path.relative(ROOT, JOBS_PATH),
      note: "Seeded from current scraper config + current jobs snapshot. Replace/merge with IPEDS UNITID master for full national coverage.",
    },
    counts: {
      totalInstitutions: filtered.length,
      covered: filtered.filter((r) => r.coverage_status === "covered").length,
      missing: filtered.filter((r) => r.coverage_status === "missing").length,
    },
    institutions: filtered,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (${out.counts.totalInstitutions} institutions)`);
}

main();
