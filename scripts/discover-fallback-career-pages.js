#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isRejectedCareerPage } from "./lib/career-path-probe.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const INPUTS = [
  path.join(ROOT, "generated", "public-four-year-promotion-candidates.json"),
  path.join(ROOT, "generated", "private-nonprofit-four-year-promotion-candidates.json"),
];
const OUT_PATH = path.join(ROOT, "generated", "fallback-career-upgrade-candidates.json");
const REPORT_PATH = path.join(ROOT, "generated", "fallback-career-upgrade-report.json");

const COMMON_PATHS = [
  "/employment",
  "/employment-opportunities",
  "/careers",
  "/jobs",
  "/job-opportunities",
  "/human-resources",
  "/hr",
  "/hr/employment",
  "/about/employment",
  "/about-us/employment",
  "/about/careers",
  "/offices/human-resources",
  "/administration/human-resources",
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function norm(value) {
  return clean(value).toLowerCase();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function pageText(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function isStudentFacing(value) {
  return /career[- /]services|career[- /]center|student[- /](?:employment|jobs?|support)|current[- /]students|alumni|internship|job[- /]placement|post a job|hire (?:a|our)|employers?/.test(norm(value));
}

function isEmploymentLike(value) {
  return /employment|careers?|jobs?|human[- /]?resources|join[- /](?:us|our[- /]team)|work[- /](?:at|for|with)/.test(norm(value));
}

function sameLandingPage(candidate, homepage) {
  try {
    const a = new URL(candidate);
    const b = new URL(homepage);
    return a.hostname === b.hostname && a.pathname.replace(/\/+$/, "") === b.pathname.replace(/\/+$/, "") && !a.search;
  } catch {
    return false;
  }
}

function isContextSpecificResult(selected) {
  const value = norm(`${selected?.url || ""} ${selected?.title || ""}`);
  return /\/blog(?:\/|-)|\/news(?:\/|-)|\/events?\/|\/degrees?\/|campus[- /]recreation|\/tutoring\/|upward[- /]bound|studentlivingemployment|student exhibition|career path|job forecast|finds new career|employment opportunities oakcrest|landscape is destiny|sports specialist|\.pdf(?:$|\?)/.test(value)
    || /\?s=employment/.test(value)
    || /\/(?:research|departments)\/.+\/employment/.test(value)
    || /apply\.interfolio\.com\/\d+(?:$|\?)/.test(value)
    || /:\/\/[^/]+\/job\/[^/?]+/.test(value);
}

function normalizeBoardUrl(value) {
  try {
    const url = new URL(decodeHtml(value));
    if (/myworkdayjobs\.com|myworkdaysite\.com/i.test(url.hostname)) {
      const marker = url.pathname.indexOf("/job/");
      if (marker >= 0) {
        url.pathname = url.pathname.slice(0, marker);
        url.search = "";
        url.hash = "";
      }
    }
    if (/paycomonline\.net/i.test(url.hostname) && /\/jobs\/\d+/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/jobs\/\d+.*$/, "/career-page");
      url.search = "";
      url.hash = "";
    }
    return url.href;
  } catch {
    return value;
  }
}

function extractBoardLink(html, baseUrl) {
  const links = [];
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || "").matchAll(anchorRe)) {
    const label = clean(decodeHtml(match[2].replace(/<[^>]+>/g, " ")));
    let url;
    try {
      url = new URL(decodeHtml(match[1]), baseUrl).href;
    } catch {
      continue;
    }
    const combined = `${label} ${url}`;
    if (!/^https?:\/\//i.test(url) || isStudentFacing(combined)) continue;
    let score = 0;
    if (/employment opportunities|job opportunities|job openings|current openings|open positions|view positions|search jobs/i.test(combined)) score += 25;
    if (/join (?:us|our team)|work (?:at|for|with) (?:us|our)|faculty positions|staff positions/i.test(combined)) score += 22;
    if (/myworkdayjobs|myworkdaysite|peopleadmin|schooljobs|governmentjobs|pageuppeople|interfolio|dayforcehcm|icims|jobvite|paycomonline|ultipro|adp\.com|taleo\.net/i.test(url)) score += 18;
    if (/\bjobs?\b|\bcareers?\b|\bemployment\b|human resources/i.test(combined)) score += 10;
    if (score >= 20) links.push({ url, label, score });
  }
  links.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  return links[0] || null;
}

function scorePage(url, html, homepage) {
  if (!html || sameLandingPage(url, homepage) || isRejectedCareerPage(url, html)) return { score: 0, reason: "rejected or homepage redirect" };
  const title = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.replace(/<[^>]+>/g, " "));
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].slice(0, 12).map((m) => clean(m[1].replace(/<[^>]+>/g, " "))).join(" ");
  const text = pageText(html).slice(0, 18000);
  const prominent = `${url} ${title} ${headings}`;
  if (isStudentFacing(prominent)) return { score: 0, reason: "student-facing" };
  let score = 0;
  if (/employment opportunities|job opportunities|job openings|current openings|open positions/i.test(prominent)) score += 35;
  if (/careers? at|jobs? at|work (?:at|for|with) (?:us|our)|join (?:us|our team)|faculty positions|staff positions/i.test(prominent)) score += 30;
  if (/human[- /]?resources/i.test(prominent)) score += 18;
  if (/\/(?:employment|careers?|jobs?|human-resources|hr)(?:\/|$|\?)/i.test(url)) score += 14;
  if (/search jobs|view (?:all )?(?:jobs|openings|positions)|apply for (?:a )?(?:job|position)|faculty openings|staff openings|current vacancies/i.test(text)) score += 20;
  if (/equal employment opportunity|applicants for employment|employment application/i.test(text)) score += 8;
  const board = extractBoardLink(html, url);
  if (board) score += 15;
  return { score, title, board, reason: score >= 28 ? "accepted" : "insufficient employee-hiring evidence" };
}

