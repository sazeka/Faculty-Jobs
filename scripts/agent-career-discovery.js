// agent-career-discovery.js
//
// LLM-assisted discovery of real career/ATS URLs for institutions stuck on a
// "homepage default" — coverage_status "missing" with career_url == homepage_url
// (or none), so the scraper lands on a homepage and finds 0 jobs.
//
// For each target it:
//   1. searches the web for candidate career URLs (DuckDuckGo html endpoint),
//   2. asks an LLM to rank those *real* candidates (grounded — it only chooses
//      among URLs we actually found, so it can't hallucinate a URL),
//   3. scrape-tests the ranked candidates with the real scraper and records the
//      first that yields faculty jobs into data/career-url-overrides.json.
//
// The scrape-test is the hard gate: a wrong LLM pick simply fails verification
// and is discarded, so the LLM improves hit-rate but can't create false records.
// Overrides only take effect for institutions already in server.js's scrape
// list, so targets are intersected with that list.
//
// Usage:
//   node scripts/agent-career-discovery.js [--max N] [--dry-run] [--concurrency N] [--per-candidate K]
//   USE_CLAUDE=1 -> Claude (needs ANTHROPIC_API_KEY); otherwise Ollama (qwen2.5:7b).

import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { scrapeGenericJobPage } from "../server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const SERVER_PATH = path.join(ROOT, "server.js");
const IPEDS_PATH = path.join(ROOT, "data", "ipeds", "hd2024.csv");
const REPORT_PATH = path.join(ROOT, "generated", "career-discovery-report.json");

// IPEDS F1SYSNAM values for systems scraped at the SYSTEM level (CSU_URL, the
// UC source, CUNY_URL, the SUNY feed). Members are already covered there, so
// per-campus discovery would create a duplicate campus under a second name.
// Using IPEDS membership (not a name regex) catches every member regardless of
// name format ("Cal Poly Humboldt") or current job count.
const AGGREGATE_SYSTEM_NAMES = new Set([
  "california state university",
  "university of california",
  "city university of new york",
  "state university of new york system",
]);

