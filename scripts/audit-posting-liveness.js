#!/usr/bin/env node
/**
 * audit-posting-liveness.js
 *
 * Full (non-sampled) audit that every listing is a real, still-open posting.
 * Unlike verify-job-urls.js (HEAD-only, sampled, 404/410 only), this GETs each
 * page and inspects its content. Report-only: never modifies jobs.json.
 *
 * Verdicts:
 *   open         page loaded, title found on page, no "closed" language
 *   closed       page says the posting is closed / no longer accepting
 *   dead         404/410, DNS failure, or redirect to a homepage/search page
 *   expired      stated closeDate is in the past
 *   stale        PDF/Word posting whose file is over a year old (Last-Modified,
 *                or a year in the URL path like /uploads/2023/03/)
 *   mismatch     page loaded but the job title isn't on it (possibly wrong URL)
 *   listed       page is behind a bot challenge, but the daily scrape saw the posting on
 *                the school's listing within the last 2 days (generated/job-presence.json)
 *   unverifiable blocked, timeout, or JS-only page (use --browser to retry these)
 *
 * Workday URLs are checked through Workday's JSON job API, and ADP Workforce
 * Now URLs against the employer's list of open requisitions; both are exact.
 *
 * Usage:
 *   node scripts/audit-posting-liveness.js [options]
 *
 * Options:
 *   --jobs <path>          jobs.json to audit (default public/jobs.json)
 *   --out <dir>            output dir (default generated/)
 *   --concurrency <n>      global parallel requests (default 24)
 *   --per-host <n>         parallel requests per host (default 2)
 *   --timeout-ms <n>       per-request timeout (default 20000)
 *   --limit <n>            only audit the first n jobs (for testing)
 *   --browser              re-check unverifiable/mismatch/closed/404 results in headless Chromium
 *   --browser-concurrency  parallel browser pages (default 4)
 *   --fresh                ignore the resume cache
 *   --presence <path>      scrape presence ledger (default generated/job-presence.json)
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const JOBS_PATH = path.resolve(args.jobs || path.join(ROOT, "public", "jobs.json"));
const OUT_DIR = path.resolve(args.out || path.join(ROOT, "generated"));
const CONCURRENCY = Math.max(1, Number(args.concurrency || 24));
const PER_HOST = Math.max(1, Number(args["per-host"] || 2));
const TIMEOUT_MS = Math.max(3000, Number(args["timeout-ms"] || 20000));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const USE_BROWSER = Boolean(args.browser);
const BROWSER_CONCURRENCY = Math.max(1, Number(args["browser-concurrency"] || 4));
const FRESH = Boolean(args.fresh);
const PRESENCE_PATH = path.resolve(args.presence || path.join(ROOT, "generated", "job-presence.json"));
const LISTED_WITHIN_DAYS = 2;

const CACHE_PATH = path.join(OUT_DIR, "posting-liveness-cache.json");
const REPORT_PATH = path.join(OUT_DIR, "posting-liveness-report.json");
const CSV_PATH = path.join(OUT_DIR, "posting-liveness-problems.csv");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Phrases that only appear when a posting is actually closed. Deliberately
// avoids "until the position is filled"-style boilerplate found on open ads.
// Guard: skip phrases in conditional boilerplate ("until the position is filled",
// "accepted until job posting is closed", "filled on an as needed basis").
const NOT_CONDITIONAL = String.raw`(?<!\b(?:until|when|once|after|before|unless|if|or)\b[^.]{0,80})`;
const SENTENCE_END = String.raw`(?=\s*(?:[.!]|$))`;
const CLOSED_PATTERNS = [
  // ...but not scoped refusals: "not accepting applications from candidates who
  // only teach online", "not accepting applications for Business adjuncts"
  /no longer accepting applications(?!\s+(?:from|by|who|that)\b|\s+for\s+(?!(?:this|the)\s+(?:position|job|posting|opening|role)\b))/i,
  /(?:is|are) not (?:currently )?accepting applications(?!\s+(?:from|by|who|that)\b|\s+for\s+(?!(?:this|the)\s+(?:position|job|posting|opening|role)\b))/i,
  /applications are no longer being accepted/i,
  /(?:job|posting|position|vacancy|requisition|opening)[^.]{0,40}\bis no longer (?:available|active|open|posted)/i,
  new RegExp(NOT_CONDITIONAL + String.raw`\b(?:this|the) (?:job|posting|position|vacancy|opening|requisition)(?: posting)? (?:you are looking for |you requested )?(?:has been|was|is now|is) (?:closed|removed|filled|expired|cancel+ed)` + SENTENCE_END, "i"),
  new RegExp(NOT_CONDITIONAL + String.raw`\b(?:job|posting) (?:has )?expired` + SENTENCE_END, "i"),
  /job (?:posting )?(?:was )?not found/i,
  /posting (?:could not be|was not) found/i,
  /the page you(?: are|['’]re) (?:looking for|trying to access|requested) (?:doesn['’]?t|does not|could not|cannot|can['’]?t|is (?:no longer |not )?(?:available|unavailable)|has been removed)/i,
  /\b404\s*(?:\(not found\)|[-–—:]?\s*(?:page )?not found)/i,                  // visible "404 (Not found)" pages served with 200/202
  /(?:it looks like )?we can['’]?t find (?:this|that|the) page/i,
  /this job is (?:no longer |not )available/i,                              // Cornerstone
  /(?:sorry, )?we have no current job openings/i,
  /we couldn['’]?t find this job/i,                                          // Paycom
  /can['’]?t provide additional information about this job/i,                // PageUp
  /(?:job|posting|position) (?:you are looking for |you requested )?(?:could not|cannot|can'?t) be found/i,
  /recruitment (?:has|is) (?:now )?closed/i,
];

const STOPWORDS = new Set(["of", "and", "the", "in", "for", "a", "an", "to", "or", "at", "on", "with", "-", "&", "position", "faculty"]);

// ── helpers ───────────────────────────────────────────────────────────────────

function readJsonOrNull(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n"); }
function clean(v) { return String(v || "").replace(/\s+/g, " ").trim(); }

function htmlToText(html) {
  return clean(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"'));
}

function titleTokens(title) {
  return clean(title).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function titleMatchRatio(title, text) {
  const toks = titleTokens(title);
  if (toks.length === 0) return 1;
  const hay = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  return toks.filter((t) => hay.includes(t)).length / toks.length;
}

function findClosedPhrase(text) {
  for (const re of CLOSED_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

// A posting URL that lands on a site root or a generic listing/search page
// (PeopleAdmin /postings/123 -> /postings) means the posting is gone. Moving
// to a new address for the same job (governmentjobs -> schooljobs, /node/12 ->
// /slug, files moved to a CDN) is not, so only the landing page's shape counts.
const LISTING_PATH = /^\/?(?:[a-z]{2}(?:-[a-z]{2})?\/?)?$|^\/?(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:[\w-]+\/)?(?:postings|jobs|careers|search|job-search|search-results|employment|opportunities|openings|vacancies|positions|listing)(?:\.html?|\.php)?\/?$/i;
const trimSlash = (p) => p.replace(/\/+$/, "") || "/";

function isHomepageRedirect(originalUrl, finalUrl) {
  try {
    const o = new URL(originalUrl), f = new URL(finalUrl);
    // Same page modulo a trailing slash (e.g. /career?x -> /career/?x)
    if (o.hostname === f.hostname && trimSlash(o.pathname) === trimSlash(f.pathname)) return false;
    const oSeg = o.pathname.split("/").filter(Boolean);
    if (oSeg.length === 0) return false;
    return LISTING_PATH.test(f.pathname) && !/[?&](?:id|jobid|job_id|posting_id|reqid)=/i.test(f.search);
  } catch { return false; }
}

function isPastDate(s) {
  if (!s) return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  // one day of slack for timezone / "closes end of day"
  return d.getTime() + 36 * 3600 * 1000 < Date.now();
}

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9", ...(opts.headers || {}) },
      ...opts,
    });
    const contentType = res.headers.get("content-type") || "";
    const isDoc = /pdf|msword|officedocument/i.test(contentType);
    const docBuffer = isDoc ? Buffer.from(await res.arrayBuffer()) : null;
    const body = isDoc ? "" : await res.text();
    return { status: res.status, finalUrl: res.url, body, contentType, docBuffer, lastModified: res.headers.get("last-modified") || "" };
  } finally {
    clearTimeout(timer);
  }
}

// ── Workday: exact check through the CXS JSON API ────────────────────────────

function workdayApiUrl(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    if (/^[a-z]{2}-[A-Z]{2}$/.test(segs[0])) segs.shift();
    let tenant;
    if (/\.myworkdayjobs\.com$/i.test(u.hostname)) tenant = u.hostname.split(".")[0];
    // wd1.myworkdaysite.com/recruiting/<tenant>/<site>/job/...
    else if (/\.myworkdaysite\.com$/i.test(u.hostname) && segs[0] === "recruiting") { tenant = segs[1]; segs.splice(0, 2); }
    else return null;
    const jobIdx = segs.indexOf("job");
    if (jobIdx < 1) return null;
    const site = segs[jobIdx - 1];
    const rest = segs.slice(jobIdx).join("/");
    return `https://${u.hostname}/wday/cxs/${tenant}/${site}/${rest}`;
  } catch { return null; }
}

const WORKDAY_HEALTH = new Map();
function workdaySiteHealth(apiUrl) {
  // /wday/cxs/<tenant>/<site>/job/... -> POST /wday/cxs/<tenant>/<site>/jobs
  const base = apiUrl.replace(/\/job\/.*$/, "");
  if (!WORKDAY_HEALTH.has(base)) {
    WORKDAY_HEALTH.set(base, fetchWithTimeout(`${base}/jobs`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 1, offset: 0, searchText: "", appliedFacets: {} }),
    }).then((res) => {
      if (res.status !== 200) return `unavailable (HTTP ${res.status})`;
      try { return JSON.parse(res.body).total > 0 ? "ok" : "empty"; } catch { return "unavailable"; }
    }).catch(() => "unavailable"));
  }
  return WORKDAY_HEALTH.get(base);
}

async function checkWorkday(job, apiUrl) {
  let r;
  // Workday rate-limits bursts (429); back off rather than giving up.
  for (let attempt = 0; attempt < 5; attempt++) {
    r = await fetchWithTimeout(apiUrl, { headers: { Accept: "application/json" } });
    if (r.status !== 429 && r.status !== 503) break;
    await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt + Math.random() * 1000));
  }
  if (r.status === 404 || r.status === 410) return { verdict: "dead", httpCode: r.status, note: "Workday API: job not found" };
  // S22 "permission denied" is what Workday returns for a posting that is no
  // longer public -- but only trust it when the same career site is serving
  // other jobs, so a tenant-wide block can't read as mass closure.
  if (r.status === 403 && /"errorCode":"S22"/.test(r.body)) {
    const health = await workdaySiteHealth(apiUrl);
    if (health === "ok") return { verdict: "closed", httpCode: 403, note: "Workday: posting no longer public (S22)" };
    return { verdict: "unverifiable", httpCode: 403, note: `Workday S22, career site ${health}` };
  }
  if (r.status !== 200) {
    const health = await workdaySiteHealth(apiUrl);
    return { verdict: "unverifiable", httpCode: r.status, note: health === "ok" ? `Workday API HTTP ${r.status}` : `Workday career site ${health} (moved or down?)` };
  }
  let data;
  try { data = JSON.parse(r.body); } catch { return { verdict: "unverifiable", httpCode: 200, note: "Workday API non-JSON" }; }
  const info = data?.jobPostingInfo;
  if (!info) return { verdict: "dead", httpCode: 200, note: "Workday API: no jobPostingInfo" };
  if (info.canApply === false) return { verdict: "closed", httpCode: 200, note: "Workday: canApply=false" };
  const ratio = titleMatchRatio(job.title, clean(info.title));
  if (ratio < 0.5) return { verdict: "mismatch", httpCode: 200, titleMatch: ratio, note: `Workday title: ${clean(info.title).slice(0, 100)}` };
  return { verdict: "open", httpCode: 200, titleMatch: ratio };
}

// ── ADP Workforce Now: membership in the employer's open-requisition list ────

const ADP_LISTS = new Map();
function adpOpenRequisitions(cid, ccId) {
  const key = `${cid}|${ccId}`;
  if (!ADP_LISTS.has(key)) {
    ADP_LISTS.set(key, (async () => {
      const base = "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions";
      const ids = new Map();
      let seen = 0;
      for (let skip = 0; skip < 2000; skip += 20) {
        const r = await fetchWithTimeout(`${base}?cid=${encodeURIComponent(cid)}&ccId=${encodeURIComponent(ccId)}&lang=en_US&locale=en_US&$top=20&$skip=${skip}`, { headers: { Accept: "application/json" } });
        if (r.status !== 200) return ids.size ? ids : null;
        const data = JSON.parse(r.body);
        const page = data.jobRequisitions || [];
        // Career-center links use either the internal itemID or the employer's
        // ExternalJobID (e.g. jobId=578080), so index each requisition by both.
        for (const req of page) {
          const title = clean(req.requisitionTitle);
          seen++;
          ids.set(String(req.itemID), title);
          for (const f of req.customFieldGroup?.stringFields || []) {
            if (f?.nameCode?.codeValue === "ExternalJobID" && clean(f.stringValue)) ids.set(clean(f.stringValue), title);
          }
        }
        if (!page.length || seen >= (data.meta?.totalNumber ?? Infinity)) break;
      }
      return ids;
    })().catch(() => null));
  }
  return ADP_LISTS.get(key);
}

async function checkAdp(job, url) {
  const u = new URL(url);
  const cid = u.searchParams.get("cid"), jobId = u.searchParams.get("jobId");
  if (!cid || !jobId) return { verdict: "unverifiable", note: "ADP link without cid/jobId" };
  const open = await adpOpenRequisitions(cid, u.searchParams.get("ccId") || "19000101_000001");
  if (!open) return { verdict: "unverifiable", note: "ADP requisition list unavailable" };
  if (!open.size) return { verdict: "unverifiable", note: "ADP requisition list empty" };
  if (!open.has(jobId)) return { verdict: "closed", note: "ADP: not among employer's open requisitions" };
  const ratio = titleMatchRatio(job.title, open.get(jobId));
  return ratio < 0.5 ? { verdict: "mismatch", titleMatch: ratio, note: `ADP title: ${open.get(jobId).slice(0, 100)}` } : { verdict: "open", titleMatch: ratio };
}

// ── Generic HTML check ────────────────────────────────────────────────────────

const STALE_DOC_MS = 365 * 24 * 3600 * 1000;

// How old a static-document posting is: the server's Last-Modified header, else
// a year in the URL path (WordPress-style /uploads/2023/03/, CMS /files/2023-06/).
function documentAge(url, lastModified) {
  const lm = lastModified ? new Date(lastModified) : null;
  if (lm && !Number.isNaN(lm.getTime())) return { ms: Date.now() - lm.getTime(), source: `Last-Modified ${lm.toISOString().slice(0, 10)}` };
  const m = String(url).match(/\/(20\d{2})[/-](\d{2})\//);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 28));
    return { ms: Date.now() - d.getTime(), source: `URL dated ${m[1]}-${m[2]}` };
  }
  return null;
}

// ── PDF/Word postings: read the document for its deadline or start term ─────

// Text of a PDF (pdftotext) or .docx (unzip); "" when the tools are missing
// or the file is scanned/unreadable.
function documentText(buffer, contentType) {
  if (!buffer?.length) return "";
  const tmp = path.join(os.tmpdir(), `liveness-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    fs.writeFileSync(tmp, buffer);
    if (/pdf/i.test(contentType) || buffer.subarray(0, 4).toString() === "%PDF") {
      return execFileSync("pdftotext", ["-layout", tmp, "-"], { maxBuffer: 2e7, timeout: 30000, stdio: ["ignore", "pipe", "ignore"] }).toString();
    }
    if (/officedocument/i.test(contentType)) {
      return execFileSync("unzip", ["-p", tmp, "word/document.xml"], { maxBuffer: 2e7, timeout: 30000, stdio: ["ignore", "pipe", "ignore"] }).toString().replace(/<[^>]+>/g, " ");
    }
    return "";
  } catch {
    return "";
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const MON = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DOC_DATE = `(?:${MON}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}\\s+${MON},?\\s+\\d{4}|\\d{1,2}/\\d{1,2}/\\d{2,4}|\\d{4}-\\d{2}-\\d{2})`;
// "Application deadline: March 1, 2026", "Apply by ...", "Closing date ...".
// The gap before the date may not cross a start/begin phrase, so "Posting End
// Date: Until Filled  Projected Start Date: August 24" is not read as a deadline.
const DOC_DEADLINE_RE = new RegExp(
  `(?:application\\s+deadline|deadline(?:\\s+(?:to|for)\\s+appl\\w+)?|closing\\s+date|posting\\s+(?:closes?|close\\s+date|end\\s+date|expires?)|applications?\\s+(?:are\\s+)?(?:due|must\\s+be\\s+(?:received|submitted)|will\\s+be\\s+accepted\\s+(?:until|through)|accepted\\s+(?:until|through))|apply\\s+(?:by|no\\s+later\\s+than))(?:(?!start|begin|until\\s+filled)[^.\\n]){0,40}?(${DOC_DATE})`, "gi");
// A start term stated as such ("to start in the Fall 2025 term", "Start Date:
// Spring 2026", "beginning Spring 2026") -- not program history ("launched in Fall 2024").
const DOC_START_TERM_RE = /(?:start(?:ing|s)?(?:\s+date)?|begin(?:ning|s)?|commenc\w+|effective)\s*:?\s*(?:in\s+|with\s+)?(?:the\s+)?(fall|spring|summer|winter)\s+(?:semester\s+|term\s+|quarter\s+)?(20\d{2})\b|(?:during|for)\s+the\s+(fall|spring|summer|winter)\s+(20\d{2})\s+(?:semester|term)/gi;

// "beginning in August 2025", "to begin teaching August 2025", "start January 2026"
const DOC_START_MONTH_RE = new RegExp(`(?:start(?:ing|s)?|begin(?:ning|s)?|teaching|commenc\\w+)\\s+(?:teaching\\s+)?(?:in\\s+|on\\s+)?(${MON})\\s+(20\\d{2})\\b`, "gi");
// "Posting date June 24, 2025", "Date posted: 10/10/2025", "DATE: February 2024"
// (a bare "DATE:" header only in capitals, so "Start date: ..." is never read as posted)
const DOC_POSTED_RES = [
  new RegExp(`(?:posting\\s+date|date\\s+posted|posted(?:\\s+on)?)\\s*:?\\s*(${DOC_DATE}|${MON}\\s+20\\d{2})`, "gi"),
  new RegExp(`\\bDATE:\\s*(${DOC_DATE.replace(/\(\?:jan/, "(?:[Jj]an")}|[A-Z][a-z]+\\s+20\\d{2})`, "g"),
];
// Evergreen language: keeps an old document from being treated as stale.
const DOC_ONGOING_RE = /open\s+until\s+(?:the\s+position\s+is\s+)?filled|until\s+(?:the\s+)?position\s+is\s+filled|rolling\s+basis|on-?going|continuous(?:ly)?\s+(?:open|accept|recruit)|\[?\bpool\b\]?|as\s+needed/i;

function parseDocDate(raw) {
  const s = raw.replace(/(\d)(st|nd|rd|th)/, "$1").replace(/\./g, "");
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return new Date(Date.UTC(+m[3] < 100 ? +m[3] + 2000 : +m[3], +m[1] - 1, +m[2]));
  const d = new Date(`${s} 12:00 UTC`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const TERM_MONTH = { spring: 0, summer: 4, fall: 7, winter: 11 };

function documentDateSignals(text) {
  const flat = String(text).replace(/\s+/g, " ");
  const deadlines = [...flat.matchAll(DOC_DEADLINE_RE)].map((m) => ({ raw: m[0], date: parseDocDate(m[1]) })).filter((d) => d.date);
  const terms = [...flat.matchAll(DOC_START_TERM_RE)].map((m) => {
    const term = (m[1] || m[3]).toLowerCase(), year = +(m[2] || m[4]);
    return { label: `${term} ${year}`, start: new Date(Date.UTC(year, TERM_MONTH[term], 15)) };
  });
  for (const m of flat.matchAll(DOC_START_MONTH_RE)) {
    const d = parseDocDate(`${m[1]} 1, ${m[2]}`);
    if (d) terms.push({ label: `${m[1]} ${m[2]}`, start: d });
  }
  // "begin January 2026, if possible or August 2026": the later alternative counts
  for (const m of flat.matchAll(/(?:start|begin|teaching|commenc)\w*[^.]{0,60}?\bor\s+(?:(?:in|by)\s+)?(?:the\s+)?(\w+)\s+(20\d{2})\b/gi)) {
    const word = m[1].toLowerCase();
    const d = word in TERM_MONTH ? new Date(Date.UTC(+m[2], TERM_MONTH[word], 15)) : parseDocDate(`${m[1]} 1, ${m[2]}`);
    if (d) terms.push({ label: `${m[1]} ${m[2]}`, start: d });
  }
  const posted = DOC_POSTED_RES.flatMap((re) => [...flat.matchAll(re)])
    .map((m) => ({ raw: m[0], date: parseDocDate(/^\S+\s+20\d{2}$/.test(m[1].trim()) ? m[1].replace(/\s+(20\d{2})$/, " 1, $1") : m[1]) }))
    .filter((d) => d.date);
  const latest = (arr, key) => arr.reduce((a, b) => (!a || b[key] > a[key] ? b : a), null);
  return { deadline: latest(deadlines, "date"), startTerm: latest(terms, "start"), posted: latest(posted, "date"), ongoing: DOC_ONGOING_RE.test(flat) };
}

function classifyDocument(job, { status, finalUrl, contentType, docBuffer, lastModified }) {
  const age = documentAge(finalUrl || job.url, lastModified);
  if (age && age.ms > STALE_DOC_MS) return { verdict: "stale", httpCode: status, finalUrl, note: `static document, ${age.source}` };
  const text = documentText(docBuffer, contentType);
  if (text.replace(/\s+/g, "").length > 200) {
    const { deadline, startTerm, posted, ongoing } = documentDateSignals(text);
    const graceMs = 7 * 24 * 3600 * 1000;
    if (deadline && deadline.date.getTime() + graceMs < Date.now()) {
      return { verdict: "expired", httpCode: status, finalUrl, note: `document deadline ${deadline.date.toISOString().slice(0, 10)}: ${clean(deadline.raw).slice(0, 80)}` };
    }
    // A stated start term more than a term ago (e.g. "start Fall 2025" in Sept 2026)
    if (startTerm && startTerm.start.getTime() + 120 * 24 * 3600 * 1000 < Date.now()) {
      return { verdict: "expired", httpCode: status, finalUrl, note: `document start term ${startTerm.label} has passed` };
    }
    if (deadline) return { verdict: "open", httpCode: status, finalUrl, note: `document deadline ${deadline.date.toISOString().slice(0, 10)}` };
    // Posted over a year ago with nothing saying it's an ongoing pool/rolling search
    if (posted && !ongoing && posted.date.getTime() + STALE_DOC_MS < Date.now()) {
      return { verdict: "stale", httpCode: status, finalUrl, note: `document posted ${posted.date.toISOString().slice(0, 10)}: ${clean(posted.raw).slice(0, 60)}` };
    }
  }
  return { verdict: "unverifiable", httpCode: status, finalUrl, note: age ? `static document, ${age.source}` : "static document (PDF/Word) - can't tell if still open" };
}

function classifyPage(job, { status, finalUrl, body, contentType = "", lastModified = "", docBuffer = null }) {
  if (status === 404 || status === 410) return { verdict: "dead", httpCode: status };
  if (/<title>\s*Just a moment\.\.\.\s*<\/title>|cf-chl-|challenge-platform/i.test(String(body).slice(0, 20000))) return { verdict: "unverifiable", httpCode: status, note: "bot challenge" };
  if (status === 403 || status === 401 || status === 429 || status >= 500) return { verdict: "unverifiable", httpCode: status, note: `HTTP ${status}` };
  if (status < 200 || status >= 400) return { verdict: "unverifiable", httpCode: status, note: `HTTP ${status}` };
  // Cookie/login walls (e.g. PeopleSoft "errorPg=ckreq") aren't evidence the posting is gone
  if (finalUrl && /[?&]cmd=login\b|\/login\b|signin/i.test(finalUrl)) return { verdict: "unverifiable", httpCode: status, finalUrl, note: "redirected to login/cookie wall" };
  if (finalUrl && /[?&]jobnotfound=/i.test(finalUrl)) return { verdict: "dead", httpCode: status, finalUrl, note: "redirected to job-not-found" };
  // Soft 404: HTTP 200 with a "404 / Page Not Found" page title
  const pageTitle = (String(body).match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "";
  if (/\b404\b|page not found/i.test(pageTitle)) return { verdict: "dead", httpCode: status, finalUrl, note: `soft 404: ${clean(pageTitle).slice(0, 60)}` };
  if (finalUrl && isHomepageRedirect(job.url, finalUrl)) return { verdict: "dead", httpCode: status, finalUrl, note: "redirected away from posting" };

  if (/pdf|msword|officedocument/i.test(contentType)) return classifyDocument(job, { status, finalUrl, contentType, docBuffer, lastModified });
  // Phenom career sites (careers.*/us/en/job/...) embed the job's status as data
  // and ship a hidden "no longer available" template on every page, open or not.
  const phenom = String(body).match(/"jobDetail":\{"status":(\d{3})/);
  if (phenom) {
    if (phenom[1] !== "200") return { verdict: "closed", httpCode: status, finalUrl, note: `Phenom jobDetail status ${phenom[1]}` };
    const ratio = titleMatchRatio(job.title, htmlToText(body));
    return ratio < 0.5 ? { verdict: "mismatch", httpCode: status, finalUrl, titleMatch: ratio, note: "title not found on page" } : { verdict: "open", httpCode: status, finalUrl, titleMatch: ratio };
  }
  const text = htmlToText(body);
  const closed = findClosedPhrase(text);
  const ratio = titleMatchRatio(job.title, text);
  if (closed) return { verdict: "closed", httpCode: status, finalUrl, titleMatch: ratio, note: closed };
  if (text.length < 400) return { verdict: "unverifiable", httpCode: status, finalUrl, note: "JS-rendered or empty page" };
  if (ratio < 0.5) return { verdict: "mismatch", httpCode: status, finalUrl, titleMatch: ratio, note: "title not found on page" };
  return { verdict: "open", httpCode: status, finalUrl, titleMatch: ratio };
}