async function fetchPage(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 FacultyJobsFallbackDiscovery/1.0" },
    });
    const html = response.status >= 200 && response.status < 400 ? await response.text() : "";
    return { status: response.status, url: response.url || url, html };
  } catch (error) {
    return { status: 0, url, html: "", error: error?.name || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function sitemapCandidates(homepage) {
  let origin;
  try {
    origin = new URL(homepage).origin;
  } catch {
    return [];
  }
  const urls = new Set();
  for (const sitemapUrl of [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]) {
    const result = await fetchPage(sitemapUrl, 6000);
    if (!result.html) continue;
    for (const match of result.html.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)) {
      const url = decodeHtml(clean(match[1]));
      if (isEmploymentLike(url) && !isStudentFacing(url)) urls.add(url);
      if (urls.size >= 12) break;
    }
    if (urls.size) break;
  }
  return [...urls];
}

async function discoverOne(item) {
  const homepage = item.career_url;
  let origin;
  try {
    origin = new URL(homepage).origin;
  } catch {
    return { item, selected: null, attempts: [], error: "invalid homepage" };
  }
  const fromSitemap = await sitemapCandidates(homepage);
  const probeUrls = [...new Set([...fromSitemap, ...COMMON_PATHS.map((suffix) => new URL(suffix, origin).href)])];
  const attempts = [];
  let best = null;
  for (const probeUrl of probeUrls) {
    const page = await fetchPage(probeUrl);
    const scored = scorePage(page.url, page.html, homepage);
    attempts.push({ probeUrl, finalUrl: page.url, status: page.status, score: scored.score, title: scored.title || null, reason: scored.reason, board: scored.board || null });
    if (scored.score >= 28) {
      const selectedUrl = scored.board?.url || page.url;
      const candidate = { url: selectedUrl, pageUrl: page.url, score: scored.score + (scored.board ? scored.board.score : 0), title: scored.title || null };
      if (!best || candidate.score > best.score) best = candidate;
      if (candidate.score >= 75) break;
    }
  }
  return { item, selected: best, attempts };
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
  const fallbacks = INPUTS
    .flatMap((input) => JSON.parse(fs.readFileSync(input, "utf8")).items || [])
    .filter((item) => item.source === "IPEDS WEBADDR fallback")
    .sort((a, b) => clean(a.state).localeCompare(clean(b.state)) || clean(a.name).localeCompare(clean(b.name)));

  let results;
  if (process.env.FACULTY_JOBS_REUSE_FALLBACK_REPORT === "1" && fs.existsSync(REPORT_PATH)) {
    results = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8")).results || [];
    console.log(`Reusing ${results.length} prior deep-discovery results`);
  } else {
    let completed = 0;
    results = await mapConcurrent(fallbacks, 28, async (item) => {
      const result = await discoverOne(item);
      completed += 1;
      if (completed % 25 === 0 || completed === fallbacks.length) console.log(`Processed ${completed}/${fallbacks.length}`);
      return result;
    });
  }

  const verifiedResults = results.filter((result) => result.selected && !isContextSpecificResult(result.selected));
  const upgrades = verifiedResults.map((result) => ({
    name: result.item.name,
    state: result.item.state,
    platform_type: "generic",
    career_url: normalizeBoardUrl(result.selected.url),
    prior_url: result.item.career_url,
    source: "Verified deep official-site employment discovery",
  }));
  const verifiedNames = new Set(verifiedResults.map((result) => norm(result.item.name)));
  const remaining = results.filter((result) => !verifiedNames.has(norm(result.item.name))).map((result) => ({ name: result.item.name, state: result.item.state, homepage: result.item.career_url }));
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt, inputFallbacks: fallbacks.length, items: upgrades }, null, 2) + "\n");
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt, inputFallbacks: fallbacks.length, upgradesFound: upgrades.length, remainingCount: remaining.length, remaining, results }, null, 2) + "\n");
  console.log(`Verified upgrades: ${upgrades.length}`);
  console.log(`Still without a dedicated page: ${remaining.length}`);
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)}`);
}

await main();