function parseArgs(argv) {
  const out = { max: 25, dryRun: false, concurrency: 2, perCandidate: 3, searchDelayMs: 800, universities: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--universities") out.universities = true; // bias to the high-yield subset
    else if (a === "--max" && argv[i + 1]) out.max = Math.max(1, Number(argv[++i]));
    else if (a === "--concurrency" && argv[i + 1]) out.concurrency = Math.min(4, Math.max(1, Number(argv[++i])));
    else if (a === "--per-candidate" && argv[i + 1]) out.perCandidate = Math.max(1, Number(argv[++i]));
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const API_KEY = process.env.ANTHROPIC_API_KEY;
const OLLAMA_HOST = process.env.OLLAMA_HOST || "localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";
const USE_OLLAMA = process.env.USE_CLAUDE !== "1";

const clean = (v) => String(v ?? "").trim();
const normalize = (v) => clean(v).toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── candidate discovery (web search) — mirrors discover-career-pages.js ──────

function inferPlatformFromUrl(url) {
  const u = normalize(url);
  if (!u) return null;
  if (u.includes("myworkdayjobs.com") || u.includes("myworkdaysite.com")) return "workday";
  if (u.includes("pageuppeople.com")) return "pageup";
  if (u.includes("taleo.net")) return "taleo";
  if (u.includes("peopleadmin.com")) return "peopleadmin";
  if (u.includes("schooljobs.com") || u.includes("governmentjobs.com")) return "schooljobs";
  if (u.includes("csod.com")) return "csod";
  if (u.includes("paycomonline.net")) return "paycom";
  if (u.includes("interviewexchange.com")) return "interviewexchange";
  if (u.includes("jobvite.com")) return "jobvite";
  if (u.includes("interfolio.com")) return "interfolio";
  if (u.includes("icims.com")) return "icims";
  if (u.includes("isolvedhire.com")) return "isolvedhire";
  if (u.includes("workforcenow.adp.com")) return "adp";
  return "generic";
}

function decodeDdgRedirect(url) {
  try {
    const u = new URL(url);
    if (u.pathname.startsWith("/l/") && u.searchParams.get("uddg")) {
      return decodeURIComponent(u.searchParams.get("uddg"));
    }
    return url;
  } catch {
    return url;
  }
}

function extractCandidateUrlsFromDdgHtml(html) {
  const urls = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const decoded = decodeDdgRedirect(m[1]);
    if (/^https?:\/\//i.test(decoded)) urls.push(decoded);
  }
  if (urls.length === 0) {
    const reAlt = /uddg=([^&"'>\s]+)/gi;
    while ((m = reAlt.exec(html)) !== null) {
      try {
        const decoded = decodeURIComponent(m[1]);
        if (/^https?:\/\//i.test(decoded)) urls.push(decoded);
      } catch {
        /* ignore */
      }
    }
  }
  return [...new Set(urls)];
}

// Aggregators and non-employer hosts: useful to a human, useless to the scraper.
const DENY = [
  "wikipedia.org", "linkedin.com", "facebook.com", "instagram.com", "x.com",
  "twitter.com", "youtube.com", "indeed.com", "glassdoor.com", "ziprecruiter.com",
  "higheredjobs.com", "academicjobs.com", "insidehighered.com", "chronicle.com",
  "simplyhired.com", "/news", "/events", "/giving", "/alumni",
];
function looksBadCandidate(url) {
  const u = normalize(url);
  if (!u) return true;
  return DENY.some((d) => u.includes(d));
}

function scoreCandidate(url, schoolName) {
  const u = normalize(url);
  let score = 0;
  if (inferPlatformFromUrl(u) !== "generic") score += 0.6;
  if (/\bfaculty\b|\bprofessor\b|\bacademic\b|\binstructor\b|\blecturer\b/.test(u)) score += 0.25;
  if (/\bjobs\b|\bcareers\b|\bemployment\b|\brecruiting\b|\bjobsearch\b|\bpostings\b/.test(u)) score += 0.2;
  if (/\.edu\b/.test(u)) score += 0.1;
  const words = normalize(schoolName)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !["university", "college", "state", "system", "school"].includes(w));
  if (words.some((w) => u.includes(w))) score += 0.15;
  if (/\/login|sign[-_]?in|sso|auth/.test(u)) score -= 0.2;
  return Number(Math.max(0, Math.min(0.99, score)).toFixed(2));
}

// Guard against matching a *different* school's site (e.g. an acupuncture
// college whose name contains "Berkeley" matching berkeley.edu/jobs). The real
// ATS URL almost always carries the school's own domain token in its host or
// path (acu.edu -> acu.wd108.myworkdayjobs.com; aamu.edu -> .../careers/aamu).
function homepageSld(homepage) {
  try {
    const h = new URL(homepage).hostname.replace(/^www\./, "");
    const p = h.split(".");
    return p.length >= 2 ? p[p.length - 2] : p[0];
  } catch {
    return null;
  }
}
function candidateBelongsToSchool(url, homepage) {
  const s = homepageSld(homepage);
  if (!s || s.length < 3) return true; // can't tell — don't over-reject
  return normalize(url).includes(s);
}

async function fetchDdg(query, timeoutMs = 12000) {
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(searchUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 FacultyJobsDiscovery/1.0" },
    });
    if (!resp.ok) return [];
    return extractCandidateUrlsFromDdgHtml(await resp.text()).filter((u) => !looksBadCandidate(u));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Links on the school's own pages that look employment-related.
const CAREERY = /career|job|employ|human[-_ ]?resources|\bhr\b|hiring|join[-_ ]?(us|our)|opportunit|vacanc|positions?|work[-_ ]?(with|here|at|for)/i;
const isCareerLink = (l) => CAREERY.test(l.text || "") || CAREERY.test(l.href || "");

async function extractLinks(context, url, timeoutMs = 30000) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(1200);
    return await page.evaluate(() => {
      const abs = (h) => { try { return new URL(h, location.href).toString(); } catch { return null; } };
      return Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({ text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80), href: abs(a.getAttribute("href")) }))
        .filter((x) => x.href);
    });
  } catch {
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// Primary, reliable candidate source: crawl the school's OWN homepage for
// careers/HR links, then follow the best one hop (the homepage often links to
// an HR landing page that in turn links to the ATS). No external search.
async function homepageCandidates(context, inst) {
  const home = inst.homepage_url;
  const homeNorm = normalize(home).replace(/\/+$/, "");
  const urls = new Set();
  const careerLinks = (await extractLinks(context, home))
    .filter(isCareerLink)
    .map((l) => l.href)
    .filter((h) => normalize(h).replace(/\/+$/, "") !== homeNorm)
    .filter((h) => candidateBelongsToSchool(h, home) || inferPlatformFromUrl(h) !== "generic");
  for (const h of careerLinks) urls.add(h);
  // follow up to 2 best on-domain careers links to surface the ATS behind them
  const toHop = careerLinks
    .filter((h) => inferPlatformFromUrl(h) === "generic")
    .sort((a, b) => scoreCandidate(b, inst.name) - scoreCandidate(a, inst.name))
    .slice(0, 2);
  for (const cl of toHop) {
    for (const l of await extractLinks(context, cl)) {
      if (isCareerLink(l) && candidateBelongsToSchool(l.href, home)) urls.add(l.href);
    }
  }
  return [...urls];
}

async function discoverCandidates(context, inst) {
  const pool = new Map();
  const add = (url) => {
    if (!url || !candidateBelongsToSchool(url, inst.homepage_url)) return;
    if (!pool.has(url)) pool.set(url, { url, platform_type: inferPlatformFromUrl(url), score: scoreCandidate(url, inst.name) });
  };
  // primary: the school's own site (reliable)
  try { for (const u of await homepageCandidates(context, inst)) add(u); } catch { /* ignore */ }
  // secondary: web search (best-effort; DuckDuckGo html throttles under load)
  for (const q of [`${inst.name} faculty jobs careers`, `${inst.name} academic employment apply`]) {
    for (const url of await fetchDdg(q)) add(url);
    await sleep(ARGS.searchDelayMs);
  }
  return [...pool.values()].sort((a, b) => b.score - a.score).slice(0, 10);
}

// ── LLM ranking (grounded in the real candidate list) ────────────────────────

function buildRankPrompt(inst, candidates) {
  const list = candidates.map((c, i) => `${i + 1}. ${c.url}  [platform: ${c.platform_type}]`).join("\n");
  return [
    `You are picking the official faculty job-listing page for a US university.`,
    `University: ${inst.name}`,
    `Homepage: ${inst.homepage_url}`,
    ``,
    `Candidate URLs found by web search:`,
    list,
    ``,
    `Pick the candidates most likely to be the university's OWN applicant/job`,
    `listing portal where faculty/professor openings are posted (e.g. a Workday,`,
    `PeopleAdmin, SchoolJobs/GovernmentJobs, iCIMS, Taleo, Interfolio, or the`,
    `school's /careers or /jobs/employment page). Prefer the school's own ATS over`,
    `third-party boards. Reply with ONLY the candidate numbers in priority order,`,
    `comma-separated (e.g. "3,1,5"). If none look like a real job listing page,`,
    `reply "none". No other text.`,
  ].join("\n");
}

function callLlmRaw(prompt) {
  return new Promise((resolve, reject) => {
    if (USE_OLLAMA) {
      const body = JSON.stringify({ model: OLLAMA_MODEL, messages: [{ role: "user", content: prompt }], stream: false });
      const [hostname, port] = OLLAMA_HOST.split(":");
      const req = http.request(
        { hostname, port: Number(port) || 11434, path: "/api/chat", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
        (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { try { resolve(JSON.parse(d)?.message?.content?.trim() || ""); } catch (e) { reject(e); } }); }
      );
      req.on("error", reject); req.write(body); req.end();
    } else {
      const body = JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 64, messages: [{ role: "user", content: prompt }] });
      const req = https.request(
        { hostname: "api.anthropic.com", path: "/v1/messages", method: "POST", headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "Content-Length": Buffer.byteLength(body) } },
        (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { try { resolve(JSON.parse(d)?.content?.[0]?.text?.trim() || ""); } catch (e) { reject(e); } }); }
      );
      req.on("error", reject); req.write(body); req.end();
    }
  });
}