// URLs that differ only by #fragment (e.g. ASP.NET postback job boards) all load
// the same page, so a "closed" message on it can't be tied to one posting.
const SHARED_PAGE = new Set();
function markSharedPages(jobs) {
  const counts = new Map();
  for (const j of jobs) {
    const base = clean(j.url).split("#")[0];
    counts.set(base, (counts.get(base) || 0) + 1);
  }
  for (const j of jobs) if (clean(j.url).includes("#") && counts.get(clean(j.url).split("#")[0]) > 1) SHARED_PAGE.add(clean(j.url));
}

async function checkJob(job) {
  const url = clean(job.url);
  if (SHARED_PAGE.has(url)) return { verdict: "unverifiable", note: "shared page (URL differs only by #fragment)" };
  if (!url || url === "#") return { verdict: "dead", note: "no URL" };
  try { new URL(url); } catch { return { verdict: "dead", note: "invalid URL" }; }

  let result;
  try {
    const wd = workdayApiUrl(url);
    if (wd) result = await checkWorkday(job, wd);
    else if (/^workforcenow(\.cloud)?\.adp\.com$/i.test(new URL(url).hostname)) result = await checkAdp(job, url);
    else result = classifyPage(job, await fetchWithTimeout(url));
  } catch (err) {
    const msg = String(err?.cause?.code || err?.name || err?.message || err);
    // EAI_AGAIN is a temporary resolver failure, not a missing domain
    if (/ENOTFOUND/.test(msg)) result = { verdict: "dead", note: `DNS: ${msg}` };
    else result = { verdict: "unverifiable", note: msg === "AbortError" ? "timeout" : msg };
  }
  // A stated past deadline downgrades an "open" page (many ATSs keep pages up).
  if (result.verdict === "open" && isPastDate(job.closeDate)) {
    result = { ...result, verdict: "expired", note: `closeDate ${job.closeDate}` };
  }
  return result;
}

