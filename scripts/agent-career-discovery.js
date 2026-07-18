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
//                                          [--llm-none-fallback] [--state CA,TX,OH,FL] [--level 2-year]
//   USE_CLAUDE=1        -> Claude (needs ANTHROPIC_API_KEY); otherwise Ollama (default gpt-oss:20b,
//                          override with OLLAMA_MODEL).
//   RANK_WITH_CLAUDE=1  -> route only the cheap rank step to Haiku, even on an Ollama run (#3).
//   --llm-none-fallback -> (default ON) when the ranker says bare "none" but a recognized
//                          ATS is in the pool, keep the ATS candidates and let verify()
//                          decide (#2). Use --no-llm-none-fallback to disable.
//
// The llm_none miss record carries the candidate pool + raw LLM reply (#1), so a
// discovery run can be triaged: bad pool (fix discovery) vs ranker rejecting a
// real ATS (flip on --llm-none-fallback / RANK_WITH_CLAUDE).

import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { scrapeGenericJobPage, looksFacultyish } from "../server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const SERVER_PATH = path.join(ROOT, "server.js");
const SKIP_PATH = path.join(ROOT, "data", "career-discovery-skip.json");
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
  // llmNoneFallback ON by default: validated (recovers e.g. Bristol's interviewexchange
  // portal that a bare "none" had vetoed) and safe — verify() is still the gate, so it
  // only adds scrape-tests on candidates that already look like a recognized ATS.
  const out = { max: 25, dryRun: false, concurrency: 2, perCandidate: 3, searchDelayMs: 800, universities: false, communityColleges: false, llmNoneFallback: true, states: null, level: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--state" && argv[i + 1]) out.states = new Set(argv[++i].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)); // e.g. --state CA,TX,OH,FL
    else if (a === "--level" && argv[i + 1]) out.level = String(argv[++i]).trim().toLowerCase(); // IPEDS level filter, e.g. --level 2-year (community colleges by classification, not name)
    else if (a === "--universities") out.universities = true; // bias to the high-yield subset
    else if (a === "--community-colleges") out.communityColleges = true; // community/technical/junior colleges
    else if (a === "--llm-none-fallback") out.llmNoneFallback = true; // #2: don't let a bare "none" veto a recognized-ATS candidate
    else if (a === "--no-llm-none-fallback") out.llmNoneFallback = false; // opt out of the #2 fallback
    else if (a === "--max" && argv[i + 1]) out.max = Math.max(1, Number(argv[++i]));
    else if (a === "--concurrency" && argv[i + 1]) out.concurrency = Math.min(4, Math.max(1, Number(argv[++i])));
    else if (a === "--per-candidate" && argv[i + 1]) out.perCandidate = Math.max(1, Number(argv[++i]));
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const API_KEY = process.env.ANTHROPIC_API_KEY;
const OLLAMA_HOST = process.env.OLLAMA_HOST || "localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gpt-oss:20b"; // 20B ranker: false "none"s dropped 8→1 vs qwen2.5:7b on the 30-CC batch
const USE_OLLAMA = process.env.USE_CLAUDE !== "1";
const RANK_WITH_CLAUDE = process.env.RANK_WITH_CLAUDE === "1"; // #3: route only the rank step to Haiku even when discovery runs on Ollama

const clean = (v) => String(v ?? "").trim();
const normalize = (v) => clean(v).toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// University System of Georgia is a *partial* match for the AGGREGATE_SYSTEM_NAMES
// pattern above: unlike CSU/UC/CUNY/SUNY, not every USG member is on the shared
// feed — UGA, Georgia State, and Georgia Tech run their own separate PeopleAdmin
// sites and have never appeared as a Business Unit on it (see scrapeUsgFaculty /
// USG_CANONICAL_CAMPUSES in server.js, which this list mirrors exactly). IPEDS
// F1SYSNAM membership would wrongly exclude those three too, so this is a manual
// name list instead of an AGGREGATE_SYSTEM_NAMES entry.
const USG_COVERED_CAMPUSES = new Set(
  [
    "Abraham Baldwin Agricultural College",
    "Albany State University",
    "Atlanta Metropolitan State College",
    "College of Coastal Georgia",
    "Clayton State University",
    "Columbus State University",
    "Dalton State College",
    "East Georgia State College",
    "Georgia Highlands College",
    "Fort Valley State University",
    "Georgia Southwestern State University",
    "Georgia College & State University",
    "Georgia Southern University",
    "Gordon State College",
    "Savannah State University",
    "Valdosta State University",
    "University of West Georgia",
    "Georgia State University-Perimeter College",
    "Georgia Gwinnett College",
    "Augusta University",
    "Middle Georgia State University",
    "University of North Georgia",
    "South Georgia State College",
    "Kennesaw State University",
  ].map((n) => normalize(n))
);

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
// Multi-label public suffixes where the naive "2nd-to-last label" extraction
// below picks a US state abbreviation instead of the actual school/district
// name (e.g. rtc.suwannee.k12.fl.us -> naive extraction gives "fl", a 2-char
// token that then trips the length<3 "can't tell" bypass in
// candidateBelongsToSchool, disabling verification entirely and letting an
// unrelated .edu domain through — this is exactly what happened with Riveroak
// Technical College, FL, matching Georgia's TCSG system portal).
function homepageSld(homepage) {
  try {
    const h = new URL(homepage).hostname.replace(/^www\./, "");
    const k12Match = /^(?:[a-z0-9-]+\.)*([a-z0-9-]+)\.k12\.[a-z]{2}\.us$/i.exec(h);
    if (k12Match) return k12Match[1].toLowerCase();
    const p = h.split(".");
    return p.length >= 2 ? p[p.length - 2] : p[0];
  } catch {
    return null;
  }
}
function candidateBelongsToSchool(url, homepage) {
  const s = homepageSld(homepage);
  if (!s || s.length < 3) return true; // can't tell — don't over-reject
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
  // Third-party ATS/HR platforms (workday, taleo, applicantpro, agilehr, ...)
  // are commercial domains that host many unrelated schools, so the school
  // token safely appears as the URL's leftmost subdomain/path instead of the
  // domain itself (acu.wd108.myworkdayjobs.com; daemen.applicantpro.com) — a
  // substring check against the whole URL is fine there. Checking "not .edu"
  // covers the long tail of ATS vendors without needing every one hardcoded
  // in inferPlatformFromUrl.
  if (!/\.edu$/i.test(host)) return normalize(url).includes(s);
  // The candidate claims to be another school's own .edu site: require an
  // EXACT SLD match instead of a substring. A substring match false-
  // positives whenever one school's short domain is a literal prefix of a
  // different .edu domain (dallas.edu vs dallascollege.edu — "Dallas
  // College"), or two unrelated schools share an acronym that happens to be
  // one school's SLD but a subdomain of another's (bmcc.edu, "Bay Mills
  // Community College", vs bmcc.cuny.edu, whose real SLD is "cuny" —
  // "Borough of Manhattan Community College").
  const p = host.split(".");
  const candidateSld = p.length >= 2 ? p[p.length - 2] : p[0];
  return candidateSld === s;
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

// Links on the school's own pages that look employment-related — including the
// call-to-action text that often fronts the ATS link on an HR landing page
// ("View Openings", "Search Postings", "Current Openings").
const CAREERY = /career|job|employ|human[-_ ]?resources|\bhr\b|hiring|join[-_ ]?(us|our)|opportunit|vacanc|positions?|work[-_ ]?(with|here|at|for)|open[-_ ]?(positions?|openings?)|current openings?|view (openings?|positions?|jobs?)|search (jobs?|postings?)|browse (jobs?|positions?)/i;
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

// Primary, reliable candidate source: crawl the school's OWN site for the ATS.
// The homepage usually links to an HR landing page, which in turn links to the
// real ATS — sometimes one more hop down (the "no_jobs" cases). So we crawl up
// to 2 levels deep and, on EVERY page, harvest links to known ATS domains
// regardless of their anchor text (the ATS link is often labelled "Apply" or
// "Search Postings", which the careers-text filter alone would miss).
async function homepageCandidates(context, inst) {
  const home = inst.homepage_url;
  const normKey = (u) => normalize(u).replace(/\/+$/, "");
  const urls = new Set();   // collected candidates (ATS portals + careers pages)
  const seen = new Set([normKey(home)]);

  // From a page's links: take ATS-domain links directly; return on-domain
  // careers-ish pages to consider hopping into next.
  const harvest = (links) => {
    const careerish = [];
    for (const l of links) {
      if (!l.href || normKey(l.href) === normKey(home)) continue;
      if (!candidateBelongsToSchool(l.href, home) || WRONG_DEPARTMENT.test(l.href)) continue;
      if (inferPlatformFromUrl(l.href) !== "generic") urls.add(l.href);  // real ATS link — grab it
      else if (isCareerLink(l)) careerish.push(l.href);
    }
    return [...new Set(careerish)];
  };

  let frontier = harvest(await extractLinks(context, home));
  for (const h of frontier) urls.add(h);

  // Hop deeper, following the best generic careers links to surface the ATS
  // behind HR landing pages. Bounded fan-out (2/level) and a visited-guard keep
  // it to <=5 page fetches per school.
  for (let depth = 0; depth < 2 && frontier.length; depth++) {
    const next = [];
    const toVisit = frontier
      .filter((h) => !seen.has(normKey(h)) && inferPlatformFromUrl(h) === "generic")
      .sort((a, b) => scoreCandidate(b, inst.name) - scoreCandidate(a, inst.name))
      .slice(0, 2);
    for (const u of toVisit) {
      seen.add(normKey(u));
      for (const h of harvest(await extractLinks(context, u))) { urls.add(h); next.push(h); }
    }
    frontier = next;
  }
  return [...urls];
}

// Reject portals scoped to a non-faculty department — they verify (real jobs)
// but the jobs are wrong (e.g. ASU's ...myworkdayjobs.com/ASUStaffCareers,
// UCF's .../athletics). Recurred across runs, so guard it at the source.
// [\/_-]staff (not just /staff): catches "staff" glued onto another word with
// an underscore/hyphen (Claremont McKenna's .../CMC_Staff Workday site), which
// a bare "/staff" boundary check misses since "_" is a \w character and never
// creates a \b before "Staff". The trailing (\b|\/) still keeps "Stafford"-
// style false positives out. The (?<!faculty[-_]) lookbehind keeps combined
// "faculty-staff-resources"/"faculty_staff" pages in — those explicitly cover
// faculty too, so "staff" being adjacent isn't a wrong-department signal.
const WRONG_DEPARTMENT = /athletic|staff.?careers|(?<!faculty)[\/_-]staff(\b|\/)|police\b|medical.?center.?careers/i;

async function discoverCandidates(context, inst) {
  const pool = new Map();
  const add = (url) => {
    if (!url || !candidateBelongsToSchool(url, inst.homepage_url)) return;
    if (WRONG_DEPARTMENT.test(url)) return;
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

function callLlmRaw(prompt, useClaude = !USE_OLLAMA) {
  return new Promise((resolve, reject) => {
    if (!useClaude) {
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

// Returns { ranked, reply }: candidates reordered by the LLM's priority, with the
// raw reply surfaced for diagnostics (#1). Falls back to score order on error or
// an unparseable reply. The LLM only ranks the real candidate list; verify() is
// the hard gate downstream, so a wrong pick just fails verification.
async function rankCandidates(inst, candidates) {
  if (candidates.length <= 1) return { ranked: candidates, reply: candidates.length ? "(single candidate — LLM skipped)" : "" };
  const useClaude = !USE_OLLAMA || (RANK_WITH_CLAUDE && Boolean(API_KEY)); // #3
  let text = "";
  try {
    text = await callLlmRaw(buildRankPrompt(inst, candidates), useClaude);
  } catch {
    return { ranked: candidates, reply: "(LLM error — fell back to score order)" };
  }
  if (/^\s*none\s*$/i.test(text)) {
    // #2 (staged behind --llm-none-fallback): a bare "none" from a weak ranker
    // shouldn't veto a recognized-ATS candidate — let verify() be the arbiter.
    if (ARGS.llmNoneFallback) {
      const ats = candidates.filter((c) => inferPlatformFromUrl(c.url) !== "generic");
      if (ats.length) return { ranked: ats, reply: text };
    }
    return { ranked: [], reply: text };
  }
  const order = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]) - 1).filter((i) => i >= 0 && i < candidates.length);
  if (order.length === 0) return { ranked: candidates, reply: text };
  const seen = new Set();
  const ranked = [];
  for (const i of order) { if (!seen.has(i)) { seen.add(i); ranked.push(candidates[i]); } }
  return { ranked, reply: text };
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

function loadSkipList() {
  try {
    const doc = JSON.parse(fs.readFileSync(SKIP_PATH, "utf8"));
    return new Set((doc.skip || []).map((s) => normalize(typeof s === "string" ? s : s.name)));
  } catch {
    return new Set();
  }
}

// Shared retry clock with discover-career-pages.js (same field): never-attempted
// institutions (no timestamp) sort first, then oldest attempt first. Without this,
// chooseTargets' old name-alphabetical sort meant every run re-hit the same
// early-alphabet institutions that already failed, and --max always cut off
// before reaching anything past them.
function attemptRank(inst) {
  const ts = clean(inst.last_discovery_attempt_at);
  if (!ts) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function chooseTargets(master, campusSet, existingOverrideNames, systemMembers, skipSet) {
  const isSystemMember = (i) =>
    systemMembers.unitids.has(String(i.unitid ?? "").trim()) ||
    systemMembers.names.has(normalize(i.name)) ||
    USG_COVERED_CAMPUSES.has(normalize(i.name));
  return (master.institutions || [])
    .filter((i) => normalize(i.coverage_status) === "missing")
    .filter((i) => !ARGS.states || ARGS.states.has(String(i.state ?? "").toUpperCase())) // optional --state CA,TX,... filter
    .filter((i) => !ARGS.level || normalize(i.level) === ARGS.level) // optional --level 2-year/4-year filter
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
    .filter((i) => !skipSet.has(normalize(i.name))) // manual skip: shared/system portals (career-discovery-skip.json)
    // optional subset filters (CSU/UC/CUNY/SUNY already removed above by the IPEDS guard)
    .filter((i) => !ARGS.universities || /university/i.test(i.name))
    .filter((i) => !ARGS.communityColleges || /community college|technical college|junior college/i.test(i.name))
    .sort((a, b) => {
      const da = attemptRank(a);
      const db = attemptRank(b);
      if (da !== db) return da - db; // oldest / never-attempted first
      return clean(a.name).localeCompare(clean(b.name));
    });
}

// ── verification (the hard gate) ──────────────────────────────────────────────

async function verify(context, inst, url) {
  try {
    const jobs = await scrapeGenericJobPage(context, url, inst.name, inst.state || "XX");
    // scrapeGenericJobPage returns ALL job links (incl. staff). The real scrape
    // applies looksFacultyish per state scraper, so verify on the FACULTY subset
    // — else a staff-heavy "employment" page passes the gate on staff count and
    // records an override that yields ~0 faculty downstream.
    return Array.isArray(jobs) ? jobs.filter((j) => looksFacultyish(j.title)) : [];
  } catch {
    return [];
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nFaculty Atlas - Career Discovery Agent");
  console.log(`  Backend: ${USE_OLLAMA ? `Ollama (${OLLAMA_MODEL})` : "Claude (haiku)"}`);
  if (USE_OLLAMA && RANK_WITH_CLAUDE) console.log(`  Rank step: Claude (haiku) ${API_KEY ? "" : "— NO ANTHROPIC_API_KEY, falling back to Ollama"}`);
  if (ARGS.llmNoneFallback) console.log(`  llm_none fallback: ON (keep recognized-ATS candidates past a bare "none")`);
  if (ARGS.states) console.log(`  State filter     : ${[...ARGS.states].join(", ")}`);
  if (ARGS.level) console.log(`  Level filter     : ${ARGS.level}`);
  if (ARGS.dryRun) console.log("  *** DRY RUN — nothing written ***");

  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const overridesDoc = fs.existsSync(OVERRIDES_PATH)
    ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"))
    : { updatedAt: null, overrides: [] };
  const existingNames = new Set((overridesDoc.overrides || []).map((o) => normalize(o.name)));
  const campusSet = loadServerCampusNames();
  const systemMembers = loadSystemMembers();
  const skipSet = loadSkipList();
  console.log(`  System members   : ${systemMembers.ok ? `${systemMembers.names.size} CSU/UC/CUNY/SUNY campuses excluded (IPEDS)` : "IPEDS unavailable — system guard OFF"} + ${USG_COVERED_CAMPUSES.size} USG campuses excluded (manual list)`);
  if (skipSet.size) console.log(`  Manual skips     : ${skipSet.size} (career-discovery-skip.json)`);

  const targets = chooseTargets(master, campusSet, existingNames, systemMembers, skipSet).slice(0, ARGS.max);
  console.log(`  Targets this run : ${targets.length} (max ${ARGS.max}, in scrape list, not already overridden)`);
  console.log(`  Concurrency      : ${ARGS.concurrency} | scrape-tests/school: up to ${ARGS.perCandidate}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });

  // Runs one institution and returns its outcome instead of pushing directly to
  // found/misses, so the worker loop can stamp attempt metadata exactly once per
  // institution regardless of which branch it exits through.
  async function processInstitution(inst, label) {
    const candidates = await discoverCandidates(context, inst);
    if (candidates.length === 0) {
      console.log(`${label} … no candidates`);
      return { status: "no_candidates" };
    }
    const { ranked, reply: llmReply } = await rankCandidates(inst, candidates);
    if (ranked.length === 0) {
      console.log(`${label} … LLM: none viable (of ${candidates.length} candidates)`);
      // #1: record the candidate pool + raw reply so llm_none is diagnosable
      // — did the ranker reject a real ATS link, or was the pool genuinely junk?
      return { status: "llm_none", candidates: candidates.map((c) => c.url), llmReply };
    }

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
      if (weak) {
        console.log(`${label} … weak only (${weak.count} on generic page)`);
        return { status: "weak_single", url: weak.url, count: weak.count };
      }
      console.log(`${label} … ${ranked.length} ranked, 0 verified`);
      return { status: "no_jobs", tried: ranked.slice(0, ARGS.perCandidate).map((c) => c.url) };
    }

    const platform = inferPlatformFromUrl(hit.cand.url);
    console.log(`${label} … ✓ ${platform} (${hit.count}) ${hit.cand.url}`);
    return {
      status: "found",
      entry: {
        name: inst.name,
        homepage_url: inst.homepage_url,
        career_url: hit.cand.url,
        platform_type: platform,
        notes: `Discovered via agent-career-discovery; verified live (${hit.count} faculty posting${hit.count === 1 ? "" : "s"}).`,
        _jobCount: hit.count,
      },
    };
  }

  const found = [];
  const misses = [];
  let next = 0;

  async function worker() {
    while (next < targets.length) {
      const inst = targets[next++];
      const label = `  [${String(next).padStart(3)}/${targets.length}] ${inst.name}`;
      const attemptedAt = new Date().toISOString();
      let result;
      try {
        result = await processInstitution(inst, label);
      } catch (e) {
        console.log(`${label} … ERROR ${String(e.message || e).split("\n")[0]}`);
        result = { status: "error", error: String(e.message || e) };
      }

      if (result.status === "found") {
        found.push(result.entry);
      } else {
        const { status, ...rest } = result;
        misses.push({ name: inst.name, reason: status, ...rest });
      }

      // Stamp the retry clock (attemptRank) so the next run — whatever its
      // outcome here — doesn't pick this institution again before less-recently
      // -tried ones. Skipped in --dry-run to match "nothing written."
      if (!ARGS.dryRun) {
        inst.last_discovery_attempt_at = attemptedAt;
        inst.last_discovery_status = result.status;
        inst.discovery_attempts = Number(inst.discovery_attempts || 0) + 1;
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

  if (!ARGS.dryRun && targets.length > 0) {
    fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n", "utf8");
    console.log(`  institutions-master.json updated (attempt metadata stamped for ${targets.length} institutions).`);
  }

  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), backend: USE_OLLAMA ? OLLAMA_MODEL : "claude-haiku", config: ARGS, targetsConsidered: targets.length, verifiedFinds: found.map(({ _jobCount, ...f }) => ({ ...f, jobCount: _jobCount })), misses }, null, 2) + "\n",
    "utf8"
  );
  console.log(`  Report saved   : generated/career-discovery-report.json\n`);
}

main().catch((e) => { console.error(e?.stack || e?.message || String(e)); process.exit(1); });