// Returns candidates reordered by the LLM's priority; falls back to score order.
async function rankCandidates(inst, candidates) {
  if (candidates.length <= 1) return candidates;
  let text = "";
  try {
    text = await callLlmRaw(buildRankPrompt(inst, candidates));
  } catch {
    return candidates;
  }
  if (/^\s*none\s*$/i.test(text)) return [];
  const order = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]) - 1).filter((i) => i >= 0 && i < candidates.length);
  if (order.length === 0) return candidates;
  const seen = new Set();
  const ranked = [];
  for (const i of order) { if (!seen.has(i)) { seen.add(i); ranked.push(candidates[i]); } }
  return ranked;
}

// ── targets ──────────────────────────────────────────────────────────────────

function loadServerCampusNames() {
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/campus:\s*"([^"]+)"/g)) names.add(normalize(m[1]));
  return names;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.replace(/^﻿/, "").replace(/^"|"$/g, "").trim());
}

// Build the set of campuses belonging to an aggregate-scraped system, keyed by
// both IPEDS unitid and normalized name (master entries may lack a unitid).
function loadSystemMembers() {
  const members = { unitids: new Set(), names: new Set(), ok: false };
  let raw;
  try { raw = fs.readFileSync(IPEDS_PATH, "latin1"); } catch { return members; }
  const lines = raw.split(/\r?\n/);
  if (lines.length < 2) return members;
  const hdr = parseCsvLine(lines[0]);
  const iName = hdr.indexOf("INSTNM");
  const iSys = hdr.indexOf("F1SYSNAM");
  if (iName < 0 || iSys < 0) return members;
  for (let k = 1; k < lines.length; k++) {
    if (!lines[k]) continue;
    const f = parseCsvLine(lines[k]);
    if (!AGGREGATE_SYSTEM_NAMES.has(normalize(f[iSys]))) continue;
    const uid = f[0]; // UNITID is the first column
    const nm = normalize(f[iName]);
    if (uid) members.unitids.add(uid);
    if (nm) members.names.add(nm);
  }
  members.ok = members.names.size > 0;
  return members;
}