// ── Browser re-check (optional) ───────────────────────────────────────────────

async function browserRecheck(items, cache) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  let done = 0;
  await pool(items, BROWSER_CONCURRENCY, async (job) => {
    if (SHARED_PAGE.has(clean(job.url))) return;
    const page = await ctx.newPage();
    let result;
    try {
      const resp = await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS + 10000 });
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      const status = resp?.status() ?? 0;
      let text = clean(await page.evaluate(() => document.body?.innerText || ""));
      // Some career SPAs (Radancy/TalentBrew) paint their content, including
      // "404 (Not found)", well after network idle; give a near-empty page longer.
      if (text.length < 1500) {
        await page.waitForTimeout(8000);
        text = clean(await page.evaluate(() => document.body?.innerText || ""));
      }
      // Wrap the rendered text in a <title> so title-only job names still match
      // and soft-404 titles are detected the same way as in the raw-HTML pass.
      const title = clean(await page.title().catch(() => ""));
      result = classifyPage(job, { status, finalUrl: page.url(), body: `<title>${title}</title> ${title} ${text}`.padEnd(400, " ") });
      if (clean(text).length < 150 && result.verdict !== "dead") result = { ...result, verdict: "unverifiable", note: "empty after render" };
      if (result.verdict === "open" && isPastDate(job.closeDate)) result = { ...result, verdict: "expired", note: `closeDate ${job.closeDate}` };
      result.via = "browser";
    } catch (err) {
      result = { verdict: "unverifiable", note: `browser: ${String(err?.message || err).slice(0, 80)}`, via: "browser" };
    } finally {
      await page.close().catch(() => {});
    }
    cache[job.url] = { ...result, checkedAt: new Date().toISOString() };
    if (++done % 25 === 0 || done === items.length) process.stdout.write(`\r  Browser re-checked ${done}/${items.length}`);
  });
  console.log("");
  await browser.close();
}

