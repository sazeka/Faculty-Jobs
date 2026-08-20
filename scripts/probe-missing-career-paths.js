#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isRejectedCareerPage } from "./lib/career-path-probe.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const IPEDS_PATH = path.join(ROOT, "data", "ipeds", "hd2024.csv");
const REPORT_PATH = path.join(ROOT, "generated", "career-path-probe-report.json");

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function norm(v) {
  return clean(v).toLowerCase();
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { limit: 100, concurrency: 8, apply: true, timeoutMs: 9000 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--limit" && args[i + 1]) out.limit = Math.max(1, Number(args[++i]));
    else if (a === "--concurrency" && args[i + 1]) out.concurrency = Math.max(1, Number(args[++i]));
    else if (a === "--timeout-ms" && args[i + 1]) out.timeoutMs = Math.max(2000, Number(args[++i]));
    else if (a === "--dry-run") out.apply = false;
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
      } else if (ch === '"') inQuotes = false;
      else field += ch;
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

function normalizeUrl(v) {
  let u = clean(v);
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    return new URL(u).toString();
  } catch {
    return null;
  }
}

function inferPlatform(url) {
  const u = norm(url);
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

// URL patterns that indicate a STUDENT-facing career-services / internship page
// (résumé help, internships, recreation jobs) rather than faculty/staff employment.
const STUDENT_CAREER_RE =
  /career-services|career[-_]?center|career-development|student-services|recreational|aquatics|\/students?\/|\binternships?\b/;

function scoreCandidate(url, bodyText) {
  if (isRejectedCareerPage(url, bodyText)) return 0;
  const u = norm(url);
  const t = norm(bodyText).slice(0, 12000);
  let s = 0;
  if (/\bcareers?\b|\bjobs?\b|\bemployment\b|\bopenings?\b/.test(u)) s += 0.45;
  if (/\bfaculty\b|\bacademic\b|\bprofessor\b/.test(u)) s += 0.25;
  if (/\bfaculty\b|\bopen positions\b|\bjob search\b|\bemployment opportunities\b/.test(t)) s += 0.25;
  if (/\blogin\b|\bsign in\b/.test(t) && !/\bjob\b/.test(t)) s -= 0.15;
  // Demote student career-services pages so they fall below the apply threshold.
  if (STUDENT_CAREER_RE.test(u)) s -= 0.3;
  if (s < 0) s = 0;
  if (s > 0.99) s = 0.99;
  return Number(s.toFixed(2));
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 FacultyJobsProbe/1.0" },
    });
    const finalUrl = r.url || url;
    const ok = r.status >= 200 && r.status < 400;
    const text = ok ? await r.text() : "";
    return { ok, status: r.status, finalUrl, text };
  } catch (e) {
    return { ok: false, status: 0, finalUrl: url, text: "", error: e?.name || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function buildProbeUrls(baseUrl) {
  try {
    const b = new URL(baseUrl);
    const origin = `${b.protocol}//${b.host}`;
    const paths = [
      "/careers",
      "/jobs",
      "/employment",
      "/human-resources",
      "/human-resources/jobs",
      "/about/employment",
      "/faculty-employment",
      "/academics/faculty-jobs",
      "/job-opportunities",
      "/careers/faculty",
    ];
    const out = [baseUrl, origin, ...paths.map((p) => origin + p)];
    return [...new Set(out)];
  } catch {
    return [baseUrl];
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let idx = 0;
  async function run() {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      out[i] = await worker(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return out;
}

function chooseTargets(master, ipedsByUnitid, ipedsByName, limit) {
  const unresolved = (master.institutions || [])
    .filter((i) => norm(i.coverage_status) === "missing")
    // Target institutions with no *real* career page: either no career_url, or a
    // career_url that's just the homepage (the build's fallback, not a job listing).
    .filter((i) => {
      const career = clean(i.career_url);
      const home = clean(i.homepage_url);
      return !career || career === home;
    })
    .filter((i) => {
      const c = norm(i.control);
      return c !== "private for-profit";
    })
    .filter((i) => i.is_degree_granting !== false)
    .filter((i) => {
      const lvl = norm(i.level);
      return !lvl || lvl === "2-year" || lvl === "4-year";
    })
    .sort((a, b) => clean(a.name).localeCompare(clean(b.name)));

  const selected = [];
  for (const inst of unresolved) {
    if (selected.length >= limit) break;
    const uid = Number(inst.unitid);
    const row = (Number.isFinite(uid) && ipedsByUnitid.get(uid)) || ipedsByName.get(norm(inst.name));
    // Prefer the authoritative IPEDS web address; fall back to the homepage we
    // already have so a missing WEBADDR doesn't skip an otherwise-probeable site.
    const web = normalizeUrl(row?.WEBADDR) || normalizeUrl(inst.homepage_url);
    if (!web) continue;
    selected.push({ inst, web });
  }
  return selected;
}

async function main() {
  const opts = parseArgs(process.argv);
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const ipedsRows = parseCsv(fs.readFileSync(IPEDS_PATH, "utf8"));

  const ipedsByUnitid = new Map();
  const ipedsByName = new Map();
  for (const r of ipedsRows) {
    const uid = Number.parseInt(clean(r.UNITID), 10);
    if (Number.isFinite(uid)) ipedsByUnitid.set(uid, r);
    const nm = clean(r.INSTNM);
    if (nm) ipedsByName.set(norm(nm), r);
  }

  const targets = chooseTargets(master, ipedsByUnitid, ipedsByName, opts.limit);
  console.log(`Probing career paths for ${targets.length} missing institutions...`);

  let updated = 0;
  const results = await mapWithConcurrency(targets, opts.concurrency, async ({ inst, web }, i) => {
    const probeUrls = buildProbeUrls(web);
    let best = null;
    for (const u of probeUrls) {
      const r = await fetchText(u, opts.timeoutMs);
      if (!r.ok) continue;
      if (isRejectedCareerPage(r.finalUrl, r.text)) continue;
      const score = scoreCandidate(r.finalUrl, r.text || "");
      const cand = { url: r.finalUrl, sourceUrl: u, score, platform_type: inferPlatform(r.finalUrl), status: r.status };
      if (!best || cand.score > best.score) best = cand;
      if (score >= 0.75) break;
    }

    const row = {
      name: inst.name,
      state: inst.state || null,
      level: inst.level || null,
      seededFrom: web,
      best,
      updated: false,
    };

    if (best && best.score >= 0.55 && opts.apply) {
      inst.career_url = best.url;
      if (!clean(inst.platform_type)) inst.platform_type = best.platform_type || "generic";
      inst.last_checked_at = new Date().toISOString();
      inst.discovery_attempts = Number(inst.discovery_attempts || 0) + 1;
      inst.last_discovery_attempt_at = new Date().toISOString();
      inst.last_discovery_status = "path_probe";
      inst.last_discovery_confidence = best.score;
      inst.notes = clean(`${inst.notes || ""} Career path probe seeded ${new Date().toISOString()}.`).trim();
      updated += 1;
      row.updated = true;
    }

    if ((i + 1) % 25 === 0) console.log(`...processed ${i + 1}/${targets.length}`);
    return row;
  });

  if (opts.apply) {
    master.generatedAt = new Date().toISOString();
    master.counts = {
      totalInstitutions: master.institutions.length,
      covered: master.institutions.filter((r) => norm(r.coverage_status) === "covered").length,
      missing: master.institutions.filter((r) => norm(r.coverage_status) === "missing").length,
    };
    fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n", "utf8");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    options: opts,
    scanned: targets.length,
    updated,
    candidatesFound: results.filter((r) => r.best).length,
    lowConfidence: results.filter((r) => r.best && r.best.score < 0.55).length,
    results,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`Wrote ${path.relative(ROOT, REPORT_PATH)} (updated=${updated}/${targets.length})`);
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