function chooseTargets(master, campusSet, existingOverrideNames, systemMembers) {
  const isSystemMember = (i) =>
    systemMembers.unitids.has(String(i.unitid ?? "").trim()) || systemMembers.names.has(normalize(i.name));
  return (master.institutions || [])
    .filter((i) => normalize(i.coverage_status) === "missing")
    .filter((i) => {
      const c = clean(i.career_url).replace(/\/+$/, "");
      const h = clean(i.homepage_url).replace(/\/+$/, "");
      return !c || c === h;
    })
    .filter((i) => normalize(i.control) !== "private for-profit")
    .filter((i) => i.is_degree_granting !== false)
    .filter((i) => i.homepage_url)
    .filter((i) => campusSet.has(normalize(i.name)))        // override only fires if scraped
    .filter((i) => !existingOverrideNames.has(normalize(i.name)))
    // Skip campuses covered by an aggregate system scrape (CSU/UC/CUNY/SUNY) —
    // membership comes from IPEDS F1SYSNAM, so per-campus discovery can't create
    // a duplicate campus. (See AGGREGATE_SYSTEM_NAMES / loadSystemMembers.)
    .filter((i) => !isSystemMember(i))
    .filter((i) => !ARGS.universities || /university/i.test(i.name)) // high-yield subset
    .sort((a, b) => clean(a.name).localeCompare(clean(b.name)));
}

// ── verification (the hard gate) ──────────────────────────────────────────────