// ── concurrency with per-host cap ────────────────────────────────────────────

async function pool(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

function hostOf(url) { try { return new URL(url).hostname; } catch { return "invalid"; } }

async function hostAwarePool(items, fn) {
  // Round-robin across hosts so one big ATS doesn't serialize the run.
  const queues = new Map();
  for (const it of items) {
    const h = hostOf(it.url);
    if (!queues.has(h)) queues.set(h, []);
    queues.get(h).push(it);
  }
  const active = new Map();
  let running = 0;
  return new Promise((resolve) => {
    const pump = () => {
      if (running === 0 && [...queues.values()].every((q) => q.length === 0)) return resolve();
      for (const [h, q] of queues) {
        while (q.length && running < CONCURRENCY && (active.get(h) || 0) < PER_HOST) {
          const it = q.shift();
          running++; active.set(h, (active.get(h) || 0) + 1);
          fn(it).finally(() => { running--; active.set(h, active.get(h) - 1); pump(); });
        }
        if (running >= CONCURRENCY) break;
      }
    };
    pump();
  });
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const payload = readJsonOrNull(JOBS_PATH);
  const allJobs = (Array.isArray(payload?.jobs) ? payload.jobs : Array.isArray(payload) ? payload : []).slice(0, LIMIT);
  if (!allJobs.length) { console.error(`No jobs in ${JOBS_PATH}`); process.exit(1); }

  markSharedPages(allJobs);
  const cache = FRESH ? {} : (readJsonOrNull(CACHE_PATH) || {});
  const todo = allJobs.filter((j) => !cache[clean(j.url)]);
  console.log(`\nPosting liveness audit — ${allJobs.length.toLocaleString()} jobs, ${todo.length.toLocaleString()} to check (${allJobs.length - todo.length} cached)`);
  console.log(`  concurrency ${CONCURRENCY}, ${PER_HOST}/host, timeout ${TIMEOUT_MS}ms\n`);

  let done = 0;
  const started = Date.now();
  let lastSave = Date.now();
  await hostAwarePool(todo, async (job) => {
    const url = clean(job.url);
    const r = await checkJob(job);
    cache[url] = { ...r, checkedAt: new Date().toISOString() };
    done++;
    if (Date.now() - lastSave > 30000) { writeJson(CACHE_PATH, cache); lastSave = Date.now(); }
    if (done % 50 === 0 || done === todo.length) {
      const rate = done / ((Date.now() - started) / 1000);
      const eta = Math.round((todo.length - done) / Math.max(rate, 0.01) / 60);
      process.stdout.write(`\r  Checked ${done}/${todo.length}  (${rate.toFixed(1)}/s, ~${eta} min left)   `);
    }
  });
  console.log("");
  writeJson(CACHE_PATH, cache);

  if (USE_BROWSER) {
    const retry = allJobs.filter((j) => {
      const c = cache[clean(j.url)];
      // Raw-HTML "closed" hits are re-confirmed against the rendered, visible text:
      // some sites ship a hidden "no longer available" template on every page.
      // Plain-fetch 404s are re-confirmed too: some career sites (jobs.<school>.edu/jobs/<slug>)
      // return 404 to fetchers at random while serving the posting to browsers.
      const flakyDead = c?.verdict === "dead" && c.httpCode === 404;
      // Documents can't render, bot challenges won't pass, and the API-backed
      // platforms already gave an exact answer.
      const noBrowser = /^(Workday|Phenom|ADP|static document|bot challenge)/.test(c?.note || "");
      return c && (["unverifiable", "mismatch", "closed"].includes(c.verdict) || flakyDead) && c.via !== "browser" && !noBrowser;
    });
    console.log(`\nRe-checking ${retry.length} unverifiable/mismatch/closed/404 pages in headless Chromium...`);
    if (retry.length) await browserRecheck(retry, cache);
    writeJson(CACHE_PATH, cache);
  }

  // Bot-challenged pages can't be read, but the daily scrape still sees each
  // posting on its school's listing; recent presence there is the best
  // available evidence it is up (the presence agent purges it once it drops off).
  const presence = readJsonOrNull(PRESENCE_PATH)?.jobs || {};
  const cutoff = Date.now() - LISTED_WITHIN_DAYS * 24 * 3600 * 1000;
  for (const job of allJobs) {
    const c = cache[clean(job.url)];
    if (!c || c.verdict !== "unverifiable" || !/bot challenge/.test(c.note || "")) continue;
    const seen = presence[job.canonicalJobId]?.lastSeen;
    if (seen && new Date(`${seen}T23:59:59Z`).getTime() >= cutoff) {
      cache[clean(job.url)] = { ...c, verdict: "listed", note: `bot challenge; on school's listing ${seen}` };
    }
  }
  writeJson(CACHE_PATH, cache);

  // Report
  const counts = {};
  const problems = [];
  const bySource = {};
  for (const job of allJobs) {
    const c = cache[clean(job.url)];
    if (!c) continue;
    counts[c.verdict] = (counts[c.verdict] || 0) + 1;
    const src = clean(job.source) || "Unknown";
    bySource[src] ||= { total: 0 };
    bySource[src].total++;
    bySource[src][c.verdict] = (bySource[src][c.verdict] || 0) + 1;
    if (c.verdict !== "open" && c.verdict !== "listed") {
      problems.push({ verdict: c.verdict, college: clean(job.college), title: clean(job.title), source: src, url: clean(job.url), httpCode: c.httpCode ?? "", note: c.note || "", closeDate: job.closeDate || "", canonicalJobId: job.canonicalJobId || "" });
    }
  }
  const order = ["dead", "closed", "expired", "stale", "mismatch", "unverifiable"];
  problems.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || a.college.localeCompare(b.college));

  writeJson(REPORT_PATH, { generatedAt: new Date().toISOString(), jobsFile: JOBS_PATH, total: allJobs.length, counts, bySource, problems });
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const cols = ["verdict", "college", "title", "source", "url", "httpCode", "note", "closeDate", "canonicalJobId"];
  fs.writeFileSync(CSV_PATH, [cols.join(","), ...problems.map((p) => cols.map((k) => esc(p[k])).join(","))].join("\n") + "\n");

  const pct = (n) => `${((n / allJobs.length) * 100).toFixed(1)}%`;
  console.log("\n── Results ──");
  for (const k of ["open", "listed", ...order]) console.log(`  ${k.padEnd(13)} ${String(counts[k] || 0).padStart(6)}  ${pct(counts[k] || 0)}`);
  console.log(`\n  Report : ${REPORT_PATH}\n  CSV    : ${CSV_PATH}\n`);
}

main().catch((err) => { console.error(err?.stack || err); process.exit(1); });
