#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const IPEDS_PATH = path.join(ROOT, "data", "ipeds", "hd2024.csv");
const EXCLUSIONS_PATH = path.join(ROOT, "generated", "policy-excluded-colleges.json");
const TARGET_CONTROL = clean(process.env.FACULTY_JOBS_TARGET_CONTROL || "public").toLowerCase();
const TARGET_SLUG = TARGET_CONTROL.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const OUT_PATH = path.join(ROOT, "generated", `${TARGET_SLUG}-four-year-promotion-candidates.json`);
const REPORT_PATH = path.join(ROOT, "generated", `${TARGET_SLUG}-four-year-career-discovery-report.json`);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function norm(value) {
  return clean(value).toLowerCase();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = (rows.shift() || []).map((h) => clean(h).replace(/^\uFEFF/, ""));
  return rows.map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] || ""])));
}

function normalizeUrl(value) {
  let url = clean(value);
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function scoreEmploymentLink(url, label) {
  const text = norm(`${label} ${url}`);
  if (!/^https?:\/\//i.test(url)) return -100;
  if (/facebook|instagram|linkedin|youtube|twitter|\.pdf(?:$|\?)/.test(text)) return -100;
  const explicitStudentJob = /student[- /](?:employment|jobs?|support)|current[- /]students|on-campus student|explore careers|mentorship/.test(text);
  if (explicitStudentJob) return -100;
  const studentFacing = /career[- /]services|career[- /]center|alumni|internship|job[- /]placement|post a job|hire (?:a|our)|employers?/.test(text);
  const explicitHr = /human[- /]?resources|employment opportunities|job opportunities|job openings|current openings|open positions|work (?:at|for|with) (?:us|our)|join our team|faculty positions|staff positions/.test(text);
  if (studentFacing && !explicitHr) return -100;
  let score = 0;
  if (/employment opportunities|job opportunities|job openings|current openings|open positions/.test(text)) score += 18;
  if (/work (?:at|for|with) (?:us|our)|join our team|faculty positions|staff positions/.test(text)) score += 16;
  if (/human[- /]?resources|\bhr\b/.test(text)) score += 12;
  if (/\bemployment\b/.test(text)) score += 11;
  if (/\bjobs?\b/.test(text)) score += 10;
  if (/\bcareers?\b/.test(text)) score += 8;
  if (/myworkdayjobs|myworkdaysite|peopleadmin|schooljobs|pageuppeople|interfolio|jobs\.dayforce|careers\./.test(text)) score += 7;
  if (/faculty|staff/.test(text)) score += 4;
  if (/career services|career center|student employment|student jobs|alumni|internship|job placement|post a job|hire (?:a|our)|employers?/.test(text)) score -= 24;
  if (/admissions|academics|programs|financial aid/.test(text)) score -= 8;
  return score;
}

function extractEmploymentLinks(html, baseUrl) {
  const candidates = [];
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || "").matchAll(anchorRe)) {
    const href = decodeHtml(match[1]);
    const label = decodeHtml(match[2].replace(/<[^>]+>/g, " "));
    try {
      const url = new URL(href, baseUrl).href;
      const score = scoreEmploymentLink(url, label);
      if (score >= 10) candidates.push({ url, label: clean(label), score });
    } catch {
      // Ignore malformed links.
    }
  }
  const bestByUrl = new Map();
  for (const candidate of candidates) {
    const prior = bestByUrl.get(candidate.url);
    if (!prior || candidate.score > prior.score) bestByUrl.set(candidate.url, candidate);
  }
  return [...bestByUrl.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
}

async function fetchHomepage(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 FacultyJobsDiscovery/1.0" },
    });
    const html = response.status >= 200 && response.status < 400 ? await response.text() : "";
    return { status: response.status, finalUrl: response.url || url, html };
  } catch (error) {
    return { status: 0, finalUrl: url, html: "", error: error?.name || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const ipeds = parseCsv(fs.readFileSync(IPEDS_PATH, "utf8"));
  const exclusions = JSON.parse(fs.readFileSync(EXCLUSIONS_PATH, "utf8"));
  const excludedNames = new Set((exclusions.colleges || []).map((item) => norm(typeof item === "string" ? item : item.name || item.college)));
  const ipedsByUnitid = new Map(ipeds.map((row) => [Number(row.UNITID), row]));
  const ipedsByName = new Map(ipeds.map((row) => [norm(row.INSTNM), row]));
  const targets = master.institutions
    .filter((inst) => norm(inst.level) === "4-year")
    .filter((inst) => norm(inst.control) === TARGET_CONTROL)
    .filter((inst) => norm(inst.coverage_status) === "missing")
    .filter((inst) => inst.is_degree_granting !== false)
    .filter((inst) => !excludedNames.has(norm(inst.name)))
    .sort((a, b) => clean(a.state).localeCompare(clean(b.state)) || clean(a.name).localeCompare(clean(b.name)));

  const seeded = targets.map((inst) => {
    const ipedsRow = ipedsByUnitid.get(Number(inst.unitid)) || ipedsByName.get(norm(inst.name));
    return { inst, homepage: normalizeUrl(ipedsRow?.WEBADDR || inst.homepage_url) };
  });

  let processed = 0;
  const results = await mapConcurrent(seeded, 24, async ({ inst, homepage }) => {
    if (!homepage) return { inst, homepage: null, selected: null, status: 0, error: "missing official homepage" };
    const page = await fetchHomepage(homepage, 10000);
    const links = extractEmploymentLinks(page.html, page.finalUrl);
    const selected = links[0] || null;
    processed += 1;
    if (processed % 50 === 0 || processed === seeded.length) console.log(`Processed ${processed}/${seeded.length}`);
    return { inst, homepage, finalHomepage: page.finalUrl, status: page.status, error: page.error || null, selected, candidates: links.slice(0, 5) };
  });

  const missingHomepage = results.filter((row) => !row.homepage);
  if (missingHomepage.length) {
    throw new Error(`No official IPEDS website for ${missingHomepage.length} target(s): ${missingHomepage.map((row) => row.inst.name).join(", ")}`);
  }

  const items = results.map((row) => ({
    name: row.inst.name,
    state: row.inst.state,
    platform_type: "generic",
    career_url: row.selected?.url || row.finalHomepage || row.homepage,
    source: row.selected ? "Official website employment link" : "IPEDS WEBADDR fallback",
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    targetCount: targets.length,
    dedicatedEmploymentLinks: results.filter((row) => row.selected).length,
    homepageFallbacks: results.filter((row) => !row.selected).length,
    items: results.map((row) => ({
      name: row.inst.name,
      state: row.inst.state,
      homepage: row.homepage,
      finalHomepage: row.finalHomepage || null,
      homepageStatus: row.status,
      selected: row.selected,
      candidates: row.candidates || [],
      error: row.error,
    })),
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: report.generatedAt, targetControl: TARGET_CONTROL, method: "Official-site employment link discovery with IPEDS fallback", items }, null, 2) + "\n");
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (${items.length} candidates)`);
  console.log(`Dedicated employment links: ${report.dedicatedEmploymentLinks}`);
  console.log(`Official homepage fallbacks: ${report.homepageFallbacks}`);
}

await main();