async function verify(context, inst, url) {
  try {
    const jobs = await scrapeGenericJobPage(context, url, inst.name, inst.state || "XX");
    return Array.isArray(jobs) ? jobs : [];
  } catch {
    return [];
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nFaculty Atlas - Career Discovery Agent");
  console.log(`  Backend: ${USE_OLLAMA ? `Ollama (${OLLAMA_MODEL})` : "Claude (haiku)"}`);
  if (ARGS.dryRun) console.log("  *** DRY RUN — nothing written ***");

  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const overridesDoc = fs.existsSync(OVERRIDES_PATH)
    ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"))
    : { updatedAt: null, overrides: [] };
  const existingNames = new Set((overridesDoc.overrides || []).map((o) => normalize(o.name)));
  const campusSet = loadServerCampusNames();
  const systemMembers = loadSystemMembers();
  console.log(`  System members   : ${systemMembers.ok ? `${systemMembers.names.size} CSU/UC/CUNY/SUNY campuses excluded (IPEDS)` : "IPEDS unavailable — system guard OFF"}`);

  const targets = chooseTargets(master, campusSet, existingNames, systemMembers).slice(0, ARGS.max);
  console.log(`  Targets this run : ${targets.length} (max ${ARGS.max}, in scrape list, not already overridden)`);
  console.log(`  Concurrency      : ${ARGS.concurrency} | scrape-tests/school: up to ${ARGS.perCandidate}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });

  const found = [];
  const misses = [];
  let next = 0;

  async function worker() {
    while (next < targets.length) {
      const inst = targets[next++];
      const label = `  [${String(next).padStart(3)}/${targets.length}] ${inst.name}`;
      try {
        const candidates = await discoverCandidates(context, inst);
        if (candidates.length === 0) { console.log(`${label} … no candidates`); misses.push({ name: inst.name, reason: "no_candidates" }); continue; }
        const ranked = await rankCandidates(inst, candidates);
        if (ranked.length === 0) { console.log(`${label} … LLM: none viable`); misses.push({ name: inst.name, reason: "llm_none" }); continue; }

        // Quality gate: accept >=2 jobs, OR >=1 from a recognized ATS. A single
        // job off a generic page is usually a stray link on an HR landing page
        // (the Aurora/Case Western noise), so it's held as "weak" not recorded.
        let hit = null;
        let weak = null;
        for (const cand of ranked.slice(0, ARGS.perCandidate)) {
          const jobs = await verify(context, inst, cand.url);
          if (jobs.length === 0) continue;
          const isAts = inferPlatformFromUrl(cand.url) !== "generic";
          if (jobs.length >= 2 || isAts) { hit = { cand, count: jobs.length, sample: jobs.slice(0, 3).map((j) => j.title) }; break; }
          if (!weak) weak = { url: cand.url, count: jobs.length };
        }
        if (!hit) {
          if (weak) { console.log(`${label} … weak only (${weak.count} on generic page)`); misses.push({ name: inst.name, reason: "weak_single", url: weak.url, count: weak.count }); }
          else { console.log(`${label} … ${ranked.length} ranked, 0 verified`); misses.push({ name: inst.name, reason: "no_jobs", tried: ranked.slice(0, ARGS.perCandidate).map((c) => c.url) }); }
          continue;
        }

        const platform = inferPlatformFromUrl(hit.cand.url);
        found.push({
          name: inst.name,
          homepage_url: inst.homepage_url,
          career_url: hit.cand.url,
          platform_type: platform,
          notes: `Discovered via agent-career-discovery; verified live (${hit.count} faculty posting${hit.count === 1 ? "" : "s"}).`,
          _jobCount: hit.count,
        });
        console.log(`${label} … ✓ ${platform} (${hit.count}) ${hit.cand.url}`);
      } catch (e) {
        console.log(`${label} … ERROR ${String(e.message || e).split("\n")[0]}`);
        misses.push({ name: inst.name, reason: "error", error: String(e.message || e) });
      }
    }
  }

  await Promise.all(Array.from({ length: ARGS.concurrency }, worker));
  await browser.close();

  // ── write results ────────────────────────────────────────────────────────
  console.log(`\n  Verified finds : ${found.length} / ${targets.length}`);
  for (const f of found) console.log(`    ${f.name}  ->  ${f.career_url}  (${f.platform_type}, ${f._jobCount})`);

  if (!ARGS.dryRun && found.length > 0) {
    for (const f of found) {
      const { _jobCount, ...entry } = f;
      overridesDoc.overrides.push(entry);
    }
    overridesDoc.updatedAt = new Date().toISOString();
    fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overridesDoc, null, 2) + "\n", "utf8");
    console.log(`\n  career-url-overrides.json updated (+${found.length}, now ${overridesDoc.overrides.length}).`);
  } else if (ARGS.dryRun) {
    console.log("\n  DRY RUN: no files written.");
  }

  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), backend: USE_OLLAMA ? OLLAMA_MODEL : "claude-haiku", config: ARGS, targetsConsidered: targets.length, verifiedFinds: found.map(({ _jobCount, ...f }) => ({ ...f, jobCount: _jobCount })), misses }, null, 2) + "\n",
    "utf8"
  );
  console.log(`  Report saved   : generated/career-discovery-report.json\n`);
}

main().catch((e) => { console.error(e?.stack || e?.message || String(e)); process.exit(1); });
