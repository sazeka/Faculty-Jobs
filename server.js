
// Safe logging helper inserted at top to avoid scoping/syntax issues
const logScrapeResult = ({ campus, source, count }) => {
  try {
    const who = campus || "UnknownCampus";
    const src = source ? " " + source : "";
    console.log(String(src || '') + ' listings scraped: ' + String(count));
  } catch (e) {
    console.log("listings scraped:", count);
  }
};

// server.js
// One-file scraper + optional local API server.
// Exports scrapeAllJobsStandalone() for GitHub Actions.
// Starts Express only when run directly: `node server.js`

// Normalize college names to consistent title case
function normalizeCollegeName(name) {
  if (!name) return name;

  // Known mappings for CUNY and other colleges. Values must be IPEDS's exact
  // INSTNM for each campus (cross-checked against hd2024.csv) — every other
  // institution name in this dataset (institutions-master.json, IPEDS,
  // policy-rules.json) uses that canonical form, and build-institutions-master.js
  // matches jobs to institutions by exact name. A bare "Hunter College" instead
  // of IPEDS's "CUNY Hunter College" is the same silent-misattribution bug fixed
  // for CSU: it never matches the real IPEDS row (which then sits at 0 jobs /
  // "missing" forever) and instead spins up a duplicate, unitid-less identity
  // that soaks up the real job count.
  const knownNames = {
    'BARUCH': 'CUNY Bernard M Baruch College',
    'HUNTER': 'CUNY Hunter College',
    'Hunter': 'CUNY Hunter College',
    'BROOKLYN': 'CUNY Brooklyn College',
    'Brooklyn': 'CUNY Brooklyn College',
    'QUEENS': 'CUNY Queens College',
    'Queens': 'CUNY Queens College',
    'CITY COLLEGE': 'CUNY City College',
    'COLLEGE OF STATEN ISLAND': 'College of Staten Island CUNY',
    'JOHN JAY': 'CUNY John Jay College of Criminal Justice',
    'GRADUATE CENTER': 'CUNY Graduate School and University Center',
    'CUNY SCHOOL': 'CUNY School of Professional Studies',
    'CUNY Advanced': 'CUNY Advanced Science Research Center',
    'Bronx': 'CUNY Bronx Community College',
    'BRONX': 'CUNY Bronx Community College',
    'BMCC': 'CUNY Borough of Manhattan Community College',
    'HOSTOS': 'CUNY Hostos Community College',
    'KINGSBOROUGH': 'CUNY Kingsborough Community College',
    'LAGUARDIA': 'CUNY LaGuardia Community College',
    'LEHMAN': 'CUNY Lehman College',
    'MEDGAR EVERS': 'CUNY Medgar Evers College',
    'YORK COLLEGE': 'CUNY York College',
    'QUEENSBOROUGH': 'CUNY Queensborough Community College',
    'New York City College': 'CUNY New York City College of Technology',
    'School of Law': 'CUNY School of Law',
  };

  const upper = name.toUpperCase().trim();

  // Check known names first
  if (knownNames[name]) return knownNames[name];
  if (knownNames[upper]) return knownNames[upper];

  // Preserve certain acronyms
  const preserveUpper = ['CUNY', 'SUNY', 'CSU', 'UC', 'UCLA', 'USC', 'MIT', 'NYU'];

  // Apply title case
  return name.split(' ').map((word, i) => {
    const wordUpper = word.toUpperCase();
    if (preserveUpper.includes(wordUpper)) return wordUpper;
    if (word.length <= 2 && /^[A-Z]+$/.test(word)) return word; // Keep short acronyms
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { chromium } from "playwright";
import { createHash } from "crypto";
// ===== Local summarizer client (Node -> FastAPI /summarize) =====
const LOCAL_LLM_URLS = (process.env.LOCAL_LLM_URLS || process.env.LOCAL_LLM_URL || "http://127.0.0.1:9000/summarize")
  .split(",").map(s => s.trim()).filter(Boolean);
const LOCAL_LLM_BATCH_SIZE = Math.max(1, Number(process.env.LOCAL_LLM_BATCH_SIZE || 20));
const LOCAL_LLM_MAX_JOBS = Math.max(0, Number(process.env.LOCAL_LLM_MAX_JOBS || 0));
const LOCAL_LLM_RETRIES = Math.max(1, Number(process.env.LOCAL_LLM_RETRIES || 3));
const LOCAL_LLM_TIMEOUT = Math.max(30_000, Number(process.env.LOCAL_LLM_TIMEOUT || 600_000)); // ms
const LOCAL_LLM_MAX_NEW_TOKENS = Math.max(60, Number(process.env.LOCAL_LLM_MAX_NEW_TOKENS || 220));

function sha256Hex(str) {
  return createHash("sha256").update(str).digest("hex");
}
// Must match summarizer_gpu.py key_for(): sha256(url|title|description[:2000])
function jobCacheKey(job) {
  const url = job?.url || "";
  const title = job?.title || "";
  const desc = (job?.description || "").slice(0, 2000);
  return sha256Hex(`${url}|${title}|${desc}`);
}

function loadCachedSummariesFromJobsJson(jobs) {
  const cache = new Map();
  for (const j of jobs || []) {
    if (j && j.summary && String(j.summary).trim().length > 0) {
      const k = jobCacheKey(j);
      // store only enrichment fields we care about; keep original too if present
      cache.set(k, {
        summary: j.summary,
        enrichedAt: j.enrichedAt || j.scrapedAt || null,
        titleClean: j.titleClean || null,
        specialization: j.specialization || null,
        department: j.department || null,
        fieldTags: j.fieldTags || null,
        rank: j.rank || null,
        isValid: typeof j.isValid === "boolean" ? j.isValid : true,
        invalidReason: j.invalidReason || null,
      });
    }
  }
  return cache;
}

async function postWithRetry(url, body, attempts = LOCAL_LLM_RETRIES, softFail = false) {
  const { request } = await import(url.startsWith("https:") ? "node:https" : "node:http");

  const payload = JSON.stringify(body);
  const u = new URL(url);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const respText = await new Promise((resolve, reject) => {
        const req = request(
          {
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port || (u.protocol === "https:" ? 443 : 80),
            path: u.pathname + u.search,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            },
          },
          (res) => {
            let data = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(data);
              } else {
                reject(new Error(`Local LLM HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
              }
            });
          }
        );

        req.on("error", reject);

        // Hard timeout for entire request
        req.setTimeout(LOCAL_LLM_TIMEOUT, () => {
          req.destroy(new Error("Local LLM request timed out"));
        });

        req.write(payload);
        req.end();
      });

      return JSON.parse(respText);
    } catch (e) {
      console.error(
        `Local summarizer POST failed (attempt ${attempt}):`,
        e?.name,
        e?.message,
        e?.cause?.code || e?.code || ""
      );
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 1000 * attempt));
      else if (softFail) return null;
      else throw e;
    }
  }
}


async function checkEndpointHealth(url) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs: [], max_new_tokens: 1 }),
      signal: AbortSignal.timeout(5_000),
    });
    return true;
  } catch { return false; }
}

function buildBatchPayload(batch) {
  return {
    jobs: batch.map(j => {
      let loc = j.location || null;
      if (loc && typeof loc === 'object') loc = [loc.city, loc.state, loc.zip, loc.country].filter(Boolean).join(', ');
      return {
        url: j.url,
        title: j.title || null,
        description: j.description || null,
        college: j.college || null,
        location: loc,
        source: j.source || null,
      };
    }),
    max_new_tokens: LOCAL_LLM_MAX_NEW_TOKENS,
  };
}

function mergeBatchResults(batch, enriched) {
  for (let i = 0; i < batch.length; i++) {
    const origJob = batch[i];
    const e = enriched[i] || null;
    if (e && typeof e === "object") {
      Object.assign(origJob, e);
      // Safety net: discard bad titleClean values
      if (origJob.titleClean) {
        const tc = origJob.titleClean;
        const isBad =
          /&#x[\da-f]+;|&amp;|&lt;|&gt;/i.test(tc) ||           // HTML entities
          /Search\s*#/i.test(tc) ||                                // nav text contamination
          (origJob.college && tc.trim() === origJob.college.trim()); // just the college name
        if (isBad) {
          origJob.titleClean = origJob.title || tc;
        }
      }
      // Ensure a timestamp marker
      if (!origJob.enrichedAt) origJob.enrichedAt = new Date().toISOString();
    }
    Object.assign(origJob, normalizeJobEnrichment(origJob));
  }
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export async function callLocalSummarizer(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return jobs;

  // Load cache from current jobs.json snapshot if available (already merged into `jobs` upstream)
  const cache = loadCachedSummariesFromJobsJson(jobs);

  const all = jobs.slice();
  const maxJobs = LOCAL_LLM_MAX_JOBS > 0 ? Math.min(LOCAL_LLM_MAX_JOBS, all.length) : all.length;

  // Only summarize items missing a summary
  const need = [];
  for (let i = 0; i < maxJobs; i++) {
    const j = all[i];
    const k = jobCacheKey(j);
    if (cache.has(k)) continue;
    if (j && j.summary && String(j.summary).trim().length > 0) continue;
    need.push(j);
  }

  console.log(`📦 Using ${cache.size} cached summaries, ${need.length} jobs need AI processing`);
  if (need.length === 0) return all;

  // --- Health check all endpoints ---
  console.log(`📡 Checking ${LOCAL_LLM_URLS.length} summarizer endpoint(s)...`);
  const healthResults = await Promise.all(LOCAL_LLM_URLS.map(u => checkEndpointHealth(u)));
  const activeUrls = LOCAL_LLM_URLS.filter((_, i) => healthResults[i]);
  const unreachable = LOCAL_LLM_URLS.length - activeUrls.length;
  console.log(`📡 Summarizer endpoints: ${activeUrls.length} active, ${unreachable} unreachable`);
  if (unreachable > 0) {
    LOCAL_LLM_URLS.forEach((u, i) => {
      if (!healthResults[i]) console.warn(`   ⚠️  Unreachable: ${u}`);
    });
  }
  if (activeUrls.length === 0) {
    console.error("❌ No summarizer endpoints reachable — skipping AI enrichment");
    return all;
  }

  // --- Split work into batches ---
  const batches = [];
  for (let b = 0; b < need.length; b += LOCAL_LLM_BATCH_SIZE) {
    batches.push(need.slice(b, b + LOCAL_LLM_BATCH_SIZE));
  }
  const totalBatches = batches.length;
  const numEndpoints = activeUrls.length;

  let done = 0;
  const total = need.length;
  const startedAt = Date.now();

  // --- Process batches in rounds, one batch per endpoint per round ---
  for (let roundStart = 0; roundStart < totalBatches; roundStart += numEndpoints) {
    const roundBatches = batches.slice(roundStart, roundStart + numEndpoints);

    // Log and fire off concurrent requests
    const promises = roundBatches.map((batch, idx) => {
      const endpointUrl = activeUrls[idx];
      const batchNo = roundStart + idx + 1;
      const epLabel = numEndpoints > 1 ? ` → endpoint ${idx + 1}` : "";
      console.log(`🧠 Batch ${batchNo}/${totalBatches} (${done}/${total})${epLabel}`);

      const payload = buildBatchPayload(batch);
      return postWithRetry(endpointUrl, payload, LOCAL_LLM_RETRIES, true);
    });

    const results = await Promise.allSettled(promises);

    // Merge results back
    for (let idx = 0; idx < roundBatches.length; idx++) {
      const batch = roundBatches[idx];
      const result = results[idx];
      const resp = result.status === "fulfilled" ? result.value : null;

      if (resp === null) {
        const batchNo = roundStart + idx + 1;
        console.warn(`⚠️  Batch ${batchNo} failed on endpoint ${idx + 1} — jobs left unenriched`);
      } else {
        const enriched = Array.isArray(resp?.jobs) ? resp.jobs : [];
        mergeBatchResults(batch, enriched);
      }
      done += batch.length;
    }

    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, total - done);
    const throughput = done > 0 ? elapsed / done : null; // ms per job
    const etaMs = throughput ? remaining * throughput : null;
    if (remaining > 0 && etaMs) {
      console.log(`⏳ Summarizer progress: ${done}/${total} complete · ETA ~${formatDuration(etaMs)}`);
    } else {
      console.log(`✅ Summarizer progress: ${done}/${total} complete`);
    }
  }

  return all;
}


// ===== Campus/System allowlist for testing =====
const CAMPUS_ALLOWLIST = process.env.CAMPUS_ALLOWLIST
  ? process.env.CAMPUS_ALLOWLIST.split(",").map(s => s.trim()).filter(Boolean)
  : null;

function isAllowedSystem(name) {
  if (!CAMPUS_ALLOWLIST || CAMPUS_ALLOWLIST.length === 0) return true;
  const want = CAMPUS_ALLOWLIST.map(x => String(x).toUpperCase());
  const n = String(name || "").toUpperCase();
  // Support a few common aliases from the UI dropdown / prior runs
  if (n === "CSU" && want.includes("CA - CSU")) return true;
  if ((n === "CSU" || n === "UC" || n === "CLAREMONT COLLEGES" || n === "CA PRIVATE" || n === "CA CC") && (want.includes("CA") || want.includes("CALIFORNIA"))) return true;
  if ((n === "UMASS" || n === "UMASS AMHERST" || n === "MA PRIVATE") && (want.includes("MA") || want.includes("MASSACHUSETTS"))) return true;
  if (n === "MD" && (want.includes("MARYLAND") || want.includes("MD"))) return true;
  if (n === "ME" && (want.includes("MAINE") || want.includes("ME"))) return true;
  if (n === "NH" && (want.includes("NEW HAMPSHIRE") || want.includes("NH"))) return true;
  if (n === "VT" && (want.includes("VERMONT") || want.includes("VT"))) return true;
  if (n === "WI" && (want.includes("WISCONSIN") || want.includes("WISCONSON") || want.includes("WI"))) return true;
  if (n === "MT" && (want.includes("MONTANA") || want.includes("MT"))) return true;
  if (n === "TX" && (want.includes("TEXAS") || want.includes("TX"))) return true;
  if (n === "FL" && (want.includes("FLORIDA") || want.includes("FL"))) return true;
  if (n === "GA" && (want.includes("GEORGIA") || want.includes("GA"))) return true;
  if (n === "AL" && (want.includes("ALABAMA") || want.includes("AL"))) return true;
  if (n === "MS" && (want.includes("MISSISSIPPI") || want.includes("MS"))) return true;
  if (n === "LA" && (want.includes("LOUISIANA") || want.includes("LOUISEANA") || want.includes("LA"))) return true;
  if (n === "AR" && (want.includes("ARKANSAS") || want.includes("ARKINSAS") || want.includes("AR"))) return true;
  if (n === "KS" && (want.includes("KANSAS") || want.includes("KANSUS") || want.includes("KS"))) return true;
  if (n === "OK" && (want.includes("OKLAHOMA") || want.includes("OK"))) return true;
  if (n === "MO" && (want.includes("MISSOURI") || want.includes("MO"))) return true;
  if (n === "KY" && (want.includes("KENTUCKY") || want.includes("KENTUCI") || want.includes("KY"))) return true;
  if (n === "TN" && (want.includes("TENNESSEE") || want.includes("TENNISSE") || want.includes("TN"))) return true;
  if (n === "AK" && (want.includes("ALASKA") || want.includes("AK"))) return true;
  if (n === "HI" && (want.includes("HAWAII") || want.includes("HI"))) return true;
  if (n === "OH" && (want.includes("OHIO") || want.includes("OH"))) return true;
  if (n === "IN" && (want.includes("INDIANA") || want.includes("IN"))) return true;
  if (n === "WV" && (want.includes("WEST VIRGINIA") || want.includes("WV"))) return true;
  if (n === "ND" && (want.includes("NORTH DAKOTA") || want.includes("NORTH DOKOTA") || want.includes("ND"))) return true;
  if (n === "SD" && (want.includes("SOUTH DAKOTA") || want.includes("SOUTH DOKOTA") || want.includes("SD"))) return true;
  if (n === "NE" && (want.includes("NEBRASKA") || want.includes("NEGRASKA") || want.includes("NE"))) return true;
  if (n === "IA" && (want.includes("IOWA") || want.includes("IA"))) return true;
  if (n === "WY" && (want.includes("WYOMING") || want.includes("WY"))) return true;
  if (n === "CT STATE" && want.includes("CT")) return true;
  return want.includes(n);
}

function isNyOnlyRun() {
  if (!CAMPUS_ALLOWLIST || CAMPUS_ALLOWLIST.length === 0) return false;
  const allow = CAMPUS_ALLOWLIST.map(x => String(x).toUpperCase());
  const nyAliases = ["NY", "NEW YORK", "CUNY", "SUNY"];
  return allow.some(x => nyAliases.includes(x));
}

function normalizeCollegeKey(name) {
  return String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function loadPolicyExcludedCollegeKeys() {
  try {
    const rootDir = path.dirname(fileURLToPath(import.meta.url));
    const policyPath = path.join(rootDir, "generated", "policy-excluded-colleges.json");
    const payload = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    const names = Array.isArray(payload?.colleges) ? payload.colleges : [];
    const keys = new Set(names.map(normalizeCollegeKey).filter(Boolean));
    console.log(`🧾 Loaded policy exclusions: ${keys.size} institutions`);
    return keys;
  } catch (e) {
    console.warn(`⚠️  Failed to load generated policy exclusions: ${e?.message || e}`);
    return new Set();
  }
}

const POLICY_EXCLUDED_COLLEGE_KEYS = loadPolicyExcludedCollegeKeys();

function isPolicyExcludedCollege(name) {
  return POLICY_EXCLUDED_COLLEGE_KEYS.has(normalizeCollegeKey(name));
}

function loadForProfitCollegeKeys() {
  try {
    const rootDir = path.dirname(fileURLToPath(import.meta.url));
    const masterPath = path.join(rootDir, "data", "institutions-master.json");
    const payload = JSON.parse(fs.readFileSync(masterPath, "utf8"));
    const rows = Array.isArray(payload?.institutions) ? payload.institutions : [];
    const keys = new Set();
    for (const r of rows) {
      if (String(r?.control || "").toLowerCase() !== "private for-profit") continue;
      const k = normalizeCollegeKey(r?.name);
      if (k) keys.add(k);
    }
    console.log(`🏷️  Loaded private for-profit exclusions: ${keys.size} institutions`);
    return keys;
  } catch (e) {
    console.warn(`⚠️  Failed to load private for-profit exclusions: ${e?.message || e}`);
    return new Set();
  }
}

const PRIVATE_FOR_PROFIT_COLLEGE_KEYS = loadForProfitCollegeKeys();

function isPrivateForProfitCollege(name) {
  return PRIVATE_FOR_PROFIT_COLLEGE_KEYS.has(normalizeCollegeKey(name));
}


/* ============================== CONFIG ============================== */

const PORT = process.env.PORT || 3000;

const MAX_PARALLEL_CAMPUSES = Number(process.env.MAX_PARALLEL_CAMPUSES || 4);
const MAX_PARALLEL_SYSTEMS = Number(process.env.MAX_PARALLEL_SYSTEMS || 4);

// ===== System Group Mapping =====
// Groups related university systems together for filtering
const SYSTEM_GROUP_MAP = {
  // California Public Universities
  "UC": "California Public",
  "CA - CSU": "California Public",
  "CSU": "California Public",
  // California Private Universities
  "CA Private": "California Private",
  // California Community Colleges
  "CA CC": "California Community Colleges",
  // New York Public Universities
  "NY": "New York Public",
  "CUNY": "New York Public",
  "SUNY": "New York Public",
  // Massachusetts Public Universities
  "UMass": "Massachusetts Public",
  // Massachusetts Private Universities
  "MA": "Massachusetts Private",
  // Maryland
  "MD": "Maryland",
  // Northern New England
  "ME": "Maine",
  "NH": "New Hampshire",
  "VT": "Vermont",
  // Connecticut
  "CT": "Connecticut",
  "CT State": "Connecticut",
  // Oregon and Washington
  "OR": "Oregon",
  "WA": "Washington",
  // Texas and Florida
  "TX": "Texas",
  "FL": "Florida",
  // Southeast / South-Central
  "GA": "Georgia",
  "USG": "Georgia",
  "TCSG": "Georgia",
  "AL": "Alabama",
  "MS": "Mississippi",
  "LA": "Louisiana",
  "AR": "Arkansas",
  "KS": "Kansas",
  "OK": "Oklahoma",
  "MO": "Missouri",
  "KY": "Kentucky",
  "TN": "Tennessee",
  "AK": "Alaska",
  "HI": "Hawaii",
  // Ohio, Indiana, West Virginia
  "OH": "Ohio",
  "IN": "Indiana",
  "WV": "West Virginia",
  // Northern Plains and Iowa
  "ND": "North Dakota",
  "SD": "South Dakota",
  "NE": "Nebraska",
  "IA": "Iowa",
  "WY": "Wyoming",
};

export function getSystemGroup(source) {
  if (!source) return null;
  return SYSTEM_GROUP_MAP[source] || null;
}

const CUNY_URL = "https://cuny.jobs/job-category/faculty/jobs/";
const CT_URL = "https://www.ct.edu/hr/jobs";

const CT_PRIVATE_CAMPUSES = [
  {
    campus: "Yale University",
    // Was pointing at an entirely unrelated institution (Cleveland Clinic
    // School of Health Professions) — a copy-paste error, not a stale link.
    // Real board is the Provost's Office listing site (plain Drupal 7, static
    // anchors, no dedicated scraper needed) with Interfolio apply links.
    type: "generic",
    url: "https://academicpositions.yale.edu/",
  },
  {
    campus: "University of Connecticut",
    type: "pageup",
    url: "https://careers.pageuppeople.com/967/cw/en-us/listing/",
  },
  {
    campus: "Wesleyan University",
    type: "workday",
    url: "https://wesleyan.wd5.myworkdayjobs.com/careers",
  },
  {
    campus: "University of Hartford",
    type: "peopleadmin",
    url: "https://hartford.peopleadmin.com/postings/search",
  },
  {
    campus: "Trinity College",
    type: "peopleadmin",
    url: "https://trincoll.peopleadmin.com/postings/search",
  },
  {
    campus: "Quinnipiac University",
    type: "pageup",
    url: "https://careers.pageuppeople.com/871/cw/en-us/listing/",
  },
  {
    campus: "Fairfield University",
    type: "workday",
    url: "https://ffd.wd1.myworkdayjobs.com/EmploymentOpportunities",
  },
  {
    campus: "Connecticut College",
    type: "peopleadmin",
    url: "https://www.conncoll.edu/employment/",
  },
  {
    campus: "University of Bridgeport",
    type: "paycom",
    url: "https://www.paycomonline.net/v4/ats/web.php/jobs?clientkey=A1640D81A59AFDAFC5501F5B06EF1B08",
  },
  { campus: "Albertus Magnus College", type: "generic", url: "https://www.albertus.edu/about-us/our-faculty/our-faculty.php/jobs" },
  { campus: "Central Connecticut State University", type: "generic", url: "https://www.ccsu.edu/" },
  { campus: "Charter Oak State College", type: "generic", url: "https://www.charteroak.edu/aboutus/employment.php" },
  { campus: "Connecticut State Community College", type: "generic", url: "https://ctstate.edu/" },
  { campus: "Eastern Connecticut State University", type: "generic", url: "https://www.easternct.edu/" },
];

const CSU_URL =
  "https://csucareers.calstate.edu/en-us/filter/?=&leftNavSearchFormQuery=&=&search=&search-keyword=&job-mail-subscribe-privacy=agree&work-type=instructional%20faculty%20%e2%80%93%20tenured%2ftenure-track&category=unit%203%20-%20cfa%20-%20california%20faculty%20association&job-mail-subscribe-privacy=agree";

// University System of Georgia: shared PeopleSoft HCM careers feed covering
// most USG member institutions (NOT UGA/Georgia State/Georgia Tech, which run
// their own separate PeopleAdmin sites — those stay in GA_CAMPUSES). Same
// "system covers members, never per-campus" rule as CSU.
const USG_URL =
  "https://careers.hprod.onehcm.usg.edu/psc/careers/CAREERS/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL&Action=U";

// UMass (same "en-us/filter" platform style as CSU) - Note: Amherst moved to PageUp in Jan 2026
const UMASS_CAMPUSES = [
  {
    campus: "UMass Boston",
    url: "https://employmentopportunities.umb.edu/boston/en-us/filter/?search-keyword=&work-type=faculty%20full%20time&job-mail-subscribe-privacy=agree",
  },
  {
    campus: "UMass Dartmouth",
    type: "enusfilter",
    url: "https://careers.umassd.edu/en-us/filter?search-keyword=&job-mail-subscribe-privacy=agree&work-type=faculty%20full%20time",
  },
  {
    campus: "UMass Lowell",
    url: "https://explorejobs.uml.edu/lowell/en-us/filter/?job-mail-subscribe-privacy=agree&search-keyword=&work-type=faculty%20full%20time",
  },
];

// UMass Amherst (new PageUp platform as of Jan 2026)
const UMASS_AMHERST_URL = "https://careers.umass.edu/jobs/search?employment_type=Faculty";

// Massachusetts private universities + liberal arts colleges
const MA_PRIVATE_CAMPUSES = [
  {
    campus: "Harvard University",
    type: "peopleadmin-dept",
    url: "https://academicpositions.harvard.edu/postings/search?utf8=%E2%9C%93&query=",
  },
  {
    campus: "Massachusetts Institute of Technology",
    type: "peopleclick",
    url: "https://careers.peopleclick.com/careerscp/client_mit/external/results/searchResult.html",
  },
  {
    campus: "Tufts University",
    type: "jibe-api",
    url: "https://jobs.tufts.edu/",
  },
  {
    campus: "Brandeis University",
    type: "workday",
    url: "https://brandeis.wd5.myworkdayjobs.com/Jobs",
  },
  {
    campus: "Amherst College",
    type: "workday",
    url: "https://amherst.wd5.myworkdayjobs.com/en-US/Amherst_Jobs",
  },
  {
    campus: "Mount Holyoke College",
    type: "workday",
    url: "https://mtholyoke.wd5.myworkdayjobs.com/en-US/External",
  },
  {
    campus: "Boston University",
    type: "generic",
    url: "https://www.bu.edu/hr/careers/faculty/",
  },
  // Was pointing at the student Career Center (Student Affairs) -- a
  // careers-services page for BC students to find external jobs/
  // internships, not BC's own hiring page. bc.edu/jobs redirects to a CSOD
  // career site whose "Faculty Positions" link in turn points to this real
  // Provost's Office "Faculty Openings" gateway page. Verified live (two
  // fresh page loads): 17 real faculty postings (Assistant Professor of
  // Special Education, Tenured/Tenure-Track Faculty Position in Management
  // and Organization, Assistant Professor in American Public Law, etc.),
  // each with a real Interfolio apply-link anchor.
  {
    campus: "Boston College",
    type: "generic",
    url: "https://www.bc.edu/content/bc-web/academics/sites/office-of-provost/faculty-gateway/faculty-openings.html",
  },
  {
    campus: "Northeastern University",
    type: "workday",
    url: "https://northeastern.wd1.myworkdayjobs.com/careers",
  },
  {
    campus: "Wellesley College",
    type: "workday",
    url: "https://wd1.myworkdaysite.com/recruiting/wellesley/wellesley-faculty",
  },
  {
    campus: "Williams College",
    type: "generic",
    url: "https://www.williams.edu/admin/human-resources/employment/",
  },
  {
    campus: "Smith College",
    type: "smith-interfolio",
    url: "https://www.smith.edu/academics/provostdean-faculty/employment",
  },
  {
    campus: "Babson College",
    type: "peopleadmin",
    url: "https://www.babson.edu/",
  },
  {
    campus: "Bentley University",
    type: "workday",
    url: "https://bentley.wd503.myworkdayjobs.com/faculty",
  },
  {
    campus: "College of the Holy Cross",
    type: "jobvite",
    url: "https://jobs.jobvite.com/holycross/jobs",
  },
  { campus: "Springfield College-Regional, Online, and Continuing Education", type: "schooljobs", url: "https://www.schooljobs.com/careers/springfieldcollege" },
  { campus: "Signature Healthcare Brockton Hospital School of Nursing", type: "generic", url: "https://signature-healthcare.org/careers/faculty" },
  { campus: "American International College", type: "generic", url: "https://www.aic.edu/" },
  { campus: "Anna Maria College", type: "generic", url: "https://www.annamaria.edu/" },
  { campus: "Assumption University", type: "generic", url: "https://www.assumption.edu/people-and-departments/organization-listing/office-human-resources/employment-opportunities" },
  { campus: "Bard College at Simon's Rock", type: "generic", url: "https://www.simons-rock.edu/" },
  { campus: "Bay Path University", type: "generic", url: "https://www.baypath.edu/about/careers-at-bay-path-university-and-cambridge-college" },
  { campus: "Benjamin Franklin Cummings Institute of Technology", type: "generic", url: "https://www.bfit.edu/" },
  // Was pointing at a bare berklee.edu page. Real ATS is Workday. Verified
  // live (two fresh page loads): 60 jobs, real current faculty postings
  // ("Part-Time Harp Faculty", "Full-time Faculty, Electronic Production").
  { campus: "Berklee College of Music", type: "workday", url: "https://berklee.wd1.myworkdayjobs.com/BerkleeCareers" },
  // Was pointing at a literal 404 search-results page. Real employment page
  // is /about-bcc/employment-opportunities/, which lists real per-posting
  // anchors to their InterviewExchange ATS (already handled fine by the
  // generic scraper when pointed directly at it, same pattern as other
  // interviewexchange-hosted schools). Verified live: 3 current postings,
  // incl. real faculty openings ("Adjunct Faculty - Ceramics", "Nursing
  // Clinical Adjunct Faculty").
  { campus: "Berkshire Community College", type: "generic", url: "https://www.berkshirecc.edu/about-bcc/employment-opportunities/index.php" },
  { campus: "Boston Architectural College", type: "generic", url: "https://the-bac.edu/employment" },
  { campus: "Boston Baptist College", type: "generic", url: "https://www.boston.edu/" },
  { campus: "Boston Graduate School of Psychoanalysis Inc", type: "generic", url: "https://www.bgsp.edu/" },
  { campus: "Bridgewater State University", type: "generic", url: "https://www.bridgew.edu/" },
  { campus: "Bristol Community College", type: "interviewexchange", url: "https://bristolcc.interviewexchange.com/static/clients/460BCM1/index.jsp;jsessionid=3C23F471BF242A30472AA845F1FFDA86" },
  { campus: "Bunker Hill Community College", type: "generic", url: "https://www.bhcc.edu/" },
  { campus: "Cambridge College", type: "generic", url: "https://www.cambridgecollege.edu/" },
  { campus: "Cape Cod Community College", type: "interviewexchange", url: "https://capecod.interviewexchange.com/static/clients/470CCM1/index.jsp;jsessionid=D7B817EED47381B2C5A08E3F538D4EB5;jsessionid=2E2FB86EF203E255B5590EC9F09035DF" },
  { campus: "Clark University", type: "interviewexchange", url: "https://clarku.interviewexchange.com/static/clients/569CUM1/index.jsp" },
  { campus: "College of Our Lady of the Elms", type: "generic", url: "https://www.elms.edu/" },
  // Was pointing at the bare homepage, which has no employment/careers link
  // anywhere in its nav. Real "Job Openings" page found via web search (not
  // linked from the homepage nav) -- confirmed live. Verified live (two
  // fresh page loads): genuinely 0 faculty postings right now -- only a
  // "Summer Intern Position: Strategic Projects Internship" listed.
  { campus: "Conway School of Landscape Design", type: "generic", url: "https://csld.edu/people/job-openings/" },
  { campus: "Curry College", type: "interviewexchange", url: "https://curry.interviewexchange.com/" },
  { campus: "Dean College", type: "interviewexchange", url: "https://dean.interviewexchange.com/static/clients/546DCM1/index.jsp" },
  { campus: "Eastern Nazarene College", type: "generic", url: "https://www.enc.edu/" },
  { campus: "Emerson College", type: "workday", url: "https://emerson.wd5.myworkdayjobs.com/en-US/Emerson_College_ft_faculty" },
  { campus: "Emmanuel College", type: "interviewexchange", url: "https://emmanuel.interviewexchange.com/static/clients/13EM1/listJobs.jsp;jsessionid=47B469F5FF02B2ECA11624165C411A0F" },
  { campus: "Endicott College", type: "generic", url: "https://www.endicott.edu/" },
  { campus: "Fisher College", type: "generic", url: "https://www.fisher.edu/careers" },
  { campus: "Fitchburg State University", type: "interviewexchange", url: "https://fitchburg.interviewexchange.com/static/clients/500FSM1/index.jsp" },
  // Was pointing at the bare careers landing page. Real ATS is
  // InterviewExchange (linked as "Search Openings and Apply Now"). Wired for
  // correctness; NOT verified live per the established
  // InterviewExchange-is-blocked-by-WAF precedent from rounds 1/5/6.
  {
    campus: "Framingham State University",
    type: "interviewexchange",
    url: "https://framingham.interviewexchange.com/static/clients/353FSM1/listJobs.jsp",
  },
  { campus: "Franklin W Olin College of Engineering", type: "generic", url: "https://www.olin.edu/" },
];

// UC (AP Recruit)
const UC_CAMPUSES = [
  { campus: "UC Berkeley", url: "https://aprecruit.berkeley.edu/apply" },
  { campus: "UCLA", url: "https://recruit.apo.ucla.edu/apply" },
  { campus: "UC San Diego", url: "https://apol-recruit.ucsd.edu/apply" },
  { campus: "UC San Francisco", url: "https://aprecruit.ucsf.edu/apply" },
  { campus: "UC Santa Barbara", url: "https://recruit.ap.ucsb.edu/apply" },
  { campus: "UC Davis", url: "https://recruit.ucdavis.edu/apply" },
  { campus: "UC Irvine", url: "https://recruit.ap.uci.edu/apply" },
  { campus: "UC Riverside", url: "https://aprecruit.ucr.edu/apply" },
  { campus: "UC Santa Cruz", url: "https://recruit.ucsc.edu/apply" },
  { campus: "UC Merced", url: "https://aprecruit.ucmerced.edu/apply" },
];

// California major private research universities
const CA_PRIVATE_CAMPUSES = [
  {
    campus: "Stanford University",
    type: "pageup",
    url: "https://facultypositions.stanford.edu/en-us/listing/",
  },
  {
    campus: "University of Southern California",
    type: "usc-jobs",
    url: "https://usccareers.usc.edu/search-jobs/?category=Faculty",
  },
  {
    campus: "California Institute of Technology",
    type: "taleo",
    url: "https://phf.tbe.taleo.net/phf03/ats/careers/v2/jobSearch?act=redirectCwsV2&cws=37&org=CALTECH",
  },
  { campus: "Academy for Jewish Religion California", type: "generic", url: "https://www.ajrca.edu/faculty/jobs" },
  { campus: "Academy of Chinese Culture and Health Sciences", type: "generic", url: "https://www.acchs.edu/faculty/jobs" },
  { campus: "Acupuncture and Integrative Medicine College-Berkeley", type: "generic", url: "https://www.aimc.edu/" },
  { campus: "Alder Graduate School of Education", type: "generic", url: "https://aldergse.edu/" },
  { campus: "Allan Hancock College", type: "generic", url: "https://www.hancockcollege.edu/careers/" },
  { campus: "America Evangelical University", type: "generic", url: "https://www.aeu.edu/" },
  { campus: "American Academy of Dramatic Arts-Los Angeles", type: "generic", url: "https://www.aada.edu/" },
  { campus: "American Jewish University", type: "generic", url: "https://aju.edu/careers" },
  { campus: "American River College", type: "schooljobs", url: "https://www.schooljobs.com/careers/losriosccd/jobs/5203260/english-assistant-professor" },
  { campus: "Antelope Valley Community College District", type: "generic", url: "https://www.avc.edu/about/administration/human-resources/employment/full-time-faculty-positions" },
  // Was pointing at the bare university-wide employment page, which lists
  // every campus's postings together (New England, Seattle, LA, Santa
  // Barbara, Online, GSLC) with no per-campus attribution in the generic
  // scraper's anchor-based view. The page's own WP Job Manager widget
  // supports a native ?search_location= facet that really filters
  // server-side ("Search completed. Found 8 matching records." for Los
  // Angeles, all correctly LA-tagged) -- scoped each campus to its own
  // facet URL instead of the shared page, same principle as the
  // district-wide PeopleAdmin Work Location facet scoping used elsewhere.
  // Verified live: LA facet returns 8 real postings (currently all Staff/
  // Work-Study, 0 Faculty-titled right now); SB facet returns 3 (same, 0
  // Faculty-titled right now) -- correct, real infrastructure, genuinely no
  // faculty opening at either specific campus at check time (the system
  // does have current Faculty postings, e.g. "Teaching Faculty, Clinical
  // Psychology" / "Core Faculty, Clinical Psychology", but both are
  // New England-tagged, not LA/SB).
  { campus: "Antioch University-Los Angeles", type: "generic", url: "https://www.antioch.edu/employment" },
  { campus: "Antioch University-Santa Barbara", type: "generic", url: "https://www.antioch.edu/employment" },
  // Was pointing at the bare campus homepage. Real ATS is the West Hills
  // Community College District's shared NEOGOV/schooljobs tenant (covers
  // Coalinga College, Lemoore College, and the District Office) -- this
  // platform has no URL-facet for location like PeopleAdmin does, so scoped
  // via scrapeSchoolJobsAs's locationFilter param instead (reads each job
  // card's own "Coalinga College, CA" / "Lemoore College, CA" location line).
  // Verified live: 93 postings district-wide, including a Coalinga-specific
  // real faculty posting ("Part-time (Adjunct) Faculty – Non-Credit GED
  // (High School Equivalency)", Coalinga College, CA, Category: Education).
  {
    campus: "Coalinga College",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/whccd",
    locationFilter: "Coalinga",
  },
  // Same shared West Hills CCD schooljobs tenant as Coalinga College above --
  // scoped via locationFilter instead of a URL facet (platform has none).
  // Verified live: the board's first <ul class="list-meta"> <li> is the
  // location line for every card (confirmed via a raw querySelectorAll dump
  // across 6 real cards: "Lemoore College, CA" / "Coalinga College, CA" is
  // always element [0]) -- matches the same extraction scrapeNjSchoolJobs
  // already uses. Real Lemoore-tagged postings exist ("Adjunct Head Coach -
  // Women's Wrestling", Lemoore College, CA) though most of the district's
  // large "Part-Time (Adjunct) Faculty - <subject>" pool postings are tagged
  // "District Office - Coalinga, CA" instead of a specific campus, so they
  // won't match this filter (same as they wouldn't misattribute to Coalinga
  // either -- that filter matches them only because "Coalinga" is a literal
  // substring of "District Office - Coalinga, CA").
  {
    campus: "Lemoore College",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/whccd",
    locationFilter: "Lemoore",
  },
  // Was pointing at the bare llu.edu homepage. Real ATS is Loma Linda
  // University Health's Oracle Cloud (CX) recruiting site, shared with the
  // health system but scoped here to a "faculty" keyword search since Oracle
  // CX's own UI facets (Nursing/Healthcare Clinical Support/etc.) don't
  // expose a plain "Faculty" bucket. Verified live (two fresh loads): 15
  // real postings under the keyword filter including "Associate
  // Professor-PhD", "Assistant Professor-PhD (NN)", "Assoc Professor-PhD",
  // "Assistant Professor-PA", "Assistant Professor-NP", all Loma Linda, CA.
  { campus: "Loma Linda University", type: "oracle-cx", url: "https://egln.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs?keyword=faculty" },
  // Specialized health-sciences program operated directly under LA County
  // Dept. of Health Services (a county government department, not an
  // independent degree-granting institution) -- its only "Careers" link goes
  // to the whole county DHS careers portal, not anything program-specific.
  // Likely a policy-exclusion candidate rather than a scraper fix; left as-is.
  { campus: "Los Angeles County College of Nursing and Allied Health", type: "generic", url: "https://dhs.lacounty.gov/college-of-nursing-and-allied-health/" },
  // Real ATS is Middlebury College's shared Workable board (apply.workable.com/
  // middleburycollege), covering every Middlebury campus/school system-wide.
  // Confirmed the HINT's concern live via Workable's own POST /api/v3/.../jobs
  // API: of the 8 postings in the "Faculty" department bucket, all 8 are
  // Vermont Language Schools summer instructor roles (Chinese/Arabic/German/
  // Japanese/Korean/Hebrew/Russian), none Monterey-tagged. Separately checked
  // all 111 total postings district-wide for any Monterey-tagged posting
  // regardless of department: 11 exist, but zero are in the Faculty
  // department and none are genuine faculty roles (all Student-worker/Staff).
  // Workable's location facet ("Monterey, California" is a real option in
  // the account's own /jobs/filters response) is UI-driven, not a URL query
  // param -- ?location=... on page load does not change the POST body the
  // page itself sends, so there's no URL-based way to scope it, and no
  // dedicated Workable scraper exists in this codebase to call the JSON API
  // directly. Documented, not patched: even a perfect scope would show 0
  // right now anyway. Left as the shared board URL rather than misattributing
  // the whole system's Faculty count to Monterey.
  { campus: "Middlebury Institute of International Studies at Monterey", type: "generic", url: "https://apply.workable.com/middleburycollege" },
  // Was pointing at the bare campus homepage. Real ATS is Ventura County
  // CCD's shared NEOGOV/schooljobs tenant (covers Moorpark, Oxnard, and
  // Ventura Colleges plus the District Administrative Center) -- scoped via
  // locationFilter the same way as the West Hills CCD board above (no URL
  // facet on this platform). Verified live (raw ul.list-meta dump confirms
  // the first <li> is the location line, same shape as West Hills CCD):
  // real Moorpark-tagged faculty posting "Instructor in Biotechnology
  // (Part-Time Pool)", Moorpark College (Moorpark CA), CA, Part-Time
  // Faculty. Most of the district's "Instructor in <subject> (Part-Time
  // Pool)" postings are tagged "Districtwide (Ventura County CA), CA"
  // instead of a specific campus, so they correctly won't match this filter.
  {
    campus: "Moorpark College",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/vcccd",
    locationFilter: "Moorpark",
  },
  { campus: "Sanford Burnham Prebys Medical Discovery Institute", type: "generic", url: "https://www.sbpdiscovery.org/education/graduate-school" },
  // "/faculty/jobs" 404s ("this page has a new home"). Real board is Rancho
  // Santiago CCD's own Faculty and Academic Administrative Opportunities
  // NEOGOV/schooljobs sub-board (a separate tenant path from the district's
  // general Classified Staff board) -- RSCCD has only two colleges (Santa
  // Ana College and Santiago Canyon College) plus the District Office, and
  // every SCC posting's location line reads "Orange, CA" (SCC's home city)
  // vs. SAC's "Santa Ana, CA", so locationFilter: "Orange" cleanly scopes to
  // this campus. Verified live: real posting "PT POOL - Ethnic Studies
  // Instructor", Orange, CA, Division: SCC Arts Humanities and Social
  // Sciences, Category: PT POOL - Instructor.
  {
    campus: "Santiago Canyon College",
    type: "schooljobs",
    url: "https://www.sccollege.edu/faculty/jobs",
    locationFilter: "Orange",
  },
  { campus: "The Chicago School at Anaheim", type: "generic", url: "https://www.thechicagoschool.edu/in-the-community/locations/" },
  // Real ATS is a single Workday tenant (tcsedsystem.wd1.myworkdayjobs.com/
  // TCSPP) shared across every Chicago School campus (Anaheim, LA, San
  // Diego, Chicago, Dallas, Nursing, Xavier University of Louisiana) -- 72
  // openings unscoped. Its own facet list exposes per-campus location IDs
  // (confirmed via the page's own /wday/cxs/.../jobs POST response), so
  // scoped with a bare "?locations=<id>" query param the same way as
  // Embry-Riddle-Daytona Beach above. Verified live: LA facet (id
  // 0cec31c3016301fde4ca6f18e1496e00) returns 15 real postings including
  // "Adjunct Faculty - Clinical Psychology - Los Angeles Campus" and
  // "Department Faculty - Clinical Psychology - Child/Adolescent or
  // Pediatric Psychology, Los Angeles Location".
  {
    campus: "The Chicago School at Los Angeles",
    type: "workday",
    url: "https://www.thechicagoschool.edu/in-the-community/careers",
  },
  // Same shared Workday tenant as LA above, San Diego's own facet id
  // (confirmed via the same /wday/cxs/.../jobs facet list). Verified live:
  // 2 real postings -- "Adjunct Faculty - MFT - San Diego Campus" and
  // "Adjunct Faculty - Applied Behavior Analysis - San Diego Campus".
  {
    campus: "The Chicago School at San Diego",
    type: "workday",
    url: "https://www.thechicagoschool.edu/in-the-community/careers",
  },
  { campus: "Trinity Law School", type: "generic", url: "https://www.tiu.edu/law" },
  // Was pointing at the bare homepage. Real employment page is
  // /about/employment.html, which itself hands off to a Cornerstone OnDemand
  // (CSOD) career site (artcenter.csod.com/ux/ats/careersite/7/home?c=artcenter)
  // -- confirmed institution-specific (not a shared tenant) with real current
  // postings including "Part Time Shop Instructor II - second shift". BUT the
  // existing CSOD handler (scrapeCsodAs/scrapeNjCsod, shared with many other
  // institutions) returns 0 for this tenant's UI -- verified live that plain
  // anchor scraping of that CSOD page finds the postings fine, so this is a
  // gap in the shared CSOD scraper's markup assumptions for this "ux/ats"
  // skin, not a bad URL. Documented, not patched (shared function). Still an
  // improvement over the homepage even though the handoff currently yields 0.
  { campus: "Art Center College of Design", type: "generic", url: "https://www.artcenter.edu/about/employment.html" },
  { campus: "Azusa Pacific University", type: "generic", url: "https://jobs.apu.edu/" },
  { campus: "Bakersfield College", type: "generic", url: "https://www.bakersfieldcollege.edu/" },
  { campus: "Barstow Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/barstowcc" },
  { campus: "Berkeley City College", type: "generic", url: "https://www.berkeleycitycollege.edu/" },
  { campus: "Berkeley School of Theology", type: "generic", url: "https://www.bst.edu/" },
  { campus: "Bethesda University", type: "generic", url: "https://www.buc.edu/academics/faculty-jobs" },
  { campus: "Biola University", type: "generic", url: "https://www.biola.edu/" },
  { campus: "Butte College", type: "generic", url: "https://www.butte.edu/careers" },
  { campus: "Cabrillo College", type: "schooljobs", url: "https://www.schooljobs.com/careers/cabrilloedu" },
  { campus: "California Baptist University", type: "generic", url: "https://www.calbaptist.edu/" },
  { campus: "California College of the Arts", type: "workday", url: "https://cca.wd5.myworkdayjobs.com/CCA/jobs" },
  { campus: "California Institute of Advanced Management", type: "generic", url: "https://ciam.edu/employment-opportunities/" },
  { campus: "California Institute of Integral Studies", type: "interviewexchange", url: "https://ciis.interviewexchange.com/static/clients/529CIM1" },
  { campus: "California Institute of the Arts", type: "generic", url: "https://calarts.edu/employment" },
  // Was pointing at "cjc.edu/faculty/jobs" -- the entire cjc.edu domain now
  // 404s/redirects into the rebranded jazzschool.org site. Its real "Careers"
  // page (linked from the footer) is here. Verified live (two fresh page
  // loads): genuinely 0 faculty postings right now -- only two staff roles
  // listed (Director of Education; Program Administrator), neither
  // faculty/adjunct/instructor-titled.
  { campus: "California Jazz Conservatory", type: "generic", url: "https://jazzschool.org/about/careers/" },
  { campus: "California Lutheran University", type: "generic", url: "https://www.callutheran.edu/offices/human-resources/employment" },
  // California Polytechnic State University-San Luis Obispo, Cal Poly Humboldt,
  // and Cal Poly Pomona are CSU members already covered by mapCsuLocationToCampus
  // — see the "never per-campus for CSU members" rule below. Homepage-only
  // entries here were dead weight at best and a duplicate-under-a-second-name
  // risk at worst if ever populated with a real URL, so removed with the rest.
  // CSU campuses are covered by the system-wide scrape (scrapeCsuFaculty / CSU_URL,
  // csucareers.calstate.edu). Per-campus entries here double-scraped members and
  // produced duplicate postings under a second campus-name spelling (e.g. East Bay
  // appeared as both "California State University, East Bay" and "...-East Bay").
  // Removed so CSU is system-only — see the "never per-campus for CSU members" rule.
  { campus: "California University of Science and Medicine", type: "generic", url: "https://www.cusm.edu/careers.php" },
  { campus: "California Western School of Law", type: "generic", url: "https://www.cwsl.edu/careers" },
  { campus: "Canada College", type: "generic", url: "https://canadacollege.edu/" },
  { campus: "Casa Loma College-Los Angeles", type: "generic", url: "https://casalomacollege.edu/careers-2" },
  { campus: "CBD College", type: "generic", url: "https://www.cbd.edu/" },
  { campus: "Cerritos College", type: "generic", url: "https://www.cerritos.edu/" },
  { campus: "Cerro Coso Community College", type: "generic", url: "https://cerrocoso.edu/" },
  // Was pointing at the unscoped district-wide search (Chabot-Las Positas
  // CCD shares one PeopleAdmin instance across Chabot College, Las Positas
  // College, and two district offices). Scoped to Chabot's own Location
  // facet (1240[]=2) so postings aren't misattributed across the shared
  // district board -- verified live the facet genuinely filters server-side
  // (1 of the district's 3 current postings is Chabot-specific: "Children's
  // Center Cook"; 0 currently Faculty-titled at this specific campus).
  { campus: "Chabot College", type: "peopleadmin", url: "https://clpccd.peopleadmin.com/postings/search?1240%5B%5D=2" },
  // "/faculty/jobs" 404s. Real ATS is NEOGOV/schooljobs; the main careers
  // board's "Current Openings" list is mostly Short-Term Worker/Classified
  // postings with a separate "CLICK HERE for Adjunct Faculty Opportunities"
  // link to a promotionaljobs sub-board holding the actual faculty pool.
  // Verified live: 50 real postings, e.g. "African American Studies (and/or
  // Black Studies/Africana) Ethnic Studies), Part-Time Faculty Pool" and
  // "American Sign Language, Part-Time Faculty Pool", both Category: Faculty.
  { campus: "Chaffey College", type: "schooljobs", url: "https://www.chaffey.edu/faculty/jobs" },
  { campus: "Chapman University", type: "generic", url: "https://www.chapman.edu/faculty-staff/human-resources/jobs/index.aspx" },
  { campus: "Charles R Drew University of Medicine and Science", type: "generic", url: "https://www.cdrewu.edu/" },
  { campus: "Church Divinity School of the Pacific", type: "generic", url: "https://www.cdsp.edu/" },
  { campus: "Citrus College", type: "generic", url: "https://www.citruscollege.edu/" },
  { campus: "City College of San Francisco", type: "generic", url: "https://www.ccsf.edu/about-ccsf/administration/human-resources/jobs-ccsf" },
  { campus: "Claremont Lincoln University", type: "generic", url: "https://claremontlincoln.edu/careers-at-clu" },
  { campus: "Claremont School of Theology", type: "generic", url: "https://www.cst.edu/" },
  { campus: "Clovis Community College", type: "generic", url: "https://www.cloviscollege.edu/" },
  { campus: "Coast Community College District Office", type: "generic", url: "https://www.cccd.edu/employment/index.html" },
  { campus: "Coastline Community College", type: "generic", url: "https://www.coastline.edu/" },
  { campus: "College of Alameda", type: "generic", url: "https://alameda.edu/" },
  { campus: "College of Marin", type: "generic", url: "https://www.marin.edu/" },
  // Real ATS found: the San Mateo County CCD's shared InterviewExchange
  // tenant (smccd.interviewexchange.com), with Full-Time Faculty (catid=2081)
  // and Part-Time Faculty (catid=2082) category links from the district HR
  // page. NOT wired: unlike the PeopleAdmin (Chabot/Contra Costa CCD) and
  // schooljobs (West Hills CCD) shared boards elsewhere in this file, this
  // tenant has no campus-level facet at all (only a coarse "United
  // States-CA" state filter) -- every posting checked (incl. detail pages)
  // carries just "San Mateo, CA" / a generic HR department, with no way to
  // tell College of San Mateo apart from Skyline College or Cañada College,
  // the other two colleges in this district. Wiring the shared URL here
  // would misattribute the whole district's postings to this one campus
  // (the Bemidji State misattribution lesson) -- left as bare homepage
  // pending either a better facet discovery or a policy decision. Separately
  // NOT verified against the InterviewExchange-WAF-blocked precedent from
  // rounds 1/5/6/10 (loaded fine for this investigation, but that has been
  // an intermittent/environment-dependent block historically).
  { campus: "College of San Mateo", type: "generic", url: "https://www.collegeofsanmateo.edu/" },
  { campus: "College of the Canyons", type: "generic", url: "https://www.canyons.edu/" },
  // Was pointing at the bare homepage. Real careers page links to their
  // NEOGOV/schooljobs recruiting portal (single-institution tenant, not a
  // shared district board). Verified live: 7 postings, 1 faculty-titled
  // ("Economics Instructor, part-time", Category: Instructor).
  { campus: "College of the Desert", type: "schooljobs", url: "https://www.schooljobs.com/careers/collegeofthedesertca" },
  { campus: "College of the Redwoods", type: "generic", url: "https://www.redwoods.edu/" },
  // schooljobs.com is a client-rendered SPA; "generic" only reads anchors once on
  // page 1 without the platform's own pagination — "schooljobs" already exists
  // and handles both.
  { campus: "College of the Sequoias", type: "schooljobs", url: "https://www.schooljobs.com/careers/cos" },
  { campus: "College of the Siskiyous", type: "generic", url: "https://www.siskiyous.edu/" },
  { campus: "Compton College", type: "generic", url: "https://www.compton.edu/" },
  { campus: "Concordia University-Irvine", type: "generic", url: "https://www.cui.edu/" },
  // Was pointing at the bare 4cdcareers.net homepage. Contra Costa CCD
  // shares a single PeopleAdmin instance across Contra Costa College,
  // Diablo Valley College, Los Medanos College, Brentwood/San Ramon
  // campuses, and the District Office -- scoped to Contra Costa College's
  // own Location facet (449[]=3) instead of the unscoped district-wide
  // search. Verified live: facet genuinely filters server-side (8 of the
  // district's current postings are CCC-specific, including 2 real faculty
  // postings: "Adjunct Instructor (TEMPORARY) – FAMA Studio Art" and
  // "...FAMA Art History").
  { campus: "Contra Costa College", type: "peopleadmin", url: "https://www.4cdcareers.net/" },
  { campus: "Contra Costa Community College District Office", type: "generic", url: "https://www.4cd.edu/" },
  { campus: "Copper Mountain Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/cmccd" },
  { campus: "Cosumnes River College", type: "generic", url: "https://www.crc.losrios.edu/" },
  { campus: "Crafton Hills College", type: "generic", url: "https://www.craftonhills.edu/" },
  // Was pointing at the bare homepage. Real ATS is NEOGOV/schooljobs
  // (single-institution tenant). Verified live: 26 postings, several
  // faculty-titled ("Automotive Technology Part-Time Instructor Pool",
  // "Aviation Maintenance Part-Time Instructor Pool").
  { campus: "Cuesta College", type: "schooljobs", url: "https://www.schooljobs.com/careers/cuesta" },
  { campus: "Cuyamaca College", type: "generic", url: "https://www.cuyamaca.edu/" },
  { campus: "Cypress College", type: "generic", url: "https://www.cypresscollege.edu/" },
  { campus: "Daybreak University", type: "generic", url: "https://daybreak.edu/" },
  { campus: "De Anza College", type: "generic", url: "https://www.deanza.edu/" },
  { campus: "DHARMA REALM BUDDHIST UNIVERSITY", type: "generic", url: "https://www.drbu.edu/hr" },
  // Same shared Contra Costa CCD PeopleAdmin instance as Contra Costa
  // College above -- scoped to Diablo Valley College's own Location facet
  // (449[]=4). Verified live: 5 DVC-specific postings, 4 real faculty
  // ("Chemistry Adjunct Instructor (TEMPORARY)", "Music Adjunct Instructor
  // – Applied Low Brass (TEMPORARY)", "Engineering Adjunct Instructor
  // (TEMPORARY)", "Electronics Adjunct Instructor (TEMPORARY)").
  { campus: "Diablo Valley College", type: "peopleadmin", url: "https://www.4cdcareers.net/postings/search?449%5B%5D=4" },
  { campus: "Dominican School of Philosophy & Theology", type: "generic", url: "https://www.dspt.edu/employment" },
  { campus: "Dominican University of California", type: "generic", url: "https://www.dominican.edu/" },
  { campus: "Dongguk University Los Angeles", type: "generic", url: "https://www.dula.edu/" },
  { campus: "Downey Adult School", type: "generic", url: "https://www.das.edu/" },
  { campus: "East Los Angeles College", type: "generic", url: "https://www.elac.edu/" },
  { campus: "EDvance College", type: "generic", url: "https://edvance.edu/" },
  // Was pointing at the bare homepage. Real employment page lists current
  // openings directly (own site, not an ATS handoff), broken out by
  // category including "Teaching or Counseling (Part-Time Temporary)" and
  // "Teaching or Counseling (Full-Time Tenure Track)". Verified live:
  // real, correctly functioning page, but both faculty categories show "No
  // Current Openings" right now (only Classified postings currently open).
  { campus: "El Camino Community College District", type: "generic", url: "https://www.elcamino.edu/departments/human-resources/employment-opportunities.php" },
  { campus: "Epic Bible College & Graduate School", type: "generic", url: "https://epic.edu/" },
  // Was pointing at the EVC-only "Jobs & Career Center" student-services page
  // (Handshake/work-study/co-op links only, no HR listing). Real ATS is the
  // San Jose-Evergreen CCD's shared PeopleAdmin instance (covers Evergreen
  // Valley College, San Jose City College, and the District Office). This
  // tenant has no numeric Location facet field (unlike Chabot/Contra Costa
  // CCD elsewhere in this file) -- confirmed via a DOM dump of every
  // <select>/<input> on the search form -- but its free-text "Keywords"
  // search genuinely full-text-matches each posting's own Location column
  // server-side, not just the title, so query="Evergreen Valley College"
  // cleanly scopes to this campus alone. Verified live (two fresh loads):
  // 7 of 7 results tagged "Evergreen Valley College", including a real
  // faculty posting ("COUNSELOR, UMOJA/AFFIRM", Category: Faculty).
  {
    campus: "Evergreen Valley College",
    type: "peopleadmin",
    url: "https://www.evc.edu/jobs",
  },
  { campus: "Feather River Community College District", type: "generic", url: "https://www.frc.edu/" },
  // Was pointing at the bare fielding.edu homepage. Real "Apply For Jobs"
  // link hands off to a single-institution ADP Workforce Now board (a JSON
  // API, no browser rendering needed). Verified live via the raw API
  // response: 3 postings, 2 real faculty titles ("Doctoral Faculty,
  // Clinical Psychology (Greater Chicago Area)", "Doctoral Faculty, Clinical
  // Psychology (Seattle, Washington)") plus a non-faculty "General Online
  // Application" placeholder.
  {
    campus: "Fielding Graduate University",
    type: "adp",
    url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=371bf4c2-8681-458c-8b35-722b1fc8d540&ccId=19000101_000001&type=MP&lang=en_US",
  },
  { campus: "Folsom Lake College", type: "schooljobs", url: "https://www.schooljobs.com/careers/losriosccd" },
  { campus: "Foothill College", type: "generic", url: "https://foothill.edu/employment/" },
  { campus: "Foothill-De Anza Community College District", type: "schooljobs", url: "https://www.schooljobs.com/careers/fhda/Faculty" },
  // Confirmed real, correctly-functioning page (verified live, two fresh
  // loads): "We currently do not have any employment opportunities at this
  // time." Genuinely 0 openings right now, not a bug.
  { campus: "Franciscan School of Theology", type: "generic", url: "https://www.fst.edu/about/employment-opportunities" },
  { campus: "Fresno City College", type: "generic", url: "https://www.fresnocitycollege.edu/" },
  { campus: "Fresno Pacific University", type: "generic", url: "https://www.fresno.edu/" },
  { campus: "Fuller Theological Seminary", type: "generic", url: "https://www.fuller.edu/" },
  { campus: "California State University-Fresno", type: "generic", url: "https://adminfinance.fresnostate.edu/hr/jobs" },
  { campus: "California State University-Northridge", type: "generic", url: "https://www.csun.edu/hr/careers" },
  { campus: "California State University-San Marcos", type: "generic", url: "https://www.csusm.edu/careers" },
];

// NJ (multi-platform)
const NJ_CAMPUSES = [
  {
    campus: "The College of New Jersey",
    type: "taleo",
    url: "https://tcnj.taleo.net/careersection/00_ex_faculty/jobsearch.ftl?lang=en",
  },
  {
    campus: "Kean University",
    type: "workday",
    url: "https://kean.wd503.myworkdayjobs.com/Kean?jobFamilyGroup=367abbb2b3b80136908699f7a90d56ac",
  },
  {
    campus: "Montclair State University",
    type: "workday",
    url: "https://montclair.wd1.myworkdayjobs.com/JobOpportunities?jobFamilyGroup=0c89f3515631109bdddc974975dae955",
  },
  {
    campus: "Rutgers, The State University of New Jersey",
    type: "rutgers",
    url: "https://jobs.rutgers.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&435=&225=&query_position_type_id%5B%5D=6&2182%5B%5D=3&commit=Search",
  },
  {
    campus: "New Jersey City University",
    type: "taleo",
    url: "https://phe.tbe.taleo.net/phe03/ats/careers/v2/searchResults?org=NJCU&cws=41",
  },
  {
    campus: "New Jersey Institute of Technology",
    type: "csod",
    url: "https://njit.csod.com/ux/ats/careersite/1/home?c=njit&cfdd[0][id]=71&cfdd[0][options][0]=35",
  },
  {
    campus: "Ramapo College of New Jersey",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/ramapo?keywords=faculty",
  },
  {
    campus: "Stockton University",
    // NJ_CAMPUSES is dispatched via scrapeNjPublic, which only recognizes a
    // fixed set of type strings (taleo/workday/rutgers/csod/schooljobs/
    // stockton) — anything else, including "generic", short-circuits to [].
    // A dedicated scrapeNjStockton already targets this exact ATS.
    type: "stockton",
    url: "https://employment.stockton.edu/jobs/search",
  },
  {
    campus: "William Paterson University",
    type: "workday",
    url: "https://wpunj.wd1.myworkdayjobs.com/ext?jobFamilyGroup=beb7f5bb680310016e27a7df06100000",
  },
];

const NJ_PRIVATE_CAMPUSES = [
  { campus: "Princeton University", type: "princeton", url: "https://puwebp.princeton.edu/AcadHire/apply/" },
  { campus: "Seton Hall University", type: "pageup", url: "https://jobs.shu.edu/cw/en-us/listing" },
  { campus: "Stevens Institute of Technology", type: "workday", url: "https://stevens.wd5.myworkdayjobs.com/External" },
  { campus: "Fairleigh Dickinson University", type: "peopleadmin", url: "https://jobs.fdu.edu/postings/search" },
  { campus: "Rider University", type: "schooljobs", url: "https://www.schooljobs.com/careers/rideru?keywords=faculty" },
  { campus: "Saint Peter's University", type: "paycom", url: "https://www.paycomonline.net/v4/ats/web.php/jobs?clientkey=055E28882001FE667534B0880CFCD275" },
  { campus: "Monmouth University", type: "generic", url: "https://recruiting.ultipro.com/MON1000MON/JobBoard/d4da5ea7-24db-4f02-a484-7497ffffb76d/?q=&o=postedDateDesc" },
  { campus: "Rowan University", type: "pageup", url: "https://jobs.rowan.edu/" },
  { campus: "Capital Health School of Nursing", type: "generic", url: "https://www.capitalhealth.org/professionals/school-of-nursing" },
  { campus: "Capital Health School of Radiologic Technology", type: "generic", url: "https://www.capitalhealth.org/professionals/school-of-radiologic-technology" },
  { campus: "Hackensack Meridian School of Medicine", type: "generic", url: "https://www.hmsom.edu/en" },
  { campus: "Holy Name Medical Center-Sister Claire Tynan School of Nursing", type: "generic", url: "https://holyname.org/SchoolofNursing" },
  { campus: "Atlantic Cape Community College", type: "schooljobs", url: "https://www.governmentjobs.com/careers/atlanticcape" },
  { campus: "Bais Medrash Toras Chesed", type: "generic", url: "https://www.bmtc.edu/" },
  { campus: "Bergen Community College", type: "generic", url: "https://www.bergen.edu/" },
  { campus: "Beth Medrash Govoha", type: "generic", url: "https://bmg.edu/" },
  { campus: "Bloomfield College of Montclair State University", type: "generic", url: "https://www.bloomfield.edu/" },
  { campus: "Brookdale Community College", type: "generic", url: "https://www.brookdalecc.edu/academic-institutes-and-departments/business-social-sciences/history/careers-and-benefits-for-history-majors/" },
  { campus: "Caldwell University", type: "generic", url: "https://www.caldwell.edu/hr/employment-opportunities/faculty-adjunct/" },
  {
    campus: "Camden County College",
    type: "generic",
    url: "https://jobs.camdencc.edu/postings/search?query=&query_v0_posted_at_date=&426=&427%5B%5D=5&commit=Search",
  },
  { campus: "Centenary University", type: "generic", url: "https://www.centenaryuniversity.edu/" },
  { campus: "County College of Morris", type: "generic", url: "https://www.ccm.edu/" },
  { campus: "Drew University", type: "generic", url: "https://www.drew.edu/" },
  { campus: "Essex County College", type: "generic", url: "https://www.essex.edu/directory/employment-opportunities" },
  // NOT switched to jobs.fdu.edu/postings/search like the main FDU entry above:
  // that board has no per-campus filter (checked live — "Metropolitan"/"Florham"
  // only appear inside individual posting titles, e.g. "... (Metropolitan
  // Campus)", not a URL facet), and it's the exact same board the main
  // "Fairleigh Dickinson University" entry already scrapes — pointing both
  // campus entries at it too would triple-count every posting across 3 campus
  // identities instead of fixing anything. Left broken rather than risking that.
  { campus: "Fairleigh Dickinson University-Florham Campus", type: "generic", url: "https://jobs.fdu.edu/" },
  { campus: "Fairleigh Dickinson University-Metropolitan Campus", type: "generic", url: "https://jobs.fdu.edu/" },
  { campus: "Felician University", type: "generic", url: "https://felician.edu/about-felician-university/careers-at-felician/" },
];

// Claremont Colleges
const CLAREMONT_CAMPUSES = [
  {
    campus: "Pomona College",
    type: "pomona",
    url: "https://www.pomona.edu/administration/academic-dean/general/faculty-jobs",
  },
  {
    campus: "Claremont Graduate University",
    type: "generic",
    url: "https://www.cgu.edu/employment-opportunities/faculty-jobs/",
  },
  // Already correctly wired (real single-institution page, real anchors
  // with real titles) -- verified live: 4 current postings, at least 2
  // clearly pass the faculty-keyword filter ("William J. Kenan Endowed
  // Chair Tenured Professor in Media Industries and Digital Technologies",
  // "Visiting Lecturer in Psychology - Fall 2026"). institutions-master.json's
  // missing/generic labels are simply stale here, same as Northern Arizona
  // University in round 17.
  { campus: "Scripps College", type: "generic", url: "https://www.scrippscollege.edu/hr/faculty" },
  {
    campus: "Claremont McKenna College",
    type: "cmc",
    url: "https://webapps.cmc.edu/jobs/faculty/faculty_opening.php",
  },
  {
    campus: "Harvey Mudd College",
    type: "generic",
    url: "https://www.hmc.edu/dean-of-faculty/available-faculty-positions/",
  },
  {
    campus: "Keck Graduate Institute",
    type: "workday",
    url: "https://theclaremontcolleges.wd1.myworkdayjobs.com/en-US/KGI_Careers?jobFamilyGroup=c556221e536801fcd7010014ef742f7a&timeType=9df8dc300a421048ab2494d9bae91551",
  },
];

// PA (multi-platform)
const PA_CAMPUSES = [
  {
    campus: "Cheyney University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/cheyneyedu?category[0]=Faculty&jobType[0]=Full-Time&sort=PositionTitle%7CAscending",
  },
  {
    campus: "Commonwealth University",
    type: "peopleadmin",
    url: "https://commonwealthu.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&1846%5B%5D=2&435=&commit=Search",
  },
  {
    campus: "East Stroudsburg University",
    type: "csod",
    url: "https://esu.csod.com/ux/ats/careersite/1/home/requisition/8301?c=esu",
  },
  {
    campus: "Kutztown University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/kutztownedu/promotionaljobs?jobType[0]=Tenure%20Track&sort=PostingDate%7CDescending",
  },
  {
    campus: "Millersville University",
    type: "peopleadmin",
    url: "https://jobs.millersville.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_organizational_tier_3_id=any&577=7&commit=Search",
  },
  {
    campus: "PennWest",
    type: "peopleadmin",
    url: "https://pennwest.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&435=&query_position_type_id%5B%5D=8&commit=Search",
  },
  {
    campus: "Shippensburg University",
    type: "peopleadmin",
    url: "https://jobs.ship.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=2&commit=Search",
  },
  {
    campus: "Slippery Rock University",
    type: "peopleadmin",
    url: "https://careers.sru.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&518=&query_organizational_tier_3_id%5B%5D=any&query_position_type_id%5B%5D=2&373=&commit=Search",
  },
  {
    campus: "West Chester University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/wcupa?keywords=faculty%20",
  },
  {
    campus: "The Pennsylvania State University",
    type: "workday",
    url: "https://psu.wd1.myworkdayjobs.com/PSU_Academic?timeType=b9c7a8628206010c6cedcb3aa4474a00&jobFamily=57340197317201e0b53836bfde4ae85f",
  },
];

const PA_PRIVATE_CAMPUSES = [
  {
    campus: "University of Pennsylvania",
    type: "workday-search",
    url: "https://wd1.myworkdaysite.com/recruiting/upenn/careers-at-penn",
  },
  {
    campus: "Carnegie Mellon University",
    type: "workday",
    url: "https://cmu.wd5.myworkdayjobs.com/CMU",
  },
  {
    campus: "Drexel University",
    type: "pageup",
    url: "https://careers.pageuppeople.com/820/cw/en-us/listing/",
  },
  {
    campus: "Lehigh University",
    type: "generic",
    url: "https://facultyjobs.lehigh.edu/faculty",
  },
  {
    campus: "Villanova University",
    type: "peopleadmin",
    url: "https://jobs.villanova.edu/postings/search",
  },
  {
    campus: "Bucknell University",
    type: "workday",
    url: "https://bucknell.wd1.myworkdayjobs.com/External?jobFamilyGroup=3ce5feabe53e01fb2262242fcb6e5c06",
  },
  {
    campus: "Swarthmore College",
    type: "pageup",
    url: "https://careers.pageuppeople.com/819/cw/en-us/listing/",
  },
  {
    campus: "Gettysburg College",
    type: "peopleadmin",
    url: "https://gettysburg.peopleadmin.com/postings/search",
  },
  {
    campus: "Dickinson College",
    type: "workday",
    url: "https://dickinson.wd108.myworkdayjobs.com/Jobs",
  },
  {
    campus: "Lafayette College",
    type: "lafayette-faculty",
    url: "https://provost.lafayette.edu/faculty-positions-available/",
  },
  {
    campus: "Franklin & Marshall College",
    type: "interfolio-links",
    url: "https://www.fandm.edu/campus-services/human-resources/",
  },
  { campus: "Albright College", type: "generic", url: "https://www.albright.edu/home/" },
  { campus: "Citizens School of Nursing", type: "generic", url: "https://www.ahn.org/education/citizens-school-nursing" },
  { campus: "Commonwealth Technical Institute", type: "generic", url: "https://www.dli.pa.gov/Individuals/Disability-Services/CTI-HGAC/Pages/Home.aspx" },
  { campus: "Eastern University", type: "schooljobs", url: "https://www.schooljobs.com/careers/easternpa" },
  { campus: "Geisinger Commonwealth School of Medicine", type: "generic", url: "https://www.geisinger.edu/education" },
  { campus: "Harcum College", type: "generic", url: "https://www.harcum.edu/s/1044/edu/start.aspx" },
  // jobs.sju.edu canonicalizes to a raw Workday tenant with 0 static anchors — a
  // pure JS SPA shell "generic" can't read. Using the direct myworkdayjobs.com
  // URL (rather than the custom domain) lets scrapeWorkdayApi's own URL-pattern
  // match hit its API path instead of falling back to the slower browser scrape.
  { campus: "Saint Joseph's University - Lancaster", type: "generic", url: "https://jobs.sju.edu/" },
  { campus: "University of Pittsburgh-Titusville", type: "generic", url: "https://www.titusville.pitt.edu/home" },
  { campus: "Joseph F McCloskey School of Nursing", type: "generic", url: "https://www.lvhn.org/education/joseph-f-mccloskey-school-nursing" },
  { campus: "Reading Hospital School of Health Sciences", type: "generic", url: "https://reading.towerhealth.org/academics/health-sciences/" },
  { campus: "Talmudical Yeshiva of Philadelphia", type: "generic", url: "https://www.meterware.com/typ/Talmudical_Yeshiva_of_Philadelphia?C=N;O=D" },
  { campus: "UPMC Jameson School of Nursing", type: "generic", url: "https://www.upmc.com/healthcare-professionals/education/schools-of-nursing/campuses/jameson" },
  { campus: "UPMC Mercy School of Nursing", type: "generic", url: "https://www.upmc.com/mercyson" },
  { campus: "UPMC Shadyside School of Nursing", type: "generic", url: "https://www.upmc.com/shyson" },
  { campus: "UPMC St. Margaret School of Nursing", type: "generic", url: "https://www.upmc.com/stmargson" },
  { campus: "Washington Health System School of Nursing", type: "generic", url: "https://whs.org/school-of-nursing/" },
  { campus: "Western Pennsylvania Hospital School of Nursing", type: "generic", url: "https://www.ahn.org/health-care-professionals/education/nursing/schools/west-penn-hospital" },
  { campus: "Allegheny College", type: "generic", url: "https://allegheny.edu/" },
  { campus: "Alvernia University", type: "generic", url: "https://www.alvernia.edu/faculty-staff/human-resources/employment-opportunities" },
  { campus: "American College of Financial Services", type: "generic", url: "https://www.paycomonline.net/v4/ats/web.php/jobs?clientkey=0EC6D26D6ACC066E0F0E668BFD94D104" },
  { campus: "Arcadia University", type: "generic", url: "https://arcadia.isolvedhire.com/jobsearch?job_board_classification=faculty" },
  // Was pointing at the bare homepage. Real employment page just says
  // "email your resume to hrdept@aspirapa.org" -- no job board/anchors at
  // all. Routed to it anyway for correctness, but it will structurally never
  // produce a link-based posting for the generic scraper to catch.
  { campus: "ASPIRA City College", type: "generic", url: "https://aspiracitycollege.edu/employment-opportunities" },
  // Was pointing at the bare homepage (no careers link in nav at all). Real
  // employment page found via web search. Verified live (two fresh page
  // loads): real page, currently "No Openings At This Time" -- genuinely 0
  // right now, but future postings will be caught.
  { campus: "Bryn Athyn College of the New Church", type: "generic", url: "https://brynathyn.edu/about/human-resources/employment-opportunities.html" },
  { campus: "Bryn Mawr College", type: "generic", url: "https://www.brynmawr.edu/" },
  { campus: "Bucks County Community College", type: "generic", url: "https://www.bucks.edu/employment" },
  { campus: "Butler County Community College", type: "generic", url: "https://www.bc3.edu/" },
  { campus: "Byzantine Catholic Seminary of Saints Cyril and Methodius", type: "generic", url: "https://www.bcs.edu/" },
  { campus: "Cairn University-Langhorne", type: "generic", url: "https://cairn.edu/hr/jobs" },
  { campus: "Carlow University", type: "generic", url: "https://www.carlow.edu/about/employment" },
  { campus: "Cedar Crest College", type: "generic", url: "https://www.cedarcrest.edu/about/human-resources" },
  { campus: "Central Pennsylvania Institute of Science and Technology", type: "generic", url: "https://cpi.edu/company/cpi" },
  { campus: "Chatham University", type: "generic", url: "https://www.chatham.edu/" },
  { campus: "Chestnut Hill College", type: "generic", url: "https://www.chc.edu/careers-at-chc/employment-opportunities" },
  { campus: "Cheyney University of Pennsylvania", type: "schooljobs", url: "https://www.schooljobs.com/careers/cheyneyedu" },
  // Was pointing at the bare homepage. Homepage links to their PeopleAdmin
  // career site; the site itself categorizes postings into tiles (Faculty/
  // Staff/Coach/Temporary Pools) -- this is the Faculty-filtered search.
  // PA dispatcher already has a "peopleadmin" case -- reused directly.
  // Verified live (two fresh page loads): 2 real faculty postings (Assistant
  // Professor (Tenure Track) - Physician Associate Studies, Assistant
  // Professor (Tenure Track) - Speech-Language Pathology).
  {
    campus: "Commonwealth University of Pennsylvania",
    type: "peopleadmin",
    url: "https://commonwealthu.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&1846%5B%5D=2&435=&commit=Search",
  },
  // Was pointing at the bare homepage -- no /employment, /careers, /jobs, or
  // /hr path exists (all 404). The "Working at CCAC" page links to
  // ccacjobs.com, which redirects to this Cornerstone OnDemand (CSOD)
  // tenant's "Faculty, Counselors, Librarians, and Educational Technicians"
  // category (site=7), scoped separately from Staff/Adjunct-pool categories.
  // PA dispatcher already has a "csod" case -- reused directly. Verified
  // live (two fresh page loads): 8 real, current full-time faculty postings
  // after the shared adjunct/temp filter (Instructor - Accounting, Instructor
  // - Biology, Instructor - Nursing x3, Program Director and Instructor for
  // Medical Laboratory Technician Program, etc.).
  {
    campus: "Community College of Allegheny County",
    type: "csod",
    url: "https://ccac.csod.com/ats/careersite/search.aspx?site=7&c=ccac",
  },
  { campus: "Community College of Beaver County", type: "generic", url: "https://ccbc.edu/employment" },
  { campus: "Community College of Philadelphia", type: "generic", url: "https://www.ccp.edu/about-ccp/news-events/career-opportunities" },
  { campus: "Curtis Institute of Music", type: "generic", url: "https://www.curtis.edu/about/administration/work-at-curtis" },
  { campus: "Delaware County Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/dccc" },
  { campus: "Delaware Valley University", type: "generic", url: "https://www.delval.edu/" },
  { campus: "DeSales University", type: "generic", url: "https://www.desales.edu/about/employment" },
  { campus: "Duquesne University", type: "generic", url: "https://www.duq.edu/faculty/jobs" },
  { campus: "East Stroudsburg University of Pennsylvania", type: "csod", url: "https://esu.csod.com/ux/ats/careersite/6/home?c=esu" },
  { campus: "Elizabethtown College", type: "generic", url: "https://www.etown.edu/faculty-employment" },
  { campus: "Franklin and Marshall College", type: "generic", url: "https://www.fandm.edu/faculty/jobs" },
];

// NC (multi-platform; primarily PeopleAdmin)
const NC_CAMPUSES = [
  {
    campus: "Appalachian State University",
    type: "peopleadmin",
    url: "https://www.appstate.edu/employment",
  },
  {
    campus: "East Carolina University",
    type: "peopleadmin-dept",
    url: "https://ecu.peopleadmin.com//postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=3&435=&commit=Search",
  },
  {
    campus: "Elizabeth City State University",
    type: "peopleadmin",
    url: "https://jobs.ecsu.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&435=&225=&436=&1613%5B%5D=1&commit=Search",
  },
  {
    campus: "Fayetteville State University",
    type: "peopleadmin",
    url: "https://jobs.uncfsu.edu/postings/search?query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=3&commit=Search",
  },
  {
    campus: "North Carolina A&T State University",
    type: "peopleadmin",
    url: "https://jobs.ncat.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&2000%5B%5D=2&1827=&440=&225=&commit=Search",
  },
  {
    campus: "North Carolina Central University",
    type: "peopleadmin-dept",
    url: "https://jobs.nccu.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&1636%5B%5D=2&commit=Search",
  },
  {
    campus: "NC State University",
    type: "peopleadmin",
    url: "https://jobs.ncsu.edu/postings/search?query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=2&commit=Search",
  },
  {
    campus: "UNC Asheville",
    type: "peopleadmin",
    url: "https://jobs.unca.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&2414%5B%5D=2&commit=Search&_gl=1*1spg4dq*_gcl_au*MTU5NDAxNTk3Ny4xNzY4MTUzMzA3",
  },
  {
    campus: "UNC-Chapel Hill",
    type: "peopleadmin-dept",
    url: "https://unc.peopleadmin.com/postings/search?query=&query_v0_posted_at_date=&query_organizational_tier_2_id=any&609=&query_organizational_tier_3_id=any&526=Any&query_position_type_id=6&608=Any&commit=Search",
  },
  {
    campus: "UNC Charlotte",
    type: "peopleadmin-dept",
    url: "https://jobs.charlotte.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_organizational_tier_2_id%5B%5D=any&1976%5B%5D=1&1976%5B%5D=2&2074=&2075%5B%5D=2&commit=Search",
  },
  {
    campus: "UNC Pembroke",
    type: "peopleadmin",
    url: "https://jobs.uncp.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&863%5B%5D=2&commit=Search",
  },
  {
    campus: "UNC School of the Arts",
    type: "peopleadmin",
    url: "https://employment.uncsa.edu/postings/search?query_position_type_id=3",
  },
  {
    campus: "UNC Wilmington",
    type: "peopleadmin",
    url: "https://jobs.uncw.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&1594%5B%5D=2&742=&commit=Search",
  },
  {
    campus: "Western Carolina University",
    type: "peopleadmin-dept",
    url: "https://jobs.wcu.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&2022=2&query_organizational_tier_3_id=any&commit=Search",
  },
  {
    campus: "Winston-Salem State University",
    type: "generic",
    url: "https://www.wssu.edu/faculty/jobs",
  },
  // Major NC private research + liberal arts institutions
  {
    campus: "Duke University",
    type: "duke-search",
    url: "https://careers.duke.edu/search/",
  },
  {
    campus: "Wake Forest University",
    type: "generic",
    url: "https://hr.wfu.edu/careers/",
  },
  {
    campus: "Davidson College",
    type: "workday-search",
    url: "https://wd1.myworkdaysite.com/recruiting/davidson/davidson",
  },
  {
    campus: "Elon University",
    type: "generic",
    url: "https://www.elon.edu/u/fa/hr/working-at-elon/careers",
  },
  {
    campus: "UNC Greensboro",
    type: "peopleadmin",
    url: "https://spartantalent.uncg.edu/postings/search?query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=2&commit=Search",
  },
  { campus: "Johnson & Wales University-Charlotte", type: "generic", url: "https://www.jwu.edu/faculty/jobs" },
  { campus: "Alamance Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/alamanceccedu?jobType[0]=Full-Time%20Exempt&jobType[1]=Full-Time%20Non-Exempt&sort=PositionTitle%7CAscending" },
  { campus: "Asheville-Buncombe Technical Community College", type: "generic", url: "https://abtech.edu/employment" },
  { campus: "Barton College", type: "generic", url: "https://www.barton.edu/" },
  { campus: "Beaufort County Community College", type: "generic", url: "https://jobs.beaufortccc.edu/postings/search" },
  { campus: "Belmont Abbey College", type: "generic", url: "https://belmontabbeycollege.edu/about-us/employment/" },
  { campus: "Bennett College", type: "generic", url: "https://www.bennett.edu/faculty/jobs" },
  { campus: "Bladen Community College", type: "generic", url: "https://bladencc.edu/" },
  { campus: "Brevard College", type: "generic", url: "https://brevard.edu/employment-opportunities" },
  { campus: "Brunswick Community College", type: "generic", url: "https://www.brunswickcc.edu/" },
  { campus: "Cabarrus College of Health Sciences", type: "generic", url: "https://cabarruscollege.edu/" },
  { campus: "Caldwell Community College and Technical Institute", type: "schooljobs", url: "https://www.schooljobs.com/careers/cccti" },
  { campus: "Campbell University", type: "generic", url: "https://www.campbell.edu/employment" },
  // Was pointing at the bare homepage. Real ATS is NEOGOV/SchoolJobs
  // (schooljobs.com/careers/cfcc, linked from /human-resources/cape-fear-careers/).
  // Verified live: 132 postings, incl. real current faculty openings
  // ("Associate Degree Nursing, Level Coordinator - Full Time Faculty").
  { campus: "Cape Fear Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/cfcc/" },
  { campus: "Carolina Christian College", type: "generic", url: "https://www.carolina.edu/employment-opportunities" },
  { campus: "Carolina College of Biblical Studies", type: "generic", url: "https://ccbs.edu/employment" },
  { campus: "Carolina University", type: "generic", url: "https://carolinau.edu/employment-opportunities" },
  { campus: "Carolinas College of Health Sciences", type: "generic", url: "https://www.carolinascollege.edu/" },
  { campus: "Carteret Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/carteretcc" },
  { campus: "Catawba College", type: "generic", url: "https://www.catawba.edu/jobs" },
  { campus: "Catawba Valley Community College", type: "generic", url: "https://cvcc.edu/employment" },
  { campus: "Central Carolina Community College", type: "schooljobs", url: "https://www.governmentjobs.com/careers/ccccedu" },
  { campus: "Central Piedmont Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/cpcc" },
  { campus: "Charlotte Christian College and Theological Seminary", type: "generic", url: "https://www.charlottechristian.edu/" },
  // Was pointing at the bare homepage. Real page (about/offices/human-resources/)
  // embeds a cross-origin Paycor iframe (recruitingbypaycor.com) with real
  // current faculty postings ("Assistant Professor of Criminal Justice",
  // "Assistant Professor of Sport Science") -- confirmed live by reading the
  // iframe's own content directly (same platform/shape as Bethune-Cookman
  // University and Cairn University-Langhorne). Unlike Bethune-Cookman's
  // iframe, this one actively bounces a direct top-level navigation straight
  // back to the parent wrapper page (same behavior as Ellsworth Community
  // College's Paycor iframe, round 12) -- not even reachable by pointing the
  // URL straight at the iframe's src. Documented, not patched (would require
  // a new scraper that can read cross-origin iframe content, which no
  // dispatch path here does) -- still a real improvement over the bare
  // homepage even though the postings aren't extracted yet.
  { campus: "Chowan University", type: "generic", url: "https://www.chowan.edu/about/offices/human-resources" },
  { campus: "Cleveland Community College", type: "generic", url: "https://www.clevelandcc.edu/" },
  { campus: "Coastal Carolina Community College", type: "generic", url: "https://coastalcarolina.edu/about/employment-opportunities" },
  { campus: "College of the Albemarle", type: "schooljobs", url: "https://www.governmentjobs.com/careers/albemarleedu" },
  { campus: "Craven Community College", type: "generic", url: "https://cravencc.edu/employment" },
  { campus: "Davidson-Davie Community College", type: "generic", url: "https://www.davidsondavie.edu/mission-vision-values/employment" },
  { campus: "Durham Technical Community College", type: "generic", url: "https://www.durhamtech.edu/" },
  { campus: "Edgecombe Community College", type: "generic", url: "https://www.schooljobs.com/careers/edgecombeedu" },
  { campus: "Fayetteville Technical Community College", type: "generic", url: "https://faytechcc.peopleadmin.com/" },
  { campus: "Forsyth Technical Community College", type: "generic", url: "https://www.forsythtech.edu/" },
];

// VA (Virginia) - major public research + private research/liberal arts
const VA_CAMPUSES = [
  {
    campus: "University of Virginia",
    type: "workday-search",
    url: "https://uva.wd1.myworkdayjobs.com/UVAJobs",
  },
  {
    campus: "Virginia Tech",
    type: "vt-search",
    url: "https://jobs.apply.vt.edu/jobs/search/search-page-faculty",
  },
  {
    campus: "William & Mary",
    type: "peopleadmin",
    url: "https://jobs.wm.edu/postings/search?query=&query_v0_posted_at_date=&query_position_type_id=8&commit=Search",
  },
  {
    campus: "George Mason University",
    type: "generic",
    url: "https://jobs.gmu.edu/",
  },
  {
    campus: "Virginia Commonwealth University",
    // Old CSOD tenant confirmed dead (its own API reports totalCount: 0, and
    // the page banners "transitioning to a new application system"). VCU
    // migrated to PageUp on a custom domain, same platform as Toledo.
    type: "pageup",
    url: "https://vcujobs.com/jobs/search",
  },
  {
    campus: "Old Dominion University",
    // Unfiltered default view returns Staff/Admin postings only. Unlike NAU/CSU/
    // EMU (stale filter to remove), this one needs a filter ADDED — id 1 is
    // "Teaching and Research Faculty" on the site's own dropdown, confirmed live
    // to return 28+ real faculty postings.
    type: "generic",
    url: "https://jobs.odu.edu/postings/search?query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "James Madison University",
    // joblink.jmu.edu (PeopleAdmin) is fully decommissioned — JMU migrated to
    // PageUp. New URL/type confirmed live with categorized postings including
    // Instructional Faculty.
    type: "pageup",
    url: "https://jobs.jmu.edu/jobs/search",
  },
  {
    campus: "University of Richmond",
    type: "workday",
    url: "https://richmond.wd5.myworkdayjobs.com/staff_faculty",
  },
  {
    campus: "Washington and Lee University",
    type: "generic",
    url: "https://www.wlu.edu/employment-opportunities/faculty-positions",
  },
  {
    campus: "Hollins University",
    type: "generic",
    url: "https://www.hollins.edu/about/human-resources/employment-opportunities/",
  },
  { campus: "Centra College", type: "generic", url: "https://www.centrahealth.com/college" },
  { campus: "Riverside College of Health Careers", type: "generic", url: "https://www.riversideonline.com/careers/college-of-health-careers" },
  { campus: "Agora University", type: "generic", url: "https://www.agora.edu/" },
  { campus: "Appalachian College of Pharmacy", type: "generic", url: "https://www.acp.edu/employment" },
  { campus: "Appalachian School of Law", type: "generic", url: "https://www.asl.edu/faculty-2/hiring" },
  { campus: "Ascent College", type: "generic", url: "https://ascent.edu/faculty/jobs" },
  { campus: "Averett University", type: "generic", url: "https://www.averett.edu/about-us/employment-opportunities/traditional-faculty-employment-opportunities" },
  // Was pointing at the college's own employment page, which just links out
  // to the VCCS system-wide job portal (no anchors of its own). Real ATS is
  // PeopleAdmin (jobs.vccs.edu), same platform already used for Central
  // Virginia Community College above, scoped here to Blue Ridge via
  // query_organizational_tier_1_id[]=3687. Verified live (two fresh page
  // loads): 56 postings, incl. real current faculty opening ("Aviation
  // Maintenance Technology FT Teaching Faculty").
  {
    campus: "Blue Ridge Community College",
    type: "peopleadmin",
    url: "https://jobs.vccs.edu/postings/search?query=&query_organizational_tier_1_id%5B%5D=3687&commit=Search",
  },
  { campus: "Bluefield University", type: "generic", url: "https://www.bluefield.edu/employment" },
  // Was pointing at the bare homepage. Real page is /employment-opportunities,
  // which lists openings specifically for BSMCON (vs. its two sister Bon
  // Secours institutions on the same page). Verified live: currently only
  // "Director, Financial Aid" is posted for BSMCON (not faculty) -- real
  // per-institution openings would show here when they exist. The page also
  // links to "Careers at Bon Secours" for system-wide Bon Secours health
  // system openings -- deliberately NOT wired, same misattribution-risk shape
  // as Capital Health School of Radiologic Technology (round 9): that board
  // covers the whole hospital system, not just this college.
  { campus: "Bon Secours Memorial College of Nursing", type: "generic", url: "https://www.bsmcon.edu/employment-opportunities" },
  // Was pointing at the bare homepage. Real page is /employment-opportunities,
  // same shared shape as sister institution Bon Secours Memorial College of
  // Nursing (round 5): lists real per-institution openings when they exist,
  // currently "SOMI does not have any current employment opportunities at
  // this time" (genuinely 0). The page also links to "Careers at Bon
  // Secours" for system-wide Bon Secours health-system openings --
  // deliberately NOT wired, same misattribution-risk shape as BSMCON.
  { campus: "Bon Secours St Mary's Hospital School of Medical Imaging", type: "generic", url: "https://www.smhsomi.edu/employment-opportunities" },
  { campus: "Bridgewater College", type: "generic", url: "https://www.bridgewater.edu/careers" },
  // Was pointing at Brightpoint's own employment page, which itself hands off
  // to the VCCS-wide (all 23 Virginia community colleges) PeopleAdmin board
  // in prose only ("only accepts online applications submitted through VCCS
  // Careers"). That board supports a "College" organizational-tier facet
  // (query_organizational_tier_1_id[]=7889 = Brightpoint specifically) plus a
  // Faculty position-type facet (query_position_type_id[]=9) -- real,
  // institution-specific scoping, not a blind system-wide handoff. VA
  // dispatcher already has a "peopleadmin" case -- reused directly. Verified
  // live (two fresh page loads): 2 postings scoped to "College - Brightpoint
  // Community College" (Nursing 9-month Faculty (F0069), Vice President of
  // Finance and Administration).
  {
    campus: "Brightpoint Community College",
    type: "peopleadmin",
    url: "https://jobs.vccs.edu/postings/search?query_organizational_tier_1_id%5B%5D=7889&query_position_type_id%5B%5D=9&commit=Search",
  },
  // Same shared UltiPro/UKG board as sibling Bryant & Stratton campuses
  // (Parma round 12, Wauwatosa round 12) -- "?q=virginia+beach" scopes to
  // this campus (10 results, e.g. "Academic Advisor" in Hampton, VA, the
  // Hampton Roads/Virginia Beach area). Same card-based-SPA-no-anchor
  // limitation as the sibling campuses -- URL updated for correctness, not
  // a working scraper fix.
  { campus: "Bryant & Stratton College-Virginia Beach", type: "generic", url: "https://recruiting.ultipro.com/BRY1002BSC/JobBoard/6b838b9a-cd2b-436a-903b-0de7b6e17b4f/?q=virginia+beach&o=postedDateDesc" },
  {
    campus: "Central Virginia Community College",
    type: "peopleadmin",
    url: "https://jobs.vccs.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=9&435=&1577%5B%5D=1&commit=Search",
  },
  { campus: "Christopher Newport University", type: "generic", url: "https://jobs.cnu.edu/" },
  { campus: "Danville Community College", type: "generic", url: "https://jobs.vccs.edu/postings/search?query=&query_organizational_tier_2_id%5B%5D=3690&commit=Search" },
  { campus: "Divine Mercy University", type: "generic", url: "https://www.divinemercy.edu/" },
  { campus: "Eastern Mennonite University", type: "generic", url: "https://www.paycomonline.net/v4/ats/web.php/portal/864CD5F3AB350C8D2A97891D7F3F4860/career-page" },
  // The employment-opportunities page itself lists real openings (including
  // "Nursing Clinical Instructor"), but every job's own <a href> is a
  // generic "Details and application information" CTA that the shared
  // scraper's card-rescue can't match to the real heading (the CTA-rescue
  // regex doesn't cover this exact phrase) -- the real title never gets
  // extracted from that wrapper page. Its own "VCCS Jobs Site" link hands
  // off to this institution-specific PeopleAdmin tier-2 org facet (id 3691),
  // where the real title lives directly in the anchor text instead. VA
  // dispatcher already has a "peopleadmin" case -- reused directly.
  // Verified live (two fresh page loads): 2 postings, 1 real faculty
  // posting ("Nursing Clinical Instructor").
  {
    campus: "Eastern Shore Community College",
    type: "peopleadmin",
    url: "https://jobs.vccs.edu/postings/search?query=&query_organizational_tier_2_id%5B%5D=3691&commit=Search",
  },
  { campus: "Eastern Virginia Medical School", type: "generic", url: "https://www.evms.edu/" },
  { campus: "Edward Via College of Osteopathic Medicine", type: "generic", url: "https://www.vcom.edu/employment/job-listings" },
  { campus: "Emory & Henry University", type: "generic", url: "https://www.emoryhenry.edu/human-resources/employment-opportunities/" },
  { campus: "Ferrum College", type: "generic", url: "https://ferrumcollege.applytojob.com/apply" },
];

// SC (South Carolina) - major public research + private liberal arts
const SC_CAMPUSES = [
  {
    campus: "University of South Carolina",
    type: "peopleadmin",
    url: "https://uscjobs.sc.edu/postings/search?query=&query_v0_posted_at_date=&query_position_type_id=2&commit=Search",
  },
  {
    campus: "Clemson University",
    type: "generic",
    url: "https://www.clemson.edu/human-resources/index.html",
  },
  {
    campus: "College of Charleston",
    type: "peopleadmin",
    url: "https://jobs.cofc.edu/postings/search?query=&query_v0_posted_at_date=&query_position_type_id=2&commit=Search",
  },
  {
    campus: "Coastal Carolina University",
    // query_position_type_id=2 is "FTE Staff" on this site's own <select>; id 3
    // is Faculty. Same stale/wrong-filter bug class as NAU/CSU/EMU/Auburn.
    type: "peopleadmin",
    url: "https://jobs.coastal.edu/postings/search?query=&query_v0_posted_at_date=&query_position_type_id=3&commit=Search",
  },
  {
    campus: "Winthrop University",
    type: "peopleadmin",
    url: "https://winthrop.peopleadmin.com/postings/search?query=&query_v0_posted_at_date=&query_position_type_id=3&commit=Search",
  },
  {
    campus: "The Citadel",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/citadel?keywords=faculty",
  },
  {
    campus: "Furman University",
    type: "workday",
    url: "https://furman.wd5.myworkdayjobs.com/Furman_Careers",
  },
  {
    campus: "Wofford College",
    type: "workday",
    url: "https://wofford.wd5.myworkdayjobs.com/Wofford",
  },
  {
    campus: "Presbyterian College",
    type: "generic",
    url: "https://www.presby.edu/about/offices-and-services/human-resources/employment",
  },
  { campus: "University of South Carolina-Lancaster", type: "generic", url: "https://www.sc.edu/faculty-employment" },
  { campus: "University of South Carolina-Salkehatchie", type: "generic", url: "https://sc.edu/faculty-employment" },
  // Was a dead 404. Real applicant system is uscjobs.sc.edu (PeopleAdmin),
  // filterable by campus via query_organizational_tier_1_id.
  { campus: "University of South Carolina-Sumter", type: "peopleadmin", url: "https://uscjobs.sc.edu/postings/search?query_organizational_tier_1_id%5B%5D=1313" },
  { campus: "University of South Carolina-Union", type: "peopleadmin", url: "https://uscjobs.sc.edu/postings/search?query_organizational_tier_1_id%5B%5D=1314" },
  { campus: "Aiken Technical College", type: "generic", url: "https://www.atc.edu/" },
  { campus: "Allen University", type: "generic", url: "https://allenuniversity.edu/au-employment" },
  { campus: "American College of the Building Arts", type: "generic", url: "https://acba.edu/career-opportunities" },
  { campus: "Anderson University", type: "generic", url: "https://www.andersonuniversity.edu/" },
  { campus: "Benedict College", type: "generic", url: "https://www.benedict.edu/" },
  { campus: "Bob Jones University", type: "generic", url: "https://bju.careers/bju-faculty" },
  // Was pinned to one specific job posting instead of the board itself.
  { campus: "Central Carolina Technical College", type: "schooljobs", url: "https://www.schooljobs.com/careers/cctech" },
  // "generic" is correct here, not a type mismatch — scrapeGenericJobPage's
  // internal scrapePaycomApi() probe auto-detects and handles Paycom URLs
  // before falling back to DOM scraping. scrapeScAll's own dispatcher (unlike
  // some others) has no "paycom" case at all, so setting type: "paycom" here
  // would silently return [] instead of using that working auto-detection.
  { campus: "Charleston Southern University", type: "generic", url: "https://www.paycomonline.net/v4/ats/web.php/jobs?clientkey=9B25CFBC4D1E53FBF3D00067C7C0E531" },
  { campus: "Citadel Military College of South Carolina", type: "generic", url: "https://citadel.edu/" },
  { campus: "Claflin University", type: "generic", url: "https://www.claflin.edu/" },
  { campus: "Clinton College", type: "generic", url: "https://www.clintoncollege.edu/about/employment" },
  // The faculty-jobs page's only real link is "Current Openings" -> an isolvedhire
  // ATS host not in ATS_HANDOFF_PATTERNS — point directly at it instead.
  { campus: "Coker University", type: "generic", url: "https://coker.isolvedhire.com/iframe/mobile/" },
  { campus: "Columbia International University", type: "generic", url: "https://ciu.edu/about/employment" },
  // Configured URL (/careers/faculty) is actually a WordPress "Faculty"
  // blog/news archive, not a jobs page. Real ATS is an institution-specific
  // isolvedhire.com tenant, linked from the homepage as "Employment
  // Opportunities". Verified live (two fresh page loads): real faculty
  // postings (Adjunct Instructor in Interior Design, Adjunct Instructor of
  // 3D/Sculpture, Adjunct Instructor of Statistics, Assistant Professor of
  // Accounting).
  { campus: "Converse University", type: "generic", url: "https://converse.isolvedhire.com/jobs" },
  { campus: "Denmark Technical College", type: "generic", url: "https://www.denmarktech.edu/" },
  { campus: "Erskine College", type: "generic", url: "https://www.erskine.edu/" },
  // Was pointing at the bare homepage. The "Careers & Staff Directory" page's
  // "Search Our Current Job Openings" accordion reveals a link to this
  // institution-specific schooljobs.com (NEOGOV) board. SC dispatcher
  // already has a "schooljobs" case -- reused directly. Verified live (two
  // fresh page loads): 59 real postings, including "Adjunct Automotive
  // Instructor" and "Adjunct Biology Instructor".
  {
    campus: "Florence-Darlington Technical College",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/fdtc",
  },
  { campus: "Francis Marion University", type: "generic", url: "https://www.fmarion.edu/" },
];




// DE (Delaware)
const DE_CAMPUSES = [
  {
    campus: "Delaware State University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/desu",
  },
  {
    campus: "University of Delaware",
    type: "enusfilter",
    url: "https://careers.udel.edu/cw/en-us/filter/?job-mail-subscribe-privacy=agree&search-keyword=&work-type=faculty",
  },
  {
    campus: "Delaware Technical Community College",
    type: "peopleadmin",
    url: "https://dtcc.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&715%5B%5D=1&commit=Search",
  },
  {
    campus: "Wilmington University",
    type: "taleo",
    url: "https://phh.tbe.taleo.net/phh02/ats/careers/v2/searchResults?org=WILMU&cws=51",
  },
  { campus: "Delaware Technical Community College-Central Office", type: "generic", url: "https://www.dtcc.edu/about/employment" },
  {
    campus: "Delaware Technical Community College-Terry",
    type: "peopleadmin",
    url: "https://dtcc.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&709%5B%5D=5&commit=Search",
  },
];

// MD (Maryland) - major research universities + liberal arts colleges
const MD_CAMPUSES = [
  {
    campus: "University of Maryland, Baltimore",
    type: "taleo",
    url: "https://umb.taleo.net/careersection/umb_faculty+and+post+docs/jobsearch.ftl?lang=en&portal=8100108441",
  },
  {
    campus: "University of Maryland, Baltimore County",
    type: "pageup",
    url: "https://facultyjobs.umbc.edu/en-us/listing/",
  },
  {
    campus: "University of Maryland, College Park",
    type: "workday",
    url: "https://umd.wd1.myworkdayjobs.com/UMCP",
  },
  {
    campus: "Johns Hopkins University",
    type: "generic",
    url: "https://jobs.jhu.edu/search-jobs?acm=ALL",
  },
  {
    campus: "Morgan State University",
    type: "peopleadmin",
    url: "https://morgan.peopleadmin.com/postings/search",
  },
  {
    campus: "Towson University",
    type: "taleo",
    url: "https://towson.taleo.net/careersection/ex/jobsearch.ftl",
  },
  {
    campus: "St. Mary's College of Maryland",
    type: "generic",
    url: "https://www.smcm.edu/hr/",
  },
  {
    campus: "Goucher College",
    type: "interviewexchange",
    url: "https://goucher.interviewexchange.com/static/clients/436GCM1/index.jsp",
  },
  { campus: "Garrett College", type: "generic", url: "https://www.garrettcollege.edu/employment.php" },
  { campus: "Allegany College of Maryland", type: "schooljobs", url: "https://www.schooljobs.com/careers/allegany" },
  { campus: "Anne Arundel Community College", type: "generic", url: "https://www.aacc.edu/employment" },
  { campus: "Bais HaMedrash and Mesivta of Baltimore", type: "generic", url: "https://www.bhmb.edu/" },
  { campus: "Baltimore City Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/bccc/fulltimefaculty" },
  { campus: "Bowie State University", type: "generic", url: "https://www.bowiestate.edu/" },
  // URL was already correct (a real ADP Workforce Now tenant), but type was
  // "generic" -- the generic HTML-anchor scraper can't read ADP's JS-heavy
  // widget (confirmed live: page renders empty body text even after a wait),
  // so this silently returned 0 despite a healthy-looking URL. Fixed to
  // "adp" so it goes through the existing direct job-requisitions API
  // instead. Verified live via that API: 2 current postings, incl.
  // "Administrative Faculty".
  { campus: "Capitol Technology University", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=199260cf-4b15-410c-9970-1d94a408c2d5&ccId=19000101_000001&type=MP&lang=en_US" },
  { campus: "Carroll Community College", type: "generic", url: "https://www.carrollcc.edu/about/jobs" },
  // The employment page itself embeds a JobScore widget in a cross-origin
  // <iframe> (widgets.jobscore.com) that generic scraping of the parent
  // page can never read. Unlike the Paycor iframe cases (Chowan University,
  // Crowley's Ridge College, round 13) that actively bounce a direct
  // top-level navigation back to the parent, this JobScore widget URL loads
  // fine on its own with real per-job <a href> anchors -- pointed directly
  // at the iframe's own src instead of the wrapper page. Verified live (two
  // fresh page loads): real current adjunct faculty postings (Adjunct
  // Faculty, Anatomy & Physiology; Equine Studies; Landscape Design;
  // Nursing Clinical; Physical Science with Lab; Adjunct Instructor,
  // Mathematics/Paramedic-EMT/Physics; Nursing Clinical Lab Instructor).
  {
    campus: "Cecil College",
    type: "generic",
    url: "https://widgets.jobscore.com/jobs/cecilcollege/widget_iframe?font_family=Open%20Sans&font_size=16px&link_text_color=%23006838&group_by=department&show_social_sharing=bottom&parent_url=https%3A%2F%2Fwww.cecil.edu%2Fabout-us%2Femployment&widget_id=js_widget_iframe_1",
  },
  { campus: "Chesapeake College", type: "schooljobs", url: "https://www.schooljobs.com/careers/chesapeakecollege" },
  { campus: "College of Southern Maryland", type: "generic", url: "https://www.csmd.edu/employment" },
  { campus: "Community College of Baltimore County", type: "generic", url: "https://www.ccbcmd.edu/jobs" },
  { campus: "Coppin State University", type: "generic", url: "https://www.coppin.edu/" },
  { campus: "Frederick Community College", type: "generic", url: "https://jobs.frederick.edu/" },
  { campus: "Frostburg State University", type: "generic", url: "https://www.frostburg.edu/human-resources/Careers-at-FSU/Careers-at-FSU.php" },
];



// RI (Rhode Island)
const RI_CAMPUSES = [
  {
    campus: "Rhode Island College",
    type: "peopleadmin",
    url: "https://employment.ric.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=3&435=&commit=Search",
  },
  {
    campus: "University of Rhode Island",
    type: "peopleadmin-dept",
    url: "https://jobs.uri.edu/postings/search?&query=&query_v0_posted_at_date=&query_organizational_tier_3_id=any&803=&query_position_type_id=8&commit=Search",
  },
];

const RI_PRIVATE_CAMPUSES = [
  {
    campus: "Brown University",
    type: "generic",
    url: "https://www.brown.edu/careers",
  },
  {
    campus: "Providence College",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/providencecollege/faculty",
  },
  {
    campus: "Bryant University",
    type: "generic",
    url: "https://employment.bryant.edu/postings/search",
  },
  {
    campus: "Rhode Island School of Design",
    type: "peopleadmin",
    url: "https://careers.risd.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id=3&435=&query_organizational_tier_3_id=any&commit=Search",
  },
  {
    campus: "Salve Regina University",
    type: "interviewexchange",
    url: "https://salve.interviewexchange.com/static/clients/288SRM1/faculty.jsp",
  },
  { campus: "Johnson & Wales University-Providence", type: "generic", url: "https://www.jwu.edu/faculty/jobs" },
  { campus: "College Unbound", type: "generic", url: "https://collegeunbound.edu/connect/careers" },
  { campus: "Community College of Rhode Island", type: "generic", url: "https://www.ccri.edu/" },
];

// NH (New Hampshire)
const NH_CAMPUSES = [
  {
    campus: "University of New Hampshire System",
    // UNH and other USNH campuses surface jobs at jobs.usnh.edu
    type: "workday",
    url: "https://usnh.wd5.myworkdayjobs.com/Careers?timeType=1550a879b33f10037951f18fd1800000&workerSubType=b4f41dd8de101000c45c0d3fc2a10001",
  },
  {
    campus: "Dartmouth College",
    type: "peopleadmin",
    url: "https://searchjobs.dartmouth.edu/postings/search",
  },
  {
    campus: "Saint Anselm College",
    // URL is already a raw Workday tenant — a pure JS SPA shell with 0 static
    // anchors "generic" can't read.
    type: "workday",
    url: "https://anselm.wd1.myworkdayjobs.com/Anselm",
  },
  {
    campus: "Franklin Pierce University",
    type: "generic",
    url: "https://franklinpierceuniversity.applytojob.com/apply",
  },
  {
    campus: "Rivier University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/rivieredu",
  },
  {
    campus: "New England College",
    type: "peopleadmin",
    url: "https://nec.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&435=&query_position_type_id%5B%5D=6&query_position_type_id%5B%5D=7&1455=&commit=Search",
  },
  {
    campus: "Southern New Hampshire University",
    type: "generic",
    url: "https://jobs.snhu.edu/en/jobs/",
  },
];



// AZ (Arizona)
const AZ_CAMPUSES = [
  {
    campus: "Arizona State University",
    type: "asu-table",
    url: "https://facultypositions.asu.edu/",
  },
  {
    campus: "Northern Arizona University",
    type: "nau-search",
    // Was scoped to a single category_uids filter that's now empty (site's category
    // taxonomy shifted) — real faculty postings (e.g. Clinical Professor roles) live
    // under other categories like "Health Services" and were invisible to this feed.
    // Search unfiltered instead; scrapeNauSearch has no internal faculty check, so
    // this relies on the downstream global looksFacultyish filter, same as every
    // other wide-net "generic" feed. Re-verified 2026-08-07: already correctly
    // wired and dispatched (scrapeAzAll has a "nau-search" case); institutions-
    // master.json's "generic"/"missing" labels for this record are simply
    // stale from before that earlier fix. Live check found only 5 total open
    // reqs system-wide right now, none faculty-titled -- genuinely 0 current
    // faculty openings, not a bug.
    url: "https://careers.nau.edu/jobs/search?page=1&query=",
  },
  {
    campus: "University of Arizona",
    type: "csod",
    url: "https://arizona.csod.com/ux/ats/careersite/4/home?c=arizona&cfdd[0][id]=228&cfdd[0][options][0]=288&cfdd[1][id]=161&cfdd[1][options][0]=118&country=us",
  },
  {
    campus: "Prescott College",
    type: "generic",
    url: "https://info.prescott.edu/job-openings/",
  },
  // Was pointing at the bare Surprise-campus homepage (no employment info at
  // all). Real careers page (ottawa.edu/careers) links to a single
  // university-wide Paycom tenant covering every Ottawa University campus
  // (Ottawa KS, Surprise AZ, Overland Park KS, Brookfield WI, online) --
  // scoped to just this campus via scrapePaycomAs's locationFilter param so
  // the whole system's job count isn't misattributed to Surprise alone.
  // Verified live: 58 total postings system-wide, including one specific to
  // this campus ("Adjunct Instructor - Adult Professional & Graduate
  // Studies - Surprise Arizona").
  {
    campus: "Ottawa University-Surprise",
    type: "paycom",
    url: "https://www.ottawa.edu/faculty/jobs",
    locationFilter: "Surprise",
  },
  // Was pointing at an adult-student program page, not employment. Real ATS
  // is Frontline/AppliTrack (no dedicated scraper type exists for it).
  { campus: "Western Maricopa Education Center", type: "generic", url: "https://www.applitrack.com/westmec/onlineapp/" },
  { campus: "Arizona Board of Regents", type: "generic", url: "https://www.azregents.edu/" },
  { campus: "Arizona Christian University", type: "generic", url: "https://azcu.edu/careers#section-academic" },
  { campus: "Arizona State University Campus Immersion", type: "generic", url: "https://www.asu.edu/" },
  { campus: "Arizona State University Digital Immersion", type: "generic", url: "https://www.asu.edu/" },
  { campus: "Arizona Western College", type: "generic", url: "https://www.azwestern.edu/" },
  // The configured URL is an HR qualifications/policy page with no job links at
  // all — the real board is a schooljobs.com (NEOGOV) tenant.
  { campus: "Central Arizona College", type: "generic", url: "https://www.schooljobs.com/careers/centralaz" },
  { campus: "Chandler-Gilbert Community College", type: "generic", url: "https://www.cgc.maricopa.edu/" },
  // schooljobs.com is a client-rendered SPA; "generic" only reads anchors once on
  // page 1 without the platform's own pagination — "schooljobs" already exists
  // and handles both.
  { campus: "Cochise County Community College District", type: "schooljobs", url: "https://www.schooljobs.com/careers/cochisecollege" },
  { campus: "Coconino Community College", type: "generic", url: "https://www.coconino.edu/jobs" },
  { campus: "Community Christian College", type: "generic", url: "https://www.cccollege.edu/" },
  { campus: "Dine College", type: "generic", url: "https://dinecollege.isolvedhire.com/jobs" },
  { campus: "Eastern Arizona College", type: "generic", url: "https://eac.edu/careers/open-positions" },
  { campus: "Embry-Riddle Aeronautical University-Prescott", type: "generic", url: "https://prescott.erau.edu/" },
  { campus: "Estrella Mountain Community College", type: "generic", url: "https://www.estrellamountain.edu/" },
];


// NY (State University of New York – SUNY) - Main page + individual campus scrapers
const NY_SUNY_MAIN = {
  campus: "SUNY System",
  url: "https://www.suny.edu/careers/employment/index.cfm?s=y",
};

// campus names below are IPEDS's exact INSTNM for each institution (no "(SUNY)"
// suffix) — see the note on normalizeCollegeName's knownNames for why an
// unmatched name here creates a duplicate, unitid-less identity that silently
// steals the real institution's job count and leaves it looking "missing".
const NY_SUNY_CAMPUSES = [
  {
    campus: "Stony Brook University",
    type: "interfolio-inst",
    url: "https://apply.interfolio.com/15355/positions",
  },
  {
    campus: "University at Buffalo",
    type: "peopleadmin",
    url: "https://www.ubjobs.buffalo.edu/postings/search?query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "University at Albany",
    type: "interfolio",
    url: "https://apply.interfolio.com/search",
  },
  {
    campus: "Binghamton University",
    type: "interfolio",
    url: "https://apply.interfolio.com/search",
  },
  { campus: "Binghamton University", type: "interfolio", url: "https://apply.interfolio.com/search#q=&institution_name=Binghamton%20University&position_type=Faculty" },
  { campus: "University at Albany", type: "interfolio", url: "https://apply.interfolio.com/search#q=&institution_name=University%20at%20Albany&position_type=Faculty" },
  // Previously only reachable via the SUNY-system landing page's own link text
  // ("Faculty Vacancy Announcements"), which is a category tile pointing at
  // this exact board, not a real posting — scrapeInterviewExchangeAs already
  // fans out into an interviewexchange site's category links when the landing
  // page itself has no real postings inline, which is exactly this site's shape.
  {
    campus: "SUNY Empire State College",
    type: "interviewexchange",
    url: "https://esc.interviewexchange.com/static/clients/397ESM1/index.jsp?catid=802",
  },
];

const SUNY_CAMPUS_HINTS = [
  { campus: "University at Albany", patterns: [/albany/i, /albany\.edu/i] },
  { campus: "Binghamton University", patterns: [/binghamton/i, /binghamton\.edu/i] },
  { campus: "University at Buffalo", patterns: [/\bbuffalo\b/i, /buffalo\.edu/i] },
  { campus: "Stony Brook University", patterns: [/stony\s*brook/i, /stonybrook\.edu/i] },
  { campus: "SUNY Buffalo State University", patterns: [/buffalo\s*state/i, /buffalostate\.edu/i] },
  { campus: "SUNY Cobleskill", patterns: [/cobleskill/i] },
  { campus: "SUNY Alfred State College", patterns: [/alfred\s*state/i, /alfredstate/i] },
  { campus: "SUNY Genesee Community College", patterns: [/genesee/i, /genesee\.interviewexchange/i] },
  { campus: "SUNY Niagara", patterns: [/niagara\s*cc|niagaracc/i] },
  { campus: "SUNY Old Westbury", patterns: [/old\s*westbury|oldwestbury/i] },
  { campus: "SUNY Broome Community College", patterns: [/suny\s*broome|sunybroome/i] },
  { campus: "SUNY Maritime College", patterns: [/maritime/i] },
  { campus: "SUNY Morrisville", patterns: [/morrisville/i] },
  { campus: "SUNY Polytechnic Institute", patterns: [/suny\s*poly|sunypoly|polytechnic/i] },
  { campus: "SUNY Polytechnic Institute", patterns: [/sunyit\.edu/i] },
  { campus: "SUNY College of Optometry", patterns: [/sunyopt/i, /optometry/i] },
  { campus: "SUNY Jamestown Community College", patterns: [/sunyjcc/i, /jamestown/i] },
  { campus: "SUNY Finger Lakes Community College", patterns: [/\bflcc\b/, /finger\s*lakes/i] },
  { campus: "SUNY Onondaga Community College", patterns: [/\bsuny\s*occ\b/i, /onondaga\s+community\s+college/i, /sunyocc\.interviewexchange\.com/i] },
  { campus: "SUNY Empire State College", patterns: [/\bsuny\s*esc\b/i, /empire\s*state\s*college/i, /esc\.interviewexchange\.com/i] },
  { campus: "SUNY Orange County Community College", patterns: [/\boccc\b/i, /orange\s+county\s+community\s+college/i] },
  { campus: "SUNY Westchester Community College", patterns: [/sunywcc/i, /westchester\s+community\s+college/i] },
  { campus: "SUNY Erie Community College", patterns: [/ecc\.wd\d+\.myworkdayjobs\.com/i, /erie\s+community\s+college/i] },
  { campus: "SUNY Canton", patterns: [/canton/i, /employment\.canton\.edu/i] },
  { campus: "SUNY Ulster", patterns: [/suny\s*ulster|sunyulster/i] },
  { campus: "SUNY Jefferson Community College", patterns: [/suny\s*jefferson|sunyjefferson/i] },
  { campus: "SUNY Schenectady County Community College", patterns: [/\bsccc\b/] },
  { campus: "SUNY Downstate Health Sciences University", patterns: [/careers\.pageuppeople\.com\/977/i, /downstate/i] },
  { campus: "SUNY New Paltz", patterns: [/new\s*paltz/i, /newpaltz\.edu/i] },
  { campus: "SUNY Oswego", patterns: [/\boswego\b/i, /oswego\.edu/i] },
  { campus: "SUNY Geneseo", patterns: [/\bgeneseo\b/i, /geneseo\.edu/i] },
  { campus: "SUNY Cortland", patterns: [/\bcortland\b/i, /cortland\.edu/i] },
  { campus: "SUNY Potsdam", patterns: [/\bpotsdam\b/i, /potsdam\.edu/i] },
  { campus: "SUNY Purchase", patterns: [/\bpurchase\b/i, /purchase\.edu/i] },
  { campus: "SUNY Oneonta", patterns: [/\boneonta\b/i, /oneonta\.edu/i] },
  { campus: "SUNY Plattsburgh", patterns: [/\bplattsburgh\b/i, /plattsburgh\.edu/i] },
  { campus: "SUNY Fredonia", patterns: [/\bfredonia\b/i, /fredonia\.edu/i] },
  { campus: "SUNY Brockport", patterns: [/\bbrockport\b/i, /brockport\.edu/i] },
  { campus: "SUNY Polytechnic Institute", patterns: [/polytechnic/i, /sunypoly\.edu/i] },
  { campus: "SUNY Downstate Health Sciences University", patterns: [/downstate/i, /downstate\.edu/i] },
  { campus: "SUNY Upstate Medical University", patterns: [/upstate/i, /upstate\.edu/i] },
  { campus: "SUNY College of Environmental Science and Forestry", patterns: [/\besf\b/i, /esf\.edu/i] },
];

function titleCaseWords(s) {
  return clean(s)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function inferSunyCampusFromText(title, url) {
  const txt = `${title || ""} ${url || ""}`;
  for (const hint of SUNY_CAMPUS_HINTS) {
    if (hint.patterns.some((rx) => rx.test(txt))) return hint.campus;
  }

  // Host-based mapping for SUNY feeds where title text omits campus.
  try {
    const host = new URL(url || "").hostname.toLowerCase();
    const hostMap = {
      "www.ubjobs.buffalo.edu": "University at Buffalo",
      "ubjobs.buffalo.edu": "University at Buffalo",
      "careers.upstate.edu": "SUNY Upstate Medical University",
      "jobs.buffalostate.edu": "SUNY Buffalo State University",
      "jobs.cortland.edu": "SUNY Cortland",
      "jobs.newpaltz.edu": "SUNY New Paltz",
      "jobs.geneseo.edu": "SUNY Geneseo",
      "niagaracc-suny.peopleadmin.com": "SUNY Niagara",
      "fitnyc.interviewexchange.com": "SUNY Fashion Institute of Technology",
      "farmingdale.interviewexchange.com": "Farmingdale State College",
      "morrisville.interviewexchange.com": "SUNY Morrisville",
      "sunypoly.interviewexchange.com": "SUNY Polytechnic Institute",
      "sunydutchess.interviewexchange.com": "SUNY Dutchess Community College",
      "sccc.interviewexchange.com": "SUNY Schenectady County Community College",
      "oneonta.interviewexchange.com": "SUNY Oneonta",
      "oswego.interviewexchange.com": "SUNY Oswego",
      "binghamton.interviewexchange.com": "Binghamton University",
      "albany.interviewexchange.com": "University at Albany",
      "sunywcc.interviewexchange.com": "SUNY Westchester Community College",
      "occc.interviewexchange.com": "SUNY Orange County Community College",
      "esc.interviewexchange.com": "SUNY Empire State College",
      "sunyocc.interviewexchange.com": "SUNY Onondaga Community College",
    };
    if (hostMap[host]) return hostMap[host];
  } catch {}

  // Generic SUNY host fallbacks for system-wide aggregated feeds.
  try {
    const host = new URL(url || "").hostname.toLowerCase();
    const interfolio = host.match(/^([a-z0-9-]+)\.interviewexchange\.com$/i);
    if (interfolio && interfolio[1]) {
      const raw = interfolio[1].replace(/[-_]+/g, " ").trim();
      if (raw && raw !== "www") return `SUNY ${titleCaseWords(raw.replace(/^suny\s*/i, ""))}`;
    }
    const applytojob = host.match(/^([a-z0-9-]+)\.applytojob\.com$/i);
    if (applytojob && applytojob[1]) {
      const raw = applytojob[1].replace(/[-_]+/g, " ").trim();
      if (raw && raw !== "www") return `SUNY ${titleCaseWords(raw.replace(/^suny\s*/i, ""))}`;
    }
  } catch {}

  return "SUNY System";
}

// NY Private Universities
const NY_PRIVATE_CAMPUSES = [
  // Top 20 largest private universities in New York State
  {
    campus: "New York University",
    type: "generic",
    url: "https://www.nyu.edu/faculty/jobs?challenge=d06e90d7-4d8f-4b88-9d8c-10b73beb60f1",
  },
  {
    campus: "Columbia University",
    type: "interfolio-inst",
    url: "https://apply.interfolio.com/10774/positions",
  },
  {
    campus: "Cornell University",
    type: "workday",
    url: "https://cornell.wd1.myworkdayjobs.com/CornellPositions?jobFamilyGroup=2fce81649158445ea3f611bcbfd8a8b7&jobFamilyGroup=6a4f0b31b53b1000fe90ca34682a0000",
  },
  {
    campus: "Syracuse University",
    type: "peopleadmin",
    url: "https://www.sujobopps.com/postings/search?query=&query_v0_posted_at_date=&query_position_type_id=&829=Any&830=Any&831=Any&832=1&833=Any&query_organizational_tier_3_id=any&commit=Search",
  },
  {
    campus: "Fordham University",
    type: "interfolio-inst",
    url: "https://apply.interfolio.com/11646/positions",
  },
  {
    campus: "St. John's University",
    type: "stjohns",
    url: "https://www.stjohns.edu/recruitment/faculty-positions",
  },
  {
    campus: "Hofstra University",
    type: "peopleadmin",
    url: "https://hofstra.peopleadmin.com/postings/search",
  },
  {
    campus: "Pace University",
    type: "saashr",
    url: "https://secure6.saashr.com/ta/rest/ui/recruitment/companies/%7C6000630/job-requisitions",
  },
  {
    campus: "Adelphi University",
    type: "taleo",
    url: "https://phf.tbe.taleo.net/phf02/ats/careers/v2/searchResults?org=ADELPHI&cws=43",
  },
  {
    campus: "Long Island University",
    type: "generic",
    url: "https://jobs.liu.edu/#/list/F",
  },
  {
    campus: "Rochester Institute of Technology",
    type: "workday",
    url: "https://rit.wd12.myworkdayjobs.com/careers",
  },
  {
    campus: "University of Rochester",
    type: "interfolio-inst",
    url: "https://apply.interfolio.com/16224/positions",
  },
  {
    campus: "Rensselaer Polytechnic Institute",
    type: "generic",
    url: "https://careers.rpi.edu/jobs/search",
  },
  {
    campus: "Yeshiva University",
    type: "pageup",
    url: "https://careers.pageuppeople.com/876/cw/en-us/listing/",
  },
  {
    campus: "The New School",
    type: "workday",
    url: "https://newschool.wd1.myworkdayjobs.com/External?jobFamilyGroup=612cc832aa05108441b9e5fe08672a60",
  },
  {
    campus: "Pratt Institute",
    type: "generic",
    url: "https://www.pratt.edu/administrative-departments/human-resources/open-positions/faculty-positions/",
  },
  // NYIT: iCIMS portal is fully JS-rendered inside iframe wrapper; skipped for now
  // { campus: "New York Institute of Technology", type: "icims", url: "https://careers-nyit.icims.com/jobs/intro" },
  {
    campus: "Marist College",
    type: "generic",
    url: "https://careers.marist.edu/",
  },
  {
    campus: "Iona University",
    type: "paycom",
    url: "https://www.iona.edu/offices/human-resources/employment-iona",
  },
  {
    campus: "Manhattan University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/manhattanedu/FTFaculty",
  },
  { campus: "Associated Beth Rivkah Schools", type: "generic", url: "https://www.bethrivkah.edu/dhl" },
  { campus: "Belanger School of Nursing", type: "generic", url: "https://ellismedicinecareers.hctsportals.com/" },
  { campus: "Elmezzi Graduate School of Molecular Medicine", type: "generic", url: "https://www.northwell.edu/education-and-resources/elmezzi-graduate-school-of-molecular-medicine" },
  { campus: "Samaritan Hospital School of Nursing", type: "generic", url: "https://www.sphp.com/careers/schools-of-nursing/samaritan-hospital-school-of-nursing" },
  { campus: "St. Peter's Hospital College of Nursing", type: "generic", url: "https://www.sphp.com/careers/schools-of-nursing/" },
  { campus: "CVPH Medical Center School of Radiologic Technology", type: "generic", url: "https://www.cvph.org/Residency-and-Education/School-of-Radiology/" },
  { campus: "Memorial Hospital School of Radiation Therapy Technology", type: "generic", url: "https://www.mskcc.org/hcp-education-training/school-radiation-therapy" },
  { campus: "Mesivta Torah Vodaath Rabbinical Seminary", type: "generic", url: "https://independentrabbinicalcolleges.org/index.html" },
  { campus: "Montefiore School of Nursing", type: "generic", url: "https://montefiorenewrochelle.org/school-of-nursing" },
  { campus: "Pomeroy College of Nursing at Crouse Hospital", type: "generic", url: "https://www.crouse.org/nursing" },
  { campus: "School of Professional Horticulture, New York Botanical Garden", type: "generic", url: "https://www.nybg.org/about/work-with-us/employment" },
  { campus: "The Ailey School", type: "generic", url: "https://ailey.org/training" },
  { campus: "Academy for Jewish Religion", type: "generic", url: "https://ajr.edu/jobs/faculty" },
  { campus: "Albany College of Pharmacy and Health Sciences", type: "generic", url: "https://www.acphs.edu/" },
  { campus: "Albany Law School", type: "generic", url: "https://www.albanylaw.edu/about/employment-albany-law-school" },
  { campus: "Albany Medical College", type: "generic", url: "https://www.amc.edu/" },
  { campus: "Albert Einstein College of Medicine", type: "generic", url: "https://www.einsteinmed.edu/" },
  { campus: "Alfred University", type: "generic", url: "https://www.alfred.edu/faculty/jobs" },
  // Was pointing at the bare homepage -- no careers/employment link exists
  // anywhere on aada.edu (confirmed: /careers, /employment, /jobs, and
  // several /about/* variants all 404). AADA has no self-hosted job board;
  // real listings appear on HigherEdJobs (same University= convention
  // already used for Edward Waters University above). Currently 0 active
  // AADA postings there (the one indexed job was deleted 8/23/2025), so this
  // stays at 0 today, but future postings will be caught.
  { campus: "American Academy of Dramatic Arts-New York", type: "generic", url: "https://www.higheredjobs.com/institution/search.cfm?University=American+Academy+Of+Dramatic+Arts" },
  // Was pointing at the bare homepage. Real careers page (amda.edu/jobs)
  // embeds a Jobvite widget (data-careersite="amda") that only renders
  // client-side; the real, directly-scrapable ATS is the Jobvite board
  // itself. Verified live (two fresh page loads): 11 real current postings
  // under "Adjunct Faculty" (e.g. "Alexander Technique Faculty", "English
  // Faculty", "Mathematics Faculty"). No existing NY_PRIVATE dispatch case
  // for "jobvite" (function scrapeJobviteAs already exists and is used by
  // MA_PRIVATE_CAMPUSES) -- added one below, following that exact call
  // convention.
  { campus: "American Musical and Dramatic Academy", type: "jobvite", url: "https://jobs.jobvite.com/amda/jobs" },
  { campus: "Bank Street College of Education", type: "generic", url: "https://www.bankstreet.edu/" },
  { campus: "Bard College", type: "generic", url: "https://www.bard.edu/employment" },
  { campus: "Barnard College", type: "generic", url: "https://www.barnard.edu/" },
  { campus: "Be'er Yaakov Talmudic Seminary", type: "generic", url: "https://www.byts.edu/" },
  { campus: "Beth Hamedrash Shaarei Yosher Institute", type: "generic", url: "https://bhsy.edu/faculty/jobs" },
  { campus: "Binghamton University", type: "generic", url: "https://www.binghamton.edu/" },
  { campus: "Boricua College", type: "generic", url: "https://www.boricuacollege.edu/careers" },
  { campus: "Brooklyn Law School", type: "generic", url: "https://www.brooklaw.edu/" },
  // Same shared UltiPro/UKG board as sibling Bryant & Stratton campuses
  // (Parma/Wauwatosa round 12, Virginia Beach round 13) -- "?q=albany"
  // scopes to this campus. Same card-based-SPA-no-anchor limitation as the
  // sibling campuses -- URL updated for correctness, not a working scraper
  // fix.
  { campus: "Bryant & Stratton College-Albany", type: "generic", url: "https://recruiting.ultipro.com/BRY1002BSC/JobBoard/6b838b9a-cd2b-436a-903b-0de7b6e17b4f/?q=albany&o=postedDateDesc" },
  { campus: "Bryant & Stratton College-Buffalo", type: "generic", url: "https://www.bryantstratton.edu/" },
  { campus: "Bryant & Stratton College-Greece", type: "generic", url: "https://www.bryantstratton.edu/" },
  { campus: "Bryant & Stratton College-Online", type: "generic", url: "https://www.bryantstratton.edu/" },
  { campus: "Bryant & Stratton College-Syracuse North", type: "generic", url: "https://www.bryantstratton.edu/" },
  { campus: "Canisius University", type: "generic", url: "https://www.canisius.edu/" },
  { campus: "Cayuga County Community College", type: "interviewexchange", url: "https://cayuga.interviewexchange.com/" },
  { campus: "Central Yeshiva Tomchei Tmimim Lubavitz", type: "generic", url: "https://cyttl.edu/faculty/jobs" },
  { campus: "Clarkson University", type: "icims", url: "https://careerhub-clarkson.icims.com/" },
  { campus: "Clinton Community College", type: "generic", url: "https://www.clinton.edu/" },
  { campus: "Colgate Rochester Crozer Divinity School", type: "generic", url: "https://www.crcds.edu/" },
  { campus: "Colgate University", type: "generic", url: "https://www.colgate.edu/jobs-colgate" },
  { campus: "College of Staten Island CUNY", type: "generic", url: "https://www.csi.cuny.edu/faculty-staff/human-resources/recruitment/jobs-csi" },
  { campus: "Columbia University in the City of New York", type: "generic", url: "https://www.columbia.edu/" },
  { campus: "Columbia-Greene Community College", type: "generic", url: "https://www.columbiagreene.edu/about/employment-opportunities" },
  { campus: "Culinary Institute of America", type: "generic", url: "https://www.ciachef.edu/" },
  { campus: "CUNY Bernard M Baruch College", type: "generic", url: "https://studentaffairs.baruch.cuny.edu/starr-career-development-center/faculty-and-staff" },
  { campus: "CUNY Borough of Manhattan Community College", type: "generic", url: "https://www.bmcc.cuny.edu/" },
  { campus: "CUNY Bronx Community College", type: "generic", url: "https://www.bcc.cuny.edu/" },
  { campus: "CUNY Brooklyn College", type: "generic", url: "https://www.brooklyn.edu/" },
  { campus: "CUNY City College", type: "generic", url: "https://www.ccny.cuny.edu/" },
  { campus: "CUNY Graduate School and University Center", type: "generic", url: "https://www.gc.cuny.edu/" },
  { campus: "CUNY Hostos Community College", type: "generic", url: "https://www.hostos.cuny.edu/" },
  { campus: "CUNY Hunter College", type: "generic", url: "https://www.hunter.cuny.edu/" },
  { campus: "CUNY John Jay College of Criminal Justice", type: "generic", url: "https://www.jjay.cuny.edu/" },
  { campus: "CUNY Kingsborough Community College", type: "generic", url: "https://www.kbcc.cuny.edu/" },
  { campus: "CUNY LaGuardia Community College", type: "generic", url: "https://www.lagcc.cuny.edu/" },
  { campus: "CUNY Lehman College", type: "generic", url: "https://www.lehman.edu/" },
  { campus: "CUNY Medgar Evers College", type: "generic", url: "https://www.mec.cuny.edu/" },
  { campus: "CUNY New York City College of Technology", type: "generic", url: "https://www.citytech.cuny.edu/faculty/jobs" },
  { campus: "CUNY Queens College", type: "generic", url: "https://www.qc.cuny.edu/" },
  { campus: "CUNY Queensborough Community College", type: "generic", url: "https://www.qcc.cuny.edu/employment" },
  { campus: "CUNY School of Law", type: "generic", url: "https://www.law.cuny.edu/" },
  { campus: "CUNY Stella and Charles Guttman Community College", type: "generic", url: "https://guttman.cuny.edu/" },
  { campus: "CUNY System Office", type: "generic", url: "https://www.cuny.edu/academics/academic-programs/model-programs/cuny-college-transition-programs/adult-literacy/jobs/" },
  { campus: "CUNY York College", type: "generic", url: "https://www.york.cuny.edu/human-resources/jobs" },
  { campus: "D'Youville University", type: "generic", url: "https://www.dyu.edu/" },
  { campus: "Daemen University", type: "generic", url: "https://daemen.applicantpro.com/jobs" },
  { campus: "Dominican University New York", type: "generic", url: "https://www.duny.edu/human-resources/employment-opportunities" },
  { campus: "Dutchess Community College", type: "generic", url: "https://www.sunydutchess.edu/" },
  { campus: "Elim Bible Institute and College", type: "generic", url: "https://elim.edu/" },
  { campus: "Elmira College", type: "generic", url: "https://www.elmira.edu/faculty/jobs" },
  { campus: "Elyon College", type: "generic", url: "https://elyon.edu/" },
  { campus: "Empire State University", type: "generic", url: "https://sunyempire.edu/student-experience/career-services.html/faculty" },
  { campus: "Erie Community College", type: "generic", url: "https://www.ecc.edu/" },
  { campus: "Excelsior University", type: "generic", url: "https://www.excelsior.edu/" },
  { campus: "Farmingdale State College", type: "generic", url: "https://www.farmingdale.edu/human-resources/employment-opportunities.shtml" },
  // Was pointing at the bare marketing homepage. Real ATS is InterviewExchange
  // (54 current openings incl. Adjunct Faculty Pool) — same type already used
  // for Goucher College.
  { campus: "Fashion Institute of Technology", type: "interviewexchange", url: "https://fitnyc.interviewexchange.com/" },
  { campus: "Finger Lakes Community College", type: "generic", url: "https://www.flcc.edu/" },
  { campus: "Finger Lakes Health College of Nursing & Health Sciences", type: "generic", url: "https://www.flhcon.edu/" },
];

// OR (Oregon)
const OR_CAMPUSES = [
  {
    campus: "University of Oregon",
    type: "enusfilter",
    url: "https://careers.uoregon.edu/en-us/filter/?job-mail-subscribe-privacy=agree&search-keyword=&work-type=faculty%20-%20tenure%20track",
  },
  {
    campus: "Southern Oregon University",
    type: "workday",
    url: "https://sou.wd1.myworkdayjobs.com/Southern_Oregon_University?timeType=78f8dc5ac5fe1025a7dd2813833b0003&jobFamilyGroup=edc27d4214f21000cad5ca246d830001",
  },
  {
    campus: "Portland State University",
    type: "peopleadmin-dept",
    url: "https://jobs.hrc.pdx.edu/postings/search",
  },
  {
    campus: "Oregon State University",
    type: "peopleadmin",
    url: "https://jobs.oregonstate.edu/postings/search",
  },
  {
    campus: "Oregon Institute of Technology",
    type: "peopleadmin",
    url: "https://jobs.oit.edu/postings/search",
  },
  {
    campus: "Eastern Oregon University",
    type: "peopleadmin",
    url: "https://eou.peopleadmin.com/postings/search",
  },
  {
    campus: "Western Oregon University",
    type: "generic",
    url: "https://wou.edu/hr/employment/jobs/",
  },
  {
    campus: "Reed College",
    type: "generic",
    url: "https://www.reed.edu/human_resources/employment/",
  },
  {
    campus: "Lewis & Clark College",
    type: "generic",
    url: "https://www.lclark.edu/offices/human_resources/jobs",
  },
  {
    campus: "Willamette University",
    type: "workday",
    url: "https://willamette.wd501.myworkdayjobs.com/WillametteUniversityJobs",
  },
  {
    campus: "University of Portland",
    type: "generic",
    url: "https://www.up.edu/hr/jobs/index.html",
  },
  {
    campus: "Linfield University",
    type: "generic",
    url: "https://careers.linfield.edu/",
  },
  {
    campus: "Pacific University",
    type: "generic",
    url: "https://www.pacificu.edu/directory/finance-administration/human-resources/jobs-pacific",
  },
  {
    campus: "George Fox University",
    type: "generic",
    url: "https://georgefoxfaculty.applicantpool.com/jobs/",
  },

  { campus: "Pacific Northwest College of Art", type: "workday", url: "https://willamette.wd501.myworkdayjobs.com/WillametteUniversityJobs" },
  { campus: "Mount Angel Seminary", type: "generic", url: "https://www.mountangelabbey.org/seminary" },
  { campus: "Blue Mountain Community College", type: "generic", url: "https://www.bluecc.edu/" },
  // The /careers page's "Open Positions" button is a Divi text module (no
  // real href) that JS-navigates to this Paycor recruiting portal -- a full
  // top-level page (not a cross-origin iframe, unlike the Bethune-Cookman/
  // Cairn Paycor cases), so plain generic DOM scraping works fine once
  // pointed here directly. Verified live (two fresh page loads): real
  // faculty postings (Adjunct Arts & Sciences Faculty Pool, Adjunct Nursing
  // Faculty, Full-time Nursing Faculty (Accelerated Baccalaureate),
  // Professor of CMHC/CMHC Director/CACREP Liaison, Adjunct Counseling
  // Faculty Pool, Adjunct School of Business Leadership & Technology
  // Faculty).
  { campus: "Bushnell University", type: "generic", url: "https://recruitingbypaycor.com/career/CareerHome.action?clientId=8a7883d0821e1a630182266519e502b6" },
  { campus: "Central Oregon Community College", type: "generic", url: "https://www.cocc.edu/" },
  { campus: "Chemeketa Community College", type: "schooljobs", url: "https://www.governmentjobs.com/careers/chemeketacc" },
  { campus: "Clackamas Community College", type: "generic", url: "https://www.clackamas.edu/faculty/jobs" },
  { campus: "Clatsop Community College", type: "generic", url: "https://www.clatsopcc.edu/" },
  { campus: "Columbia Gorge Community College", type: "generic", url: "https://www.cgcc.edu/jobs" },
  { campus: "Corban University", type: "generic", url: "https://www.corban.edu/" },
];




// WA (Washington)
const WA_CAMPUSES = [
  {
    campus: "University of Washington",
    type: "uw",
    url: "https://ap.washington.edu/ahr/academic-jobs/",
  },
  {
    campus: "Washington State University",
    type: "workday",
    url: "https://wsu.wd5.myworkdayjobs.com/WSU_Jobs?timeType=6b62c7b4591d0137a1e7b8ebd5055900&jobFamilyGroup=7a7d62448767019c28e399bff8053d45",
  },
  {
    campus: "Western Washington University",
    type: "wwu",
    url: "https://hr.wwu.edu/careers-faculty",
  },
  {
    campus: "Eastern Washington University",
    type: "peopleadmin",
    url: "https://jobs.hr.ewu.edu/postings/search",
  },
  // Two bugs stacked here. (1) The trailing "&" at the very end of the query
  // string broke PeopleSoft's session/cookie handshake -- it redirected to a
  // "cmd=login&errorPg=ckreq" cookie-required error page on every load no
  // matter how long you wait; dropping that trailing "&" fixes it completely
  // (confirmed side-by-side, same URL otherwise). (2) type: "peoplesoft" only
  // reads real <a href> job links, but this is the same PeopleSoft HRS
  // "Explore Jobs" widget as UMN/UT System: titles render as plain <span
  // id="SCH_JOB_TITLE$N"> with javascript: pseudo-hrefs, so the old
  // link-pattern scraper could never match anything here even with the URL
  // fixed. Verified live (two fresh page loads): 98 jobs, real current
  // faculty postings ("Assistant Professor Biochemistry", "Assistant
  // Professor of Accounting", "Lecturer of Collaborative Piano"). No existing
  // WA dispatch case for "peoplesoft-hrs" (function scrapePeopleSoftHrsBasic
  // already exists and is used by MN/TX) -- added one below, following that
  // exact call convention.
  {
    campus: "Central Washington University",
    type: "peoplesoft-hrs",
    url: "https://cwuhrprdcg.peoplesoft.cwu.edu/psc/careers/EMPLOYEE/CAREERS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?FOCUS=Applicant&&siteid=1",
  },
  {
    campus: "Evergreen State College",
    type: "peopleadmin",
    url: "https://evergreen.peopleadmin.com/postings/search",
  },
  {
    campus: "Seattle University",
    type: "generic",
    url: "https://www.seattleu.edu/careers/",
  },
  {
    campus: "Gonzaga University",
    // Real ATS is a paginated PageUp Angular SPA (secure.dc4.pageuppeople.com) —
    // confirmed live with ~22 postings incl. 3 Faculty. "pageup" already exists
    // and handles this platform's pagination/cookie-banner.
    type: "pageup",
    url: "https://employment.gonzaga.edu/",
  },
  // URL was already correct (real PeopleSoft HRS "Explore Jobs" results
  // page), but type: "generic" only reads real <a href> job links -- this
  // is the same PeopleSoft HRS shape as Central Washington University
  // above (and UMN/UT System): titles render as plain
  // <span id="SCH_JOB_TITLE$N"> with an onclick postback, no real href, so
  // the old link-pattern scraper could never match anything here regardless
  // of URL. Switched to the existing "peoplesoft-hrs" dispatch case.
  // Verified live (two fresh page loads): the raw extraction correctly
  // finds the current single posting ("Affiliate Artist in Applied Oboe",
  // School of Music) -- genuinely 0 after the shared strict faculty-keyword
  // filter (no professor/lecturer/instructor/faculty/adjunct in the title)
  // right now, but the infrastructure is now correctly wired to pick up a
  // real Professor/Instructor/Lecturer posting whenever one is listed.
  {
    campus: "University of Puget Sound",
    type: "peoplesoft-hrs",
    url: "https://www2.pugetsound.jobs/psc/HR92PRD/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL&Action=U&FOCUS=Applicant&siteid=3",
  },
  {
    campus: "Whitman College",
    type: "interfolio-links",
    url: "https://www.whitman.edu/provost/faculty-employment-opportunities",
  },
  {
    campus: "Whitworth University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/whitworth/faculty",
  },
  {
    campus: "Pacific Lutheran University",
    type: "peopleadmin",
    url: "https://employment.plu.edu/postings/search?query=&query_v0_posted_at_date=&392=&394=&395%5B%5D=3&commit=Search",
  },
  {
    campus: "Seattle Pacific University",
    type: "generic",
    url: "https://spu.edu/about-spu/employment-at-spu",
  },
  {
    campus: "Saint Martin's University",
    type: "generic",
    url: "https://www.stmartin.edu/about/careers",
  },
  { campus: "Whitworth University-Adult Degree Programs", type: "generic", url: "https://www.whitworth.edu/careers" },
  { campus: "Antioch University-Seattle", type: "generic", url: "https://www.antioch.edu/employment" },
  { campus: "Bastyr University", type: "paycom", url: "https://www.paycomonline.net/v4/ats/web.php/jobs?clientkey=35ECA37F07A12A40C9F79168AFFA3433" },
  { campus: "Bates Technical College", type: "schooljobs", url: "https://www.schooljobs.com/careers/batesctc" },
  { campus: "Bellevue College", type: "generic", url: "https://bellevuecollege.edu/" },
  // Was 404ing (/faculty/jobs doesn't exist). Real ATS is NEOGOV/SchoolJobs
  // (governmentjobs.com/careers/btc redirects to schooljobs.com/careers/btc).
  // Verified live (two fresh page loads): 16 postings, incl. real current
  // "Adjunct Faculty - Generic Application" and "I-BEST ... Adjunct
  // Instructor".
  { campus: "Bellingham Technical College", type: "schooljobs", url: "https://www.schooljobs.com/careers/btc" },
  { campus: "Big Bend Community College", type: "generic", url: "https://www.bigbend.edu/about-us/jobs-at-bbcc.html" },
  { campus: "Cascadia College", type: "generic", url: "https://hcprd.ctclink.us/psc/tam/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?FOCUS=Applicant&SiteId=300" },
  { campus: "Centralia College", type: "generic", url: "https://hcprd.ctclink.us/psc/tam/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?FOCUS=Applicant&SiteId=120" },
  // Was pointing at the bare homepage. Homepage's "Career Opportunities" link
  // (cityu.edu/jobs/) hands off to their InterviewExchange ATS (tenant
  // 447CSM1, institution-specific, not a shared/system-wide board). Verified
  // live (two fresh page loads): real current posting "Full-time Teaching
  // Faculty". Existing scrapeInterviewExchangeAs function reused (already
  // dispatched for many other interviewexchange-hosted schools).
  { campus: "City University of Seattle", type: "interviewexchange", url: "https://cityu.interviewexchange.com/static/clients/447CSM1/index.jsp" },
  { campus: "Clark College", type: "schooljobs", url: "https://www.schooljobs.com/careers/clarkcollege" },
  // Configured URL redirects to the HR landing page, which only points
  // onward to the real ATS in prose ("See our job openings on the NeoGov
  // website"). Real board is this institution-specific SchoolJobs/NeoGov
  // tenant, linked as "Careers at CPTC". WA dispatcher already has a
  // "schooljobs" case (used elsewhere) -- reused directly.
  { campus: "Clover Park Technical College", type: "schooljobs", url: "https://www.cptc.edu/careers" },
  // The /facultypositions suffix now 404s; the bare board still works.
  { campus: "Columbia Basin College", type: "schooljobs", url: "https://www.schooljobs.com/careers/columbiabasin/facultypositions" },
  { campus: "Cornish College of the Arts", type: "generic", url: "https://www.cornish.edu/" },
  { campus: "Edmonds College", type: "generic", url: "https://www.edmonds.edu/about-edmonds/job-opportunities/" },
  { campus: "Everett Community College", type: "generic", url: "https://www.everettcc.edu/faculty/jobs" },
  { campus: "Faith International University", type: "generic", url: "https://www.faithiu.edu/" },
];


// ME (Maine)
const ME_CAMPUSES = [
  {
    campus: "University of Maine System",
    type: "oracle-cx",
    url: "https://fa-ewca-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs",
  },
  {
    campus: "Bates College",
    type: "generic",
    url: "https://www.bates.edu/employment/",
  },
  {
    campus: "Bowdoin College",
    type: "peopleadmin",
    url: "https://careers.bowdoin.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&435=&query_position_type_id%5B%5D=2&commit=Search",
  },
  {
    campus: "Colby College",
    type: "generic",
    url: "https://www.colby.edu/human-resources/employment/",
  },
  { campus: "Maine Media College", type: "generic", url: "https://www.mainemedia.edu/life-at-mmwc/employment-opportunities" },
  { campus: "Central Maine Community College", type: "generic", url: "https://www.cmcc.edu/" },
  // Was pointing at the bare homepage. Real page (human-resources/careers/)
  // lists postings as WordPress accordion <button class="wp-block-accordion-
  // heading__toggle">, not <a href> -- already correctly picked up by the
  // shared generic scraper's existing accordion-fallback (matches its
  // button[class*='accordion' i] selector) once pointed at the right page,
  // no code change needed. Verified live (two fresh page loads): 3 real
  // current faculty postings (Faculty Member in Agroecology, Faculty Member
  // in Chemistry, Faculty Member in Field Ecology).
  { campus: "College of the Atlantic", type: "generic", url: "https://www.coa.edu/human-resources/careers/" },
  { campus: "Eastern Maine Community College", type: "generic", url: "https://www.emcc.edu/discover-emcc/emcc/employment" },
  {
    campus: "University of New England",
    type: "peopleadmin",
    url: "https://une.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&811%5B%5D=1&commit=Search",
  },
  {
    campus: "Husson University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/husson",
  },
  {
    campus: "Maine Maritime Academy",
    type: "generic",
    url: "https://mainemaritime.edu/employment-at-mma/faculty-positions/",
  },
  {
    campus: "Unity Environmental University",
    type: "paycom",
    url: "https://www.paycomonline.net/v4/ats/web.php/jobs?clientkey=ED9820B3EB18F3366E468E5024A065B8",
  },
];

// VT (Vermont)
const VT_CAMPUSES = [
  {
    campus: "University of Vermont",
    type: "peopleadmin",
    url: "https://www.uvmjobs.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "Middlebury College",
    type: "generic",
    url: "https://www.middlebury.edu/college/academics/academic-affairs/faculty/prospective-faculty/open-positions",
  },
  // The "Employment Opportunities" page is pure HR policy text (EEO
  // statement, background-check policy, benefits for spouses/partners,
  // etc.) with no job listings anywhere on it, nor any link to the real
  // board. Real ATS (found via web search, not linked from this page or
  // /human-resources) is this institution-specific Trakstar Hire tenant,
  // with real per-job <a href> anchors -- generic scraping works fine once
  // pointed here. Verified live (two fresh page loads): 10 real current
  // postings, genuinely 0 faculty-titled among them right now (Associate
  // Director of Residence Life, Director of Health Services, Registered
  // Nurse, Sponsored Research Administrator, etc.).
  {
    campus: "Bennington College",
    type: "generic",
    url: "https://bennington.hire.trakstar.com/",
  },
  {
    campus: "Saint Michael's College",
    type: "oracle-cx",
    url: "https://egqw.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_13/jobs",
  },
  {
    campus: "Champlain College",
    type: "generic",
    url: "https://champlain-ibumjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs",
  },
  { campus: "Community College of Vermont", type: "generic", url: "https://www.ccv.edu/" },
  {
    campus: "Vermont State University",
    type: "workday",
    url: "https://vsc.wd108.myworkdayjobs.com/VTSU",
  },
];

// MN (Minnesota)
const MN_CAMPUSES = [
  {
    campus: "University of Minnesota",
    type: "umn",
    url: "https://hr.myu.umn.edu/psc/hrprd/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL&ACTION=U&FOCUS=Applicant&SiteId=1",
  },
  {
    campus: "Minnesota State System",
    type: "workday",
    url: "https://minnstate.wd115.myworkdayjobs.com/Minnesota_State_Careers",
  },
  {
    campus: "Carleton College",
    type: "workday",
    url: "https://carleton.wd1.myworkdayjobs.com/CarletonCareers",
  },
  {
    campus: "Macalester College",
    type: "generic",
    url: "https://www.macalester.edu/human-resources/jobs",
  },
  { campus: "Hazelden Betty Ford Graduate School", type: "generic", url: "https://www.hazeldenbettyford.org/education/graduate-school-addiction-studies" },
  { campus: "Adler Graduate School", type: "generic", url: "https://www.alfredadler.edu/about/employment-opportunities" },
  { campus: "Alexandria Technical & Community College", type: "workday", url: "https://minnstate.wd115.myworkdayjobs.com/Minnesota_State_Careers?Institution=a7c1912089511000d545ed292bdd0000" },
  { campus: "Anoka Technical College", type: "workday", url: "https://minnstate.wd115.myworkdayjobs.com/Minnesota_State_Careers?Institution=a7c1912089511000d545edc2d07b0000" },
  // Was pointing at the bare homepage. Real ATS is the MN State Workday
  // tenant (same pattern as Alexandria Technical & Community College / Anoka
  // Technical College above). Verified live (two fresh page loads): filters
  // correctly to Anoka-Ramsey, 4 real current postings -- none faculty-titled
  // today (Lab Assistant, Executive Assistant), so this stays at 0, but any
  // future faculty posting will now be caught.
  { campus: "Anoka-Ramsey Community College", type: "workday", url: "https://minnstate.wd115.myworkdayjobs.com/Minnesota_State_Careers?Institution=a7c1912089511000d545c44873db0001" },
  { campus: "Augsburg University", type: "generic", url: "https://www.augsburg.edu/employment" },
  // Was pointing at the campus's own HR page, which the generic scraper's
  // ATS-handoff logic detected as linking to the bare, unscoped MN State
  // Workday tenant root ("career site" link) and handed off to the FULL
  // system-wide board -- 70 jobs from all over Minnesota State (St. Paul,
  // Winona, Austin, etc.) were being mislabeled as Bemidji State postings.
  // Scoped here to Bemidji specifically via ?Institution=<id> (same pattern
  // as Alexandria Technical & Community College / Anoka-Ramsey Community
  // College above); id confirmed live via the Workday jobs API's own
  // Institution facet ("CU0070 Bemidji State University"). Verified live
  // (two fresh loads): 2 real current postings scoped correctly to Bemidji
  // (Associate Director of International Program Center, Retention and
  // Recruitment Spec - Ojibwe Teacher Trng Program) -- neither faculty-titled
  // today, so this stays at 0, but any future faculty posting will now be
  // caught correctly instead of drowned in system-wide noise.
  { campus: "Bemidji State University", type: "workday", url: "https://www.bemidjistate.edu/offices/human-resources/prospective-employees" },
  { campus: "Bethany Global University", type: "generic", url: "https://bethanygu.edu/" },
  { campus: "Bethany Lutheran College", type: "generic", url: "https://blc.edu/campus-life/campus-services/human-resources/bethany-jobs" },
  { campus: "Bethlehem College & Seminary", type: "generic", url: "https://bcsmn.edu/" },
  // Was pointing at the bare homepage. Real ATS is the single Workday
  // tenant shared across the entire 33-college/university Minnesota State
  // system (161 openings total, unscoped misattribution risk) -- but its
  // "Institution" facet (id a7c1912089511000d545eab9a9bb0004, "CU0301
  // Central Lakes College", found via the tenant's own /wday/cxs/.../jobs
  // facet listing) genuinely scopes to this campus specifically. MN
  // dispatcher already has a "workday" case -- reused directly. Verified
  // live (two fresh page loads): 1 open posting right now (MnSCU
  // Administrator 8: Vice President of Administrative Services) --
  // genuinely 0 faculty postings at this time.
  {
    campus: "Central Lakes College-Brainerd",
    type: "workday",
    url: "https://minnstate.wd115.myworkdayjobs.com/Minnesota_State_Careers?Institution=a7c1912089511000d545eab9a9bb0004",
  },
  { campus: "College of Saint Benedict", type: "schooljobs", url: "https://www.schooljobs.com/careers/csbsju/faculty" },
  { campus: "Concordia College at Moorhead", type: "generic", url: "https://www.concordiacollege.edu/" },
  { campus: "Concordia University-Saint Paul", type: "generic", url: "https://www.csp.edu/" },
  { campus: "Crown College", type: "generic", url: "https://www.crown.edu/" },
  { campus: "Dakota County Technical College", type: "generic", url: "https://www.dctc.edu/about-us/human-resources/employment-at-dctc" },
  { campus: "Dunwoody College of Technology", type: "generic", url: "https://dunwoody.edu/about/employment-at-dunwoody/faculty" },
  { campus: "Fond du Lac Tribal and Community College", type: "generic", url: "https://www.fdltcc.edu/" },
];

// ND (North Dakota)
const ND_CAMPUSES = [
  {
    campus: "University of North Dakota",
    type: "generic",
    url: "https://careers.und.edu/jobs/search",
  },
  {
    campus: "North Dakota State University",
    type: "ndsu-joblist",
    url: "https://www.ndsu.edu/employment/joblist",
  },
  {
    campus: "University of Mary",
    type: "generic",
    url: "https://universityofmary.applytojob.com/apply",
  },
  {
    campus: "University of Jamestown",
    type: "generic",
    url: "https://www.uj.edu/about/job-opportunities",
  },
  // Was pointing at the employment landing page one level too shallow; real
  // per-posting table is one click deeper at /employment/JobOpenings/.
  // Confirmed real content there: real current faculty opening ("Assistant
  // Professor of Artifical Intelligence"), but each row's only action is a
  // JS "MORE INFO" postback, not a real <a href> -- classic non-anchor-table
  // pattern the generic scraper structurally can't match without patching
  // shared logic. The page also links to the ND statewide HRMS PeopleSoft
  // portal (cnd.nd.gov, "ND Human Resource Management Services - Job
  // Openings") as an alternative, but that SiteId param doesn't actually
  // scope it -- clicking through lands on the full state-government-wide
  // board (Fire Marshal, Attorney General, etc., nothing to do with BSC), so
  // it was deliberately NOT wired to avoid mislabeling unrelated state jobs
  // as Bismarck State postings. Routed to the real per-institution job table
  // instead.
  { campus: "Bismarck State College", type: "generic", url: "https://bismarckstate.edu/employment/JobOpenings/" },
  { campus: "Cankdeska Cikana Community College", type: "generic", url: "https://www.littlehoop.edu/" },
  { campus: "Dakota College at Bottineau", type: "generic", url: "https://www.dakotacollege.edu/explore-dcb/employment" },
  // Was pointing at the wrapper "Open Positions" page (contact info + tabs,
  // no listing of its own). Its "All Others" tab links to this real,
  // already-Dickinson-State-scoped table (backed by NDUS's shared PeopleSoft
  // HRS system, same platform as Dakota College at Bottineau) with real
  // per-row <a href> to NDUS job-detail pages -- 30 real current postings,
  // including faculty titles ("Assistant Professor of Nursing", "Assistant
  // Professor of Business", "Assistant Professor of Computer Science",
  // "Theatre Adjunct Instructor/Club Advisor"). Documented, not patched:
  // titles live in a plain <td> next to each row's generic "MORE INFO &
  // APPLY" anchor, same "no heading to rescue from" shape found at Dakota
  // College at Bottineau (round 12) -- the shared generic scraper's
  // CTA-rescue only looks for a heading/accordion-toggle element, never a
  // sibling table cell. URL updated anyway for correctness/specificity over
  // the old wrapper page.
  { campus: "Dickinson State University", type: "generic", url: "http://www2.dsu.nodak.edu/jobopenings/regular.aspx" },
];

// SD (South Dakota)
const SD_CAMPUSES = [
  {
    campus: "South Dakota Board of Regents",
    type: "peopleadmin",
    url: "https://yourfuture.sdbor.edu/postings/search?query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=3&commit=Search",
  },
  {
    campus: "Augustana University",
    type: "workday-search",
    url: "https://wd1.myworkdaysite.com/recruiting/augie/augie",
  },
  {
    campus: "University of Sioux Falls",
    type: "generic",
    url: "https://www.usiouxfalls.edu/about/employment",
  },
  // Was pointing at the bare homepage. BHSU's own "Employment" nav link
  // hands off to the shared SD Board of Regents PeopleAdmin tenant (same
  // system as the separate "South Dakota Board of Regents" entry above,
  // which already infers per-posting college via inferSdborCampusFromDetail)
  // but with its own "Institution" org-tier facet
  // (query_organizational_tier_1_id=1252) applied directly, genuinely
  // scoped to BHSU specifically. SD dispatcher already has a "peopleadmin"
  // case -- reused directly. Verified live (two fresh page loads): 14
  // postings, real faculty titles (Adjunct, Biology; Instructor, Operations
  // Management/Business Analytics; Instructor, Multi-Media Journalism).
  {
    campus: "Black Hills State University",
    type: "peopleadmin",
    url: "https://yourfuture.sdbor.edu/postings/search?query=&query_v0_posted_at_date=&435=&query_organizational_tier_1_id%5B%5D=1252&225=&commit=Search",
  },
  { campus: "Dakota Wesleyan University", type: "generic", url: "https://www.dwu.edu/academics/faculty-jobs" },
];

// NE (Nebraska)
const NE_CAMPUSES = [
  {
    campus: "University of Nebraska-Lincoln",
    type: "peopleadmin",
    url: "https://employment.unl.edu/postings/search",
  },
  {
    campus: "University of Nebraska Omaha",
    type: "peopleadmin",
    url: "https://unomaha.peopleadmin.com/postings/search?query_position_type_id%5B%5D=3",
  },
  {
    campus: "University of Nebraska Medical Center",
    type: "peopleadmin",
    url: "https://unmc.peopleadmin.com/postings/search",
  },
  {
    campus: "Creighton University",
    type: "generic",
    url: "https://www.creighton.edu/about/leadership-key-offices-contacts/administrative-offices/human-resources/careers",
  },
  {
    campus: "Nebraska Wesleyan University",
    type: "generic",
    url: "https://www.nebrwesleyan.edu/about-nwu/employment",
  },
  {
    campus: "Doane University",
    type: "generic",
    url: "https://www.doane.edu/offices-services/human-resources/careers",
  },
  { campus: "Bryan College of Health Sciences", type: "generic", url: "https://www.bryanhealthcollege.edu/bcohs/" },
  { campus: "CHI Health School of Radiologic Technology", type: "generic", url: "https://www.chihealth.com/careers" },
  // Was pointing at the bare homepage. Real page is
  // /bellevue-university-careers/, linked from the homepage. Confirmed real
  // content there: a full-time faculty ADP recruitment portal ("Assistant
  // Professor, Finance") and a separate adjunct-faculty table
  // (web.bellevue.edu/adjunct_OpenPositions/, "Adjunct Faculty -- Finance",
  // "Adjunct Instructor - Communication Studies") -- both real, current
  // faculty openings, but neither is anchor-based (the ADP cards have no
  // real per-job href, and the adjunct table uses plain <p> text with
  // <button> actions instead of <a href>), so the generic scraper's
  // link-based heuristic structurally can't catch either without patching
  // shared logic. Routed to the real careers page anyway for correctness.
  { campus: "Bellevue University", type: "generic", url: "https://www.bellevue.edu/bellevue-university-careers/" },
  { campus: "Central Community College", type: "generic", url: "https://cccneb.edu/employment/" },
  { campus: "Chadron State College", type: "generic", url: "https://www.csc.edu/hr/job-opportunities" },
  { campus: "Clarkson College", type: "generic", url: "https://www.clarksoncollege.edu/" },
  { campus: "College of Saint Mary", type: "generic", url: "https://www.csm.edu/" },
  { campus: "Concordia University-Nebraska", type: "generic", url: "https://www.cune.edu/employment/jobs-and-openings" },
];

// IA (Iowa)
const IA_CAMPUSES = [
  {
    campus: "University of Iowa",
    type: "generic",
    url: "https://jobs.uiowa.edu/jobSearch/faculty/searchResults.php?submit=Search+For+Openings&searchType=FACULTY&org=11",
  },
  {
    campus: "Iowa State University",
    type: "workday",
    url: "https://isu.wd1.myworkdayjobs.com/IowaStateJobs",
  },
  {
    campus: "University of Northern Iowa",
    type: "workday",
    url: "https://uni.wd5.myworkdayjobs.com/UNI",
  },
  {
    campus: "Drake University",
    type: "nau-search",
    url: "https://jobs.drake.edu/jobs/search?page=1&employment_type_uids%5B%5D=f54f0d72d35cecc2f21099a585732daa&employment_type_uids%5B%5D=b66d76f56d2c3e184a9b92f96a742e9d&employment_type_uids%5B%5D=bdd91c0b76d14e0e44f1d8dc3e2b4342&query=",
  },
  {
    campus: "Grinnell College",
    type: "interfolio-inst",
    url: "https://apply.interfolio.com/11893/positions",
  },
  {
    campus: "Luther College",
    type: "generic",
    url: "https://www.luther.edu/offices/hr/careers",
  },
  { campus: "Mercy-St Luke's School of Radiologic Technology", type: "generic", url: "https://www.mercycare.org/employment/students/school-of-radiologic-technology/" },
  { campus: "UnityPoint Health-Des Moines School of Radiologic Technology", type: "generic", url: "https://www.unitypoint.org/join-our-team/medical-education-and-career-growth/school-of-radiologic-technology---des-moines-area-hospitals" },
  { campus: "Allen College", type: "generic", url: "https://www.allencollege.edu/" },
  { campus: "Briar Cliff University", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=b598cb69-0393-4ebc-902c-696995eb5395&ccId=19000101_000001&lang=en_US" },
  { campus: "Buena Vista University", type: "generic", url: "https://www.bvu.edu/" },
  { campus: "Central College", type: "generic", url: "https://central.edu/job-seekers" },
  { campus: "Clarke University", type: "generic", url: "https://clarke.applicantpool.com/jobs" },
  { campus: "Coe College", type: "generic", url: "https://www.coe.edu/" },
  { campus: "Cornell College", type: "generic", url: "https://www.cornellcollege.edu/faculty/jobs" },
  // Was pointing at the bare homepage. Real ATS is PeopleAdmin
  // (jobs.dmacc.edu), scoped here to the Faculty Positions category filter
  // (1225[]=8). Verified live (two fresh page loads): real current posting
  // "Instructor, Construction Technology (Specially Funded)".
  {
    campus: "Des Moines Area Community College",
    type: "peopleadmin",
    url: "https://jobs.dmacc.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&435=&1225%5B%5D=8&commit=Search",
  },
  { campus: "Des Moines University-Osteopathic Medical Center", type: "generic", url: "https://careers.dmu.edu/en-us/listing" },
  { campus: "Divine Word College", type: "generic", url: "https://www.dwci.edu/" },
  { campus: "Dordt University", type: "oracle-cx", url: "https://ibmxjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2/jobs?lastSelectedFacet=CATEGORIES&selectedCategoriesFacet=300000008610535" },
  // Was pointing at a soft-404 ("Page Not Found") on eicc.edu. Real ATS is
  // their own PeopleAdmin instance (eicc.peopleadmin.com), linked from
  // eicc.edu/about/career/. Verified live (two fresh page loads): 47
  // postings, many real faculty/adjunct (Adjunct Faculty - Political
  // Science, Adjunct Faculty - Education, Adjunct Faculty - American Sign
  // Language, Faculty - Economics, Faculty - Accounting). IA dispatcher
  // already has a "peopleadmin" case (used elsewhere) -- reused directly.
  { campus: "Eastern Iowa Community College District", type: "peopleadmin", url: "https://eicc.peopleadmin.com/postings/search" },
  { campus: "Ellsworth Community College", type: "generic", url: "https://ecc.iavalley.edu/" },
  { campus: "Emmaus Bible College", type: "generic", url: "https://www.emmaus.edu/careers" },
  { campus: "Faith Baptist Bible College and Theological Seminary", type: "generic", url: "https://faith.edu/careers" },
];

// WY (Wyoming)
const WY_CAMPUSES = [
  {
    campus: "University of Wyoming",
    type: "oracle-cx",
    url: "https://eeik.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs?lastSelectedFacet=TITLES&selectedTitlesFacet=Faculty%2FAcademic%3BTemporary+Lecturer",
  },
  {
    campus: "Wyoming Catholic College",
    type: "generic",
    url: "https://wyomingcatholic.edu/employment/",
  },
  { campus: "Casper College", type: "schooljobs", url: "https://www.schooljobs.com/careers/caspercollege" },
  { campus: "Central Wyoming College", type: "generic", url: "https://www.cwc.edu/" },
  { campus: "Eastern Wyoming College", type: "generic", url: "https://ewc.wy.edu/" },
];

// MT (Montana)
const MT_CAMPUSES = [
  {
    campus: "Montana State University",
    type: "peopleadmin",
    url: "https://jobs.montana.edu/postings/search?query_position_type_id=2",
  },
  {
    campus: "University of Montana",
    type: "interfolio-inst",
    url: "https://apply.interfolio.com/53871/positions",
  },
  {
    campus: "Carroll College",
    type: "generic",
    url: "https://www.carroll.edu/faculty-staff-positions",
  },
  {
    campus: "Rocky Mountain College",
    type: "generic",
    url: "https://rocky.edu/employment/",
  },
  { campus: "Aaniiih Nakoda College", type: "generic", url: "https://www.ancollege.edu/careers/faculty" },
  { campus: "Blackfeet Community College", type: "generic", url: "https://bfcc.edu/About/employment" },
  { campus: "Chief Dull Knife College", type: "generic", url: "https://www.cdkc.edu/faculty-staff/employment" },
  { campus: "Dawson Community College", type: "generic", url: "https://www.dawson.edu/" },
  // Was pointing at the bare homepage. The "Careers at FVCC" page's "View
  // Faculty & Staff Job Openings" link goes to this institution-specific
  // Paycom tenant. Not left as "generic": same Paycom-SPA truncated-title
  // shape as Brazosport College (TX) / Copiah-Lincoln Community College (MS)
  // / Cowley County Community College (KS) -- the shared generic scraper's
  // inline extraction rejects every card and its ATS-handoff fallback grabs
  // a single job's detail URL instead of the listing root. Calling
  // scrapePaycomAs directly avoids both. MT dispatcher had no "paycom" case
  // yet -- added above. Verified live (two fresh page loads): 9 real
  // postings after the shared adjunct/part-time filter, including "Adjunct
  // Instructor, Culinary" and "Adjunct Instructor, Clinical Skills
  // Instructor, Medical Assisting".
  {
    campus: "Flathead Valley Community College",
    type: "paycom",
    url: "https://www.paycomonline.net/v4/ats/web.php/portal/23D9610C7FF62DF6DF80223B0B1ED6E3/career-page",
  },
  { campus: "Fort Peck Community College", type: "generic", url: "https://www.fpcc.edu/about" },
];

// WI (Wisconsin)
const WI_CAMPUSES = [
  {
    campus: "UW-Madison",
    type: "workday",
    url: "https://wisconsin.wd1.myworkdayjobs.com/UW_Madison",
  },
  {
    campus: "UW-Milwaukee",
    type: "workday",
    url: "https://wisconsin.wd1.myworkdayjobs.com/UW_Milwaukee",
  },
  {
    campus: "UW System Comprehensives",
    type: "workday",
    url: "https://wisconsin.wd1.myworkdayjobs.com/UW_Comprehensives",
  },
  {
    campus: "Marquette University",
    type: "peopleadmin",
    url: "https://employment.marquette.edu/postings/search",
  },
  {
    campus: "Beloit College",
    type: "generic",
    url: "https://beloit.applicantpro.com/jobs",
  },
  {
    campus: "Lawrence University",
    type: "generic",
    url: "https://www.lawrence.edu/offices/hr/careers",
  },
  {
    campus: "St. Norbert College",
    type: "generic",
    url: "https://www.snc.edu/hr/employment/",
  },
  { campus: "Alverno College", type: "generic", url: "https://www.alverno.edu/employment" },
  // Was pointing at the bare homepage. Real page is
  // /about/employment-at-bellin-college/, linked from the homepage.
  // Confirmed real content there: real current faculty openings ("Adjunct
  // Faculty - BSN Program", "Adjunct Faculty - DPT Program", "Faculty Member
  // - DPT Program"), but titles render as plain heading text with the actual
  // "Apply Now!" anchors (an Infor CloudSuite ATS) sitting separately --
  // classic non-anchor-heading pattern the generic scraper structurally
  // can't match without patching shared logic. Routed to the real page
  // anyway for correctness.
  { campus: "Bellin College", type: "generic", url: "https://www.bellincollege.edu/about/employment-at-bellin-college" },
  // Was pointing at the HR landing page itself. Real ATS is this
  // institution-specific iCIMS tenant, linked as "Administrative Openings"
  // (WI dispatcher already has an "icims" case, used for Chippewa Valley
  // Technical College -- reused directly). NOT independently verified
  // working: every attempt from this environment (and, identically, against
  // the already-wired Chippewa Valley tenant) hit an iCIMS "Human
  // Verification" bot-check (HTTP 405) instead of the job list, so this is
  // the same "wire for correctness, let the reviewer confirm" treatment as
  // InterviewExchange, not a verified fix.
  { campus: "Blackhawk Technical College", type: "icims", url: "https://careers-blackhawk.icims.com/" },
  // Same shared UltiPro/UKG board as sibling Bryant & Stratton College-Parma
  // (round 12) -- "?q=wauwatosa" scopes to this campus specifically (9
  // results, incl. "Associate Professor - Nursing" and "Adjunct Professor -
  // Nursing" -- confirmed via manual read of the page). NOT wired as a
  // working fix for the same reason: card-based SPA with no per-job <a
  // href>, shared generic scraper yields 0. URL updated anyway for
  // correctness/specificity over the old bare homepage.
  { campus: "Bryant & Stratton College-Wauwatosa", type: "generic", url: "https://recruiting.ultipro.com/BRY1002BSC/JobBoard/6b838b9a-cd2b-436a-903b-0de7b6e17b4f/?q=wauwatosa&o=postedDateDesc" },
  { campus: "Carroll University", type: "generic", url: "https://www.carrollu.edu/employment" },
  { campus: "Carthage College", type: "generic", url: "https://carthage.applicantpro.com/jobs" },
  { campus: "Chippewa Valley Technical College", type: "icims", url: "https://careers-cvtc.icims.com/" },
  { campus: "College of Menominee Nation", type: "generic", url: "https://www.menominee.edu/about-cmn/career-opportunities" },
  // Was the sitewide search results page (4,196 hits: blog posts, PDFs, unrelated
  // content), not a job list. Real ATS is ApplicantPro.
  { campus: "Concordia University-Wisconsin", type: "generic", url: "https://cuw.applicantpro.com/jobs" },
  { campus: "Edgewood College", type: "generic", url: "https://www.edgewood.edu/employment/" },
  { campus: "Fox Valley Technical College", type: "generic", url: "https://www.fvtc.edu/academics/faculty-jobs" },
];

// CO (Colorado)
const CO_CAMPUSES = [
  {
    campus: "CU Boulder",
    type: "cu-boulder",
    url: "https://jobs.colorado.edu/jobs/SearchJobs?employmentType=Faculty",
  },
  {
    campus: "CU Denver",
    type: "taleo",
    url: "https://cu.taleo.net/careersection/cu_ext_ucd/moresearch.ftl?lang=en",
  },
  {
    campus: "CU Anschutz",
    type: "taleo",
    url: "https://cu.taleo.net/careersection/cu_ext_amc/moresearch.ftl?lang=en",
  },
  {
    campus: "UCCS",
    type: "taleo",
    url: "https://cu.taleo.net/careersection/cu_ext_uccs/moresearch.ftl?lang=en",
  },
  {
    campus: "Colorado State University",
    type: "workday",
    url: "https://csusystem.wd12.myworkdayjobs.com/fortcollins_careers",
  },
  {
    campus: "Colorado School of Mines",
    type: "workday",
    url: "https://mines.wd1.myworkdayjobs.com/Mines_Careers",
  },
  {
    campus: "University of Denver",
    type: "pageup",
    url: "https://jobs.du.edu/en-us/listing/",
  },
  {
    campus: "Colorado College",
    type: "pageup",
    url: "https://jobs.coloradocollege.edu/jobs/search",
  },
  { campus: "Adams State University", type: "generic", url: "https://www.adams.edu/hr/employment" },
  { campus: "Aims Community College", type: "generic", url: "https://www.aims.edu/" },
  { campus: "Arapahoe Community College", type: "generic", url: "https://www.arapahoe.edu/about-acc/employment-acc" },
  // Was 404ing (no /faculty/jobs page exists). Real careers page is
  // /careers-2/ (same URL already used for the Casa Loma College-Los Angeles
  // record). Verified live: real postings exist ("Leadership and Management
  // Instructor", "Adjunct Faculty", "Adjunct Faculty - General Education")
  // but titles live in a <strong> inside a preceding sibling <p>, not inside
  // the anchor's own card ancestor -- the CTA-link's text ("See more
  // details") points to an external Indeed listing instead of a same-page
  // detail, so the generic scraper's heading-lookup fallback can't reach it.
  { campus: "Casa Loma College - Aurora", type: "generic", url: "https://casalomacollege.edu/careers-2" },
  { campus: "Colorado Christian University", type: "generic", url: "https://www.ccu.edu/jobs/" },
  { campus: "Colorado Mesa University", type: "generic", url: "https://www.coloradomesa.edu/" },
  { campus: "Colorado Mountain College", type: "generic", url: "https://coloradomtn.edu/" },
  { campus: "Colorado Northwestern Community College", type: "generic", url: "https://www.cncc.edu/about/human-resources/career-opportunities" },
  // Bare "https://csuglobal.edu/" root loads with a blank body (0 chars) in
  // a headless browser -- confirmed on repeated fresh loads -- so the
  // generic scraper had literally nothing to read at that URL. Routed to the
  // real Careers page, which does load real content, but its "View Openings"
  // links only point out to faculty-csuglobal.icims.com /
  // staff-csuglobal.icims.com, both of which return an iCIMS "Human
  // Verification" bot-challenge (HTTP 405) on every attempt -- confirmed on
  // two separate fresh page loads, so that real ATS could not be verified
  // and is NOT wired here. Net effect: still 0 results, but at least reading
  // real content instead of an empty page.
  { campus: "Colorado State University Global", type: "generic", url: "https://csuglobal.edu/about/careers" },
  // Was a category-description landing page with no postings/ATS links. Real
  // listings + Workday hand-off link live one page deeper.
  { campus: "Colorado State University Pueblo", type: "generic", url: "https://www.csupueblo.edu/human-resources/employment/current-opportunities.html" },
  { campus: "Colorado State University-Fort Collins", type: "generic", url: "https://hr.colostate.edu/prospective-employees" },
  { campus: "Colorado State University-System Office", type: "generic", url: "https://csusystem.edu/jobs" },
  // Was pointing at the bare homepage. The "Careers at CCA" page's "Staff and
  // Faculty Careers at CCA" link hands off to CCCS's (Colorado Community
  // College System, all 13 system colleges) shared PageUp board -- unscoped
  // by default (every CO city listed as a facet). Its own "Campus" dropdown
  // facet genuinely scopes to CCA's own "CentreTech Campus" (facet uid
  // 65e8dd318abe77b929bb1e7392bda66a), confirmed by reading the results
  // table directly: every row explicitly tagged "Campus: CentreTech Campus".
  // (The separate "CCA State Classified Positions" governmentjobs.com link
  // is a different, non-academic state-classified-staff board -- 0 faculty
  // titles -- so not used here.) CO dispatcher already has a "pageup" case
  // -- reused directly. Verified live (two fresh runs of the real dispatch
  // path): 3 real, CentreTech-Campus-scoped postings, incl. "Nursing Faculty
  // 9-Month" and "Criminal Justice Instructor".
  {
    campus: "Community College of Aurora",
    type: "pageup",
    url: "https://hr.cccs.edu/jobs/search/cc-of-aurora-search-page?dropdown_field_2_uids%5B%5D=65e8dd318abe77b929bb1e7392bda66a",
  },
  { campus: "Community College of Denver", type: "schooljobs", url: "https://www.schooljobs.com/careers/ccd" },
  { campus: "Denver Seminary", type: "generic", url: "https://www.denverseminary.edu/" },
  { campus: "Fort Lewis College", type: "generic", url: "https://www.fortlewis.edu/administrative-offices/human-resources/careers" },
  {
    campus: "Front Range Community College",
    type: "pageup",
    url: "https://hr.cccs.edu/jobs/search/front-range-cc-search-page?page=1&category_uids%5B%5D=8b81a67d3b6575ca9967476028f13b8a&query=",
  },
];

// OH (Ohio)
const OH_CAMPUSES = [
  {
    campus: "Ohio State University",
    type: "workday",
    url: "https://osu.wd1.myworkdayjobs.com/OSUCareers?timeType=38709af0feb60197596be2b9ff095800&jobFamilyGroup=67612469e2ea01a29e348f105b01ff10",
  },
  {
    campus: "University of Toledo",
    // Old Workday tenant now 500s on every request — Toledo migrated to
    // PageUp (same URL pattern already used for Seton Hall/Rowan).
    type: "pageup",
    url: "https://careers.utoledo.edu/cw/en-us/listing/",
  },
  {
    campus: "Ohio University",
    type: "peopleadmin",
    url: "https://www.ohiouniversityjobs.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&225=&query_position_type_id%5B%5D=2&commit=Search",
  },
  {
    campus: "Kent State University",
    type: "generic",
    url: "https://jobs.kent.edu/academics/faculty-jobs",
  },
  {
    campus: "Cleveland State University",
    type: "peopleadmin",
    // query_position_type_id[]=1 filters to Staff only, structurally excluding every
    // Faculty posting that exists on this exact same board under a different filter
    // value — dropped to rely on the downstream looksFacultyish filter instead.
    url: "https://hrjobs.csuohio.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&commit=Search",
  },
  {
    campus: "Wright State University",
    type: "generic",
    url: "https://jobs.wright.edu/",
  },
  {
    campus: "University of Cincinnati",
    type: "generic",
    url: "https://jobs.uc.edu/faculty-employment",
  },
  {
    campus: "Case Western Reserve University",
    type: "generic",
    url: "https://case.edu/hr/careers",
  },
  {
    campus: "University of Dayton",
    type: "generic",
    url: "https://employment.udayton.edu/",
  },
  {
    campus: "Oberlin College",
    type: "peopleadmin",
    url: "https://jobs.oberlin.edu/postings/search",
  },
  {
    campus: "Kenyon College",
    type: "generic",
    url: "https://careers.kenyon.edu/695/cw/en-us/subscribe",
  },
  {
    campus: "Denison University",
    type: "peopleadmin",
    url: "https://employment.denison.edu/postings/search",
  },
  { campus: "Cleveland Clinic Health System-School of Diagnostic Imaging", type: "generic", url: "https://www.clevelandclinic.org/sodi" },
  { campus: "Kent State University at Ashtabula", type: "generic", url: "https://www.kent.edu/employment" },
  { campus: "Kent State University at East Liverpool", type: "generic", url: "https://www.kent.edu/employment" },
  { campus: "Kent State University at Geauga", type: "generic", url: "https://www.kent.edu/employment" },
  { campus: "Kent State University at Salem", type: "generic", url: "https://www.kent.edu/employment" },
  { campus: "Kent State University at Stark", type: "generic", url: "https://www.kent.edu/employment" },
  { campus: "Kent State University at Trumbull", type: "generic", url: "https://www.kent.edu/trumbull" },
  { campus: "Kent State University at Tuscarawas", type: "generic", url: "https://www.kent.edu/employment" },
  { campus: "Miami University-Hamilton", type: "generic", url: "https://miamioh.edu/human-resources/jobs-and-careers" },
  { campus: "Miami University-Middletown", type: "generic", url: "https://miamioh.edu/human-resources/jobs-and-careers" },
  { campus: "Ohio University-Chillicothe Campus", type: "generic", url: "https://www.ohio.edu/chillicothe/" },
  { campus: "Ohio University-Eastern Campus", type: "generic", url: "https://www.ohio.edu/eastern/" },
  { campus: "Ohio University-Lancaster Campus", type: "generic", url: "https://www.ohiouniversityjobs.com/postings/search" },
  { campus: "Ohio University-Southern Campus", type: "generic", url: "https://www.ohio.edu/southern/" },
  { campus: "Ohio University-Zanesville Campus", type: "generic", url: "https://www.ohio.edu/zanesville/" },
  { campus: "Remington College-Cleveland Campus", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=8a43162b-bbe7-4cdf-af0d-a628a4f65790&ccId=9201027237045_2&lang=en_US&&source=EN&selectedMenuKey=CareerCenter" },
  { campus: "Firelands Regional Medical Center School of Nursing", type: "generic", url: "https://www.firelands.com/schoolofnursing" },
  { campus: "Rabbinical College Telshe", type: "generic", url: "https://independentrabbinicalcolleges.org/index.html" },
  { campus: "Toledo Public Schools Adult and Continuing Education", type: "generic", url: "https://www.tps.org/adult_education/barber_program" },
  { campus: "Air Force Institute of Technology-Graduate School of Engineering & Management", type: "generic", url: "https://www.afit.edu/" },
  { campus: "Allegheny Wesleyan College", type: "generic", url: "https://awc.edu/faculty/jobs" },
  { campus: "Antioch College", type: "generic", url: "https://antiochcollege.edu/about/employment/faculty-staff-jobs" },
  { campus: "Antioch University", type: "generic", url: "https://www.antioch.edu/employment" },
  { campus: "Antioch University-System Administration", type: "generic", url: "https://www.antioch.edu/employment" },
  { campus: "Art Academy of Cincinnati", type: "generic", url: "https://workforcenow.cloud.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=150d0044-7af0-4927-8f81-f24fc4a68331&ccId=19000101_000001&lang=en_US" },
  // Was the bare portal landing page. This is a white-labeled PeopleAdmin
  // instance on a custom domain — ATS-detection only recognizes the literal
  // peopleadmin.com hostname, so hand-off never fired. query_position_type_id[]=3
  // confirmed live as "Faculty Jobs" (id 4 = "Adjunct Faculty").
  { campus: "Ashland University", type: "peopleadmin", url: "https://jobs.ashland.edu/postings/search?query_position_type_id%5B%5D=3&commit=Search" },
  { campus: "Athenaeum of Ohio", type: "generic", url: "https://www.athenaeum.edu/" },
  // Was pointing at the bare homepage. Real employment page is
  // /inside-aultman/employment/job-opportunities, which links out to the
  // shared Aultman Health System careers portal (a HealthcareSource/symplr
  // SPA at pm.healthcaresource.com/CS/aultman) covering the hospital, AultCare,
  // and the college together. Confirmed via manual search on that portal: a
  // real current "ASSISTANT PROFESSOR" opening at "Aultman College" exists
  // today. Not wired further -- HealthcareSource/symplr has no existing
  // scraper function in server.js, and the portal is a hash-routed SPA with
  // no URL-parameter search (requires typing a keyword and clicking Search),
  // so it can't be reached by the existing generic-page or ATS-handoff logic.
  // Routed to the real employment page anyway for correctness, same as
  // Colorado State University Global in round 8.
  { campus: "Aultman College of Nursing and Health Sciences", type: "generic", url: "https://www.aultmancollege.edu/inside-aultman/employment/job-opportunities" },
  { campus: "Baldwin Wallace University", type: "generic", url: "https://www.bw.edu/about/hr/employment" },
  { campus: "Belmont College", type: "generic", url: "https://www.belmontcollege.edu/" },
  { campus: "Bluffton University", type: "generic", url: "https://www.bluffton.edu/employment" },
  { campus: "Bowling Green State University-Firelands", type: "generic", url: "https://www.bgsu.edu/firelands/employment" },
  { campus: "Bowling Green State University-Main Campus", type: "schooljobs", url: "https://www.schooljobs.com/careers/bgsu/faculty" },
  // Was pointing at the bare chain-wide homepage. Real ATS is a single
  // shared UltiPro/UKG board covering all 8 Bryant & Stratton branches
  // (191 total openings); its own text search ("?q=parma") genuinely scopes
  // results down to this campus specifically (9 results, incl. "Adjunct
  // Professor Various" -- confirmed via manual read of the page, not the
  // scraper). NOT wired as a working fix: this UltiPro board renders job
  // cards with no real per-job <a href> at all (every visible <a> on the
  // page is nav chrome/browser-download links), so the shared generic
  // scraper still yields 0 -- same card-based-SPA-no-anchor shape as other
  // UltiPro/UKG Recruiting tenants seen this round. URL updated anyway for
  // correctness/specificity over the old bare homepage.
  { campus: "Bryant & Stratton College-Parma", type: "generic", url: "https://recruiting.ultipro.com/BRY1002BSC/JobBoard/6b838b9a-cd2b-436a-903b-0de7b6e17b4f/?q=parma&o=postedDateDesc" },
  { campus: "Capital University", type: "generic", url: "https://capital.applicantpro.com/jobs" },
  { campus: "Cedarville University", type: "generic", url: "https://www.cedarville.edu/offices/human-resources" },
  // Was the home/landing page (just a "Search Jobs" link, no listings inline).
  { campus: "Central Ohio Technical College", type: "generic", url: "https://jobs.cotc.edu/postings/search" },
  { campus: "Central State University", type: "generic", url: "https://www.centralstate.edu/" },
  { campus: "Cincinnati College of Mortuary Science", type: "generic", url: "https://www.ccms.edu/academics/faculty-jobs" },
  { campus: "Cincinnati State Technical and Community College", type: "generic", url: "https://www.cincinnatistate.edu/news/faculty-assisted-at-healthcare-careers-camp-for-high-school-students" },
  { campus: "Clark State College", type: "schooljobs", url: "https://www.schooljobs.com/careers/clarkstate" },
  { campus: "Cleveland Institute of Art", type: "generic", url: "https://www.cia.edu/about-us/careers-at-cia" },
  { campus: "Cleveland Institute of Music", type: "generic", url: "https://www.cim.edu/" },
  { campus: "Collins Career Technical Center", type: "generic", url: "https://jobs.collins-cc.edu/" },
  { campus: "Columbus College of Art & Design", type: "generic", url: "https://ccad.applicantpro.com/jobs" },
  { campus: "Columbus State Community College", type: "generic", url: "https://www.cscc.edu/" },
  { campus: "Cuyahoga Community College District", type: "generic", url: "https://www.tri-c.edu/administrative-departments/human-resources/careers.html" },
  { campus: "Defiance College", type: "generic", url: "https://www.defiance.edu/employment-opportunities" },
  { campus: "Eastern Gateway Community College", type: "generic", url: "https://www.egcc.edu/" },
  { campus: "Edison State Community College", type: "generic", url: "https://www.edisonohio.edu/" },
  { campus: "Franciscan University of Steubenville", type: "generic", url: "https://www.franciscan.edu/" },
  { campus: "Franklin University", type: "generic", url: "https://www.franklin.edu/" },
];

// NM (New Mexico)
const NM_CAMPUSES = [
  {
    campus: "University of New Mexico",
    type: "csod",
    url: "https://unm.csod.com/ux/ats/careersite/18/home?c=unm",
  },
  {
    campus: "New Mexico State University",
    type: "generic",
    url: "https://careers.nmsu.edu/faculty/jobs",
  },
  {
    campus: "St. John's College (Santa Fe)",
    type: "generic",
    url: "https://www.sjc.edu/employment",
  },
  { campus: "Central New Mexico Community College", type: "workday", url: "https://chess.wd1.myworkdayjobs.com/CNMJOBS" },
  { campus: "Eastern New Mexico University Ruidoso Branch Community College", type: "generic", url: "https://www.ruidoso.enmu.edu/faculty/jobs" },
  { campus: "Eastern New Mexico University-Main Campus", type: "generic", url: "https://www.enmu.edu/about/employment-and-hr/employment-opportunities" },
  { campus: "Eastern New Mexico University-Roswell Campus", type: "generic", url: "https://www.roswell.enmu.edu/human-resources" },
];

// NV (Nevada)
const NV_CAMPUSES = [
  {
    campus: "University of Nevada, Reno",
    type: "workday",
    url: "https://nshe.wd1.myworkdayjobs.com/UNR-external",
  },
  {
    campus: "University of Nevada, Las Vegas",
    type: "workday",
    url: "https://nshe.wd1.myworkdayjobs.com/UNLV-external",
  },
  {
    campus: "Nevada State University",
    type: "workday",
    url: "https://nshe.wd1.myworkdayjobs.com/NSU-external",
  },
  { campus: "College of Southern Nevada", type: "generic", url: "https://www.csn.edu/" },
];

// UT (Utah)
const UT_CAMPUSES = [
  {
    campus: "University of Utah",
    type: "peopleadmin",
    url: "https://utah.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "Weber State University",
    type: "generic",
    url: "https://jobs.weber.edu/postings/search",
  },
  {
    campus: "Utah Valley University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/uvu",
  },
  {
    campus: "Southern Utah University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/suu",
  },
  {
    campus: "Utah Tech University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/utahtech",
  },
  {
    campus: "Utah State University",
    type: "icims",
    url: "https://careers-usu.icims.com/jobs/search?ss=1",
  },
  {
    campus: "Brigham Young University",
    type: "generic",
    url: "https://yjobs.byu.edu/",
  },
  {
    campus: "Westminster University (Utah)",
    type: "generic",
    url: "https://westminsteru.edu/about/offices/human-resources/open-positions/index.html",
  },
  { campus: "Ensign College", type: "generic", url: "https://www.ensign.edu/" },
];

// MI (Michigan)
const MI_CAMPUSES = [
  {
    campus: "Central Michigan University",
    type: "peopleadmin",
    url: "https://www.jobs.cmich.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=2&372=&734=&commit=Search",
  },
  {
    campus: "Eastern Michigan University",
    type: "nau-search",
    // employment_type_uids matched none of the live site's 4 current filter option
    // values (verified against the page's own checkbox markup) — a stale ID from a
    // past taxonomy change, same shape as the Northern Arizona University fix.
    // Unfiltered relies on the downstream global looksFacultyish filter instead.
    url: "https://careers.emich.edu/jobs/search?page=1&query=",
  },
  {
    campus: "Michigan Technological University",
    type: "enusfilter",
    url: "https://www.employment.mtu.edu/cw/en-us/filter/?search-keyword=&work-type=faculty",
  },
  {
    campus: "Michigan State University",
    type: "nau-search",
    url: "https://careers.msu.edu/jobs/search?page=1&category_uids%5B%5D=91b3c13e4059d1ed2af62eae49722dd2&employment_type_uids%5B%5D=30c2d65e1bff7c02a39b78266368afee&query=",
  },
  {
    campus: "Oakland University",
    type: "peopleadmin",
    url: "https://jobs.oakland.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&242=&243%5B%5D=1&query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "University of Michigan",
    type: "umich",
    url: "https://careers.umich.edu/search-jobs?career_interest=All&department=&field_job_modes_of_work_target_id=All&job_id=&keyword=professor&position=F&regular_temporary=R&title=&work_location=All&page=0",
  },
  {
    campus: "Wayne State University",
    type: "csod",
    url: "https://waynetalent.csod.com/ux/ats/careersite/2/home?c=waynetalent&cfdd[0][id]=73&cfdd[0][options][0]=86",
  },
  {
    campus: "Kalamazoo College",
    type: "kzoo-faculty",
    url: "https://provost.kzoo.edu/faculty-information/facultyjobs/",
  },
  {
    campus: "Western Michigan University",
    type: "peopleadmin",
    url: "https://www.wmujobs.org/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id[]=3&435=&commit=Search",
  },
  { campus: "Adrian College", type: "generic", url: "https://www.adrian.edu/about/human-resources/employment-opportunities" },
  { campus: "Albion College", type: "generic", url: "https://www.albion.edu/offices/human-resources/jobs" },
  { campus: "Alma College", type: "schooljobs", url: "https://www.schooljobs.com/careers/alma" },
  // Was pointing at the bare homepage. Real ATS is AppOne; routed to the
  // browse-by-category page which lists real anchors the generic scraper can
  // read. Verified live (2026-08-06): 14 real current postings, but every
  // teaching title is "Part Time Instructor..." which omitAdjunct's part-time
  // filter still excludes (by design) -- so this stays at 0 today, but any
  // future full-time faculty posting will now be caught.
  { campus: "Alpena Community College", type: "generic", url: "https://www.appone.com/Branding/ReqTemplate/BrowseAllJobsbyCategory.asp?Type=REQ&FromID=1&ClientID=4804&B_ID=44&JobCode=0&CountryID=3&LanguageID=2&servervar=alpenacc.appone.com" },
  { campus: "Andrews University", type: "generic", url: "https://www.andrews.edu/admres/jobs" },
  { campus: "Aquinas College", type: "generic", url: "https://www.aquinas.edu/" },
  // Was pointing at the bare homepage. Real ATS is isolvedhire (already
  // handled fine by the generic scraper when pointed directly at it, same
  // pattern as Arcadia University above). Verified live (two fresh page
  // loads): 11 postings, incl. real current Adjunct Faculty openings
  // (Adjunct Faculty - Psychology, Adjunct Faculty - Running Start Program - COM).
  { campus: "Baker College", type: "generic", url: "https://learnbaker.isolvedhire.com/" },
  { campus: "Bay de Noc Community College", type: "generic", url: "https://careers.baycollege.edu/" },
  { campus: "Bay Mills Community College", type: "generic", url: "https://bmcc.bamboohr.com/careers" },
  { campus: "Calvin Theological Seminary", type: "generic", url: "https://calvinseminary.edu/employment" },
  { campus: "Calvin University", type: "generic", url: "https://www.calvin.edu/" },
  { campus: "Cleary University", type: "generic", url: "https://www.cleary.edu/" },
  // Was pointing at a literal 404 ("No Results Found"). Real page is
  // /about-us/jobs-at-ccs/, with real current postings ("Adjunct
  // Instructors, Subject Matter Experts, Business Studies", "Adjunct
  // Faculty, Liberal Arts- Sustainability/Politics/AI Literacy"). BUT the
  // page is Divi-builder markup: each posting's real title lives in an
  // <h3 class="et_pb_module_header"> sibling, while the anchor itself just
  // says "Explore" -- the shared generic scraper's sibling-heading rescue
  // only looks inside li/article/card/etc. containers, and Divi's
  // et_pb_module/et_pb_column wrappers match none of those, so the rescue
  // never fires. Documented, not patched (shared logic) -- still a real
  // improvement over the 404 even though titles aren't extracted yet.
  { campus: "College for Creative Studies", type: "generic", url: "https://www.ccsdetroit.edu/about-us/jobs-at-ccs" },
  { campus: "Concordia University Ann Arbor", type: "generic", url: "https://www.cuaa.edu/" },
  // Was pointing at the bare homepage. Real page is
  // /about/employment/employment-applications/, a ClearCompany-powered
  // listing rendered as real same-domain anchors (not a cross-origin
  // embed), linked from the HR page as "Careers at CU". Verified live (two
  // fresh page loads): real faculty postings (Exercise Science
  // Affiliate/Adjunct Faculty, Marketing - Adjunct/Affiliate Faculty,
  // Computer Science Adjunct Faculty, Assistant/Associate Professor of
  // Computer Science, Assistant/Associate Professor of Engineering,
  // Professor of American Political Thought, Government, and History,
  // Dean-School of Education & Human Services).
  { campus: "Cornerstone University", type: "generic", url: "https://www.cornerstone.edu/about/employment/employment-applications/" },
  // Was pointing at the bare homepage; real employment page linked from nav.
  // Verified live: real infrastructure but "There are no open positions at
  // this time" -- 0 current openings, not a coverage bug.
  { campus: "Cranbrook Academy of Art", type: "generic", url: "https://cranbrookart.edu/employment-opportunities" },
  { campus: "Davenport University", type: "csod", url: "https://davenport.csod.com/ux/ats/careersite/15/home/requisition/2850?c=davenport" },
  { campus: "Delta College", type: "schooljobs", url: "https://www.schooljobs.com/careers/deltacollege/faculty" },
  { campus: "Ecumenical Theological Seminary", type: "generic", url: "https://www.etseminary.edu/faculty/jobs" },
  { campus: "Ferris State University", type: "generic", url: "https://www.ferris.edu/" },
];

// IL (Illinois)
const IL_CAMPUSES = [
  // Was correctly wired as "peoplesoft-fluid" back on 2026-07-21 (commit
  // a97b6fa6, 27 real faculty postings surfaced), but an automated weekly
  // "institution discovery" re-probe (commit cbd6f368, 2026-07-25) silently
  // reset the type to "generic" -- the probe's platform classifier defaults
  // to "generic" whenever it doesn't recognize a URL's ATS signature, and at
  // the time it unconditionally trusted that guess over whatever type was
  // already configured. That exact bug was found and fixed on 2026-08-03
  // (commit 6cd8c30b: apply-promotion-candidates-to-server.js now never lets
  // the probe downgrade an existing specialized type back to "generic"),
  // which also restored 14 other institutions it had reverted -- but
  // Northwestern wasn't among the ones that remediation pass caught, so it
  // sat silently broken for another 4 days until this round found it.
  // Re-verified live 2026-08-07 (round 19): the PeopleSoft Fluid Candidate
  // Gateway still works with the exact mechanism scrapePeopleSoftFluidAs
  // implements (cookie-priming double load, then "View All Jobs") -- landed
  // on "485 jobs found" with a Faculty facet showing 170, incl. real
  // postings "Assistant Professor in Economics" and "Assistant Professor of
  // Modern Japanese History". Restored to "peoplesoft-fluid". Worth a
  // separate audit for any other pre-2026-08-03 casualties of this same
  // now-fixed bug that the original remediation pass also missed.
  {
    campus: "Northwestern University",
    type: "peoplesoft-fluid",
    url: "https://careers.northwestern.edu/psc/hrnu_er/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB&Action=U&FOCUS=Applicant&SiteId=1&",
  },
  {
    campus: "University of Chicago",
    type: "generic",
    url: "https://www.uchicago.edu/careers",
  },
  {
    campus: "Chicago State University",
    type: "peopleadmin",
    url: "https://chicagostate.peopleadmin.com/postings/search?query=&query_posted_at=&142=&query_organizational_tier_3_id=any&query_position_type_id=2&commit=Search",
  },
  {
    campus: "Eastern Illinois University",
    type: "generic",
    url: "https://www.eiu.edu/careers/faculty",
  },
  {
    campus: "Governors State University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/govst",
  },
  {
    // Site migrated off the old /en-us/filter path (now 404s) to a new
    // Clinch-powered /jobs/search page; the generic anchor-pattern extraction
    // in scrapeEnUsFilterSite still works fine against it, just needed the
    // current URL. Verified live: real faculty postings render (Assistant
    // Professor of Marketing/Accounting, etc).
    campus: "Illinois State University",
    type: "enusfilter",
    url: "https://jobsearch.illinoisstate.edu/jobs/search?category=Faculty",
  },
  {
    campus: "University of Illinois Chicago",
    type: "csod",
    url: "https://uic.csod.com/ux/ats/careersite/1/home?c=uic&cfdd[0][id]=192&cfdd[0][options][0]=1161&cfdd[1][id]=250&cfdd[1][options][0]=1856",
  },
  {
    campus: "University of Illinois Springfield",
    type: "csod",
    url: "https://uis.csod.com/ux/ats/careersite/1/home?c=uis",
  },
  {
    campus: "University of Illinois Urbana-Champaign",
    type: "csod",
    url: "https://illinois.csod.com/ux/ats/careersite/1/home?c=illinois&cfdd[0][id]=276&cfdd[0][options][0]=849",
  },
  // NEIU has no single faculty jobs board — postings are split across each
  // college's own page (the site's own "Faculty Employment Opportunities" hub
  // just links out to these four; scraping the hub itself only finds those
  // four link tiles, not the real postings behind them).
  {
    campus: "Northeastern Illinois University",
    type: "generic",
    url: "https://www.neiu.edu/academics/colleges-departments/arts-and-sciences/administrative-resources/faculty-employment-opportunities",
  },
  {
    campus: "Northeastern Illinois University",
    type: "generic",
    url: "https://www.neiu.edu/academics/colleges-departments/business-and-technology/about-us/faculty-employment-opportunities",
  },
  {
    campus: "Northeastern Illinois University",
    type: "generic",
    url: "https://www.neiu.edu/academics/colleges-departments/education/employment-opportunities",
  },
  {
    campus: "Northeastern Illinois University",
    type: "generic",
    url: "https://www.neiu.edu/libraries/about-neiu-libraries/neiu-libraries-jobs",
  },
  {
    campus: "Knox College",
    type: "knox-faculty",
    url: "https://www.knox.edu/employment-at-knox/faculty",
  },
  {
    campus: "Northern Illinois University",
    type: "peopleadmin",
    url: "https://employment.niu.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "Southern Illinois University Carbondale",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/siu",
  },
  {
    campus: "Southern Illinois University Edwardsville",
    type: "interfolio",
    url: "https://apply.interfolio.com/69563/positions",
  },
  {
    campus: "Western Illinois University",
    type: "interviewexchange",
    url: "https://wiu.interviewexchange.com/static/clients/467WIM1/index.jsp?c=1098",
  },
  { campus: "City Colleges of Chicago-Harold Washington College", type: "generic", url: "https://www.ccc.edu/colleges/washington/Pages/default.aspx" },
  { campus: "City Colleges of Chicago-Harry S Truman College", type: "generic", url: "https://www.ccc.edu/colleges/truman/Pages/default.aspx" },
  { campus: "City Colleges of Chicago-Kennedy-King College", type: "generic", url: "https://www.ccc.edu/colleges/kennedy/pages/default.aspx" },
  { campus: "City Colleges of Chicago-Malcolm X College", type: "generic", url: "https://www.ccc.edu/colleges/malcolm-x/pages/default.aspx" },
  { campus: "City Colleges of Chicago-Olive-Harvey College", type: "generic", url: "https://www.ccc.edu/colleges/olive-harvey/Pages/default.aspx" },
  { campus: "City Colleges of Chicago-Richard J Daley College", type: "generic", url: "https://www.ccc.edu/colleges/daley/pages/default.aspx" },
  { campus: "City Colleges of Chicago-Wilbur Wright College", type: "generic", url: "https://www.ccc.edu/colleges/wright/pages/default.aspx" },
  { campus: "Frontier Community College", type: "generic", url: "https://iecc.edu/jobs" },
  // Shared district-wide Illinois Eastern Community Colleges listings page
  // (4 campuses + district office on one page). Scoped via the page's own
  // per-campus <h3> header immediately preceding each campus's <ul> of
  // postings (see scrapeIeccCampusJobs) -- verified live against the raw DOM:
  // "Lincoln Trail College Campus, Robinson, IL" section has its own real
  // posting "Nursing Instructor" (part-time), distinct filename/href from
  // every other campus's postings.
  {
    campus: "Lincoln Trail College",
    type: "iecc-campus",
    url: "https://iecc.edu/jobs",
    locationFilter: "Lincoln Trail College Campus",
  },
  // Real ATS is the same shared Workday tenant already established for The
  // Chicago School at Los Angeles / San Diego (tcsedsystem.wd1.myworkdayjobs.com/
  // TCSPP) -- confirmed via a direct POST to its /wday/cxs/tcsedsystem/TCSPP/jobs
  // endpoint that "Chicago, IL" has its own facet id, distinct from the
  // "The Chicago School - Chicago - 400 S Jefferson St" building-level facet.
  // Scoped with the city-level facet. Verified live: 12 postings, all
  // Chicago-tagged, incl. 8 real "Adjunct Faculty - <program> - Chicago
  // Campus" titles (School Psychology, Forensic Psychology, Applied
  // Behavior Analysis, Counseling Psychology, IO/Business Psychology,
  // Counselor Education, BA Psychology, Clinical Psychology).
  {
    campus: "The Chicago School at Chicago",
    type: "workday",
    url: "https://tcsedsystem.wd1.myworkdayjobs.com/TCSPP?locations=0cec31c30163012adcba00e1e0494f00",
  },
  // Same shared IECC district-wide page as Lincoln Trail College above,
  // scoped to Wabash Valley's own <h3> header. Verified live against the raw
  // DOM: "Wabash Valley College Campus, Mt. Carmel, IL" section has its own
  // real postings "Physical Therapist Assistant Program Instructor" (both
  // full- and part-time listings) and "English as a Second Language
  // Instructor" (part-time), each with a distinct WVC_-prefixed filename,
  // not shared with Lincoln Trail College's LTC_-prefixed postings.
  {
    campus: "Wabash Valley College",
    type: "iecc-campus",
    url: "https://iecc.edu/jobs",
    locationFilter: "Wabash Valley College Campus",
  },
  { campus: "William Rainey Harper College", type: "generic", url: "https://jobs.harpercollege.edu/" },
  { campus: "NorthShore University HealthSystem School of Nurse Anesthesia", type: "generic", url: "https://www.northshore.org/academics/other-programs/school-of-nurse-anesthesia/" },
  // Was pointing at the college's own hshs.org landing page, which has no
  // job listings of its own -- real hiring runs through parent system
  // Hospital Sisters Health System's shared Workday tenant
  // (hshs.wd1.myworkdayjobs.com/hshscareers). That tenant has its own
  // "College of Nursing" jobFamily facet (confirmed via a direct POST to
  // its /wday/cxs/hshs/hshscareers/jobs endpoint), scoped with this exact
  // id, cleanly separating St. John's College faculty postings from the
  // health system's ~300+ clinical/hospital postings. Verified live: 2
  // real postings, both Springfield, IL -- "Assistant Professor" and
  // "Academic Faculty-Adjunct".
  {
    campus: "St. John's College-Department of Nursing",
    type: "workday",
    url: "https://hshs.wd1.myworkdayjobs.com/hshscareers?jobFamily=e93b80864cb90101b5c01ffb33ea0000",
  },
  { campus: "Adler University", type: "generic", url: "https://www.adler.edu/about/careers" },
  { campus: "American Islamic College", type: "generic", url: "https://aicusa.edu/about/employment" },
  { campus: "Augustana College", type: "generic", url: "https://www.augustana.edu/jobs" },
  { campus: "Aurora University", type: "schooljobs", url: "https://www.schooljobs.com/careers/aurorauniversity?jobType[0]=Full-Time%20Faculty&sort=PositionTitle%7CAscending" },
  { campus: "Benedictine University", type: "generic", url: "https://www.benedictine.edu/jobs" },
  // Was pointing at the bare homepage (no careers link visible in nav). Real
  // page is /job-opportunities, linked from the homepage footer. Verified
  // live: real per-posting anchors exist, but it's mostly a clearinghouse of
  // external church placements (Rector, Chaplain, etc.) for alumni/
  // seminarians, not the seminary's own faculty hiring -- only one genuinely
  // internal posting seen ("Director of Philanthropy: Bexley Seabury
  // Seminary"), and no faculty-titled postings currently. Routed to it
  // anyway since it's the closest thing to a real careers page this
  // institution has.
  { campus: "Bexley Hall Seabury Western Theological Seminary Federation, Inc.", type: "generic", url: "https://bexleyseabury.edu/job-opportunities" },
  // Was pointing at the bare careers landing page (no per-posting anchors,
  // just links out to the real ATS). Real board is a NEOGOV/schooljobs
  // tenant, split into "Full-Time Faculty Jobs" and "Adjunct Faculty Jobs"
  // sub-boards from that page -- used the unfiltered base board instead so
  // both are covered by the existing looksFacultyish/omitAdjunct filters,
  // same convention as other schooljobs entries. Verified live: 5 real
  // full-time postings (e.g. "FT Nursing Faculty", "Full-time Court
  // Reporting Faculty") plus 16 real adjunct postings (e.g. "Adjunct
  // Faculty - Applied Music Instructor (Piano)").
  { campus: "Black Hawk College", type: "schooljobs", url: "https://www.schooljobs.com/careers/bhcedu" },
  // Was pointing at the bare homepage. Real careers page is /jobs, linked
  // from the homepage. Verified live: real per-posting anchors, incl. a
  // real current "Adjunct Faculty Positions" opening.
  { campus: "Blackburn College", type: "generic", url: "https://blackburn.edu/jobs/" },
  { campus: "Blessing Rieman College of Nursing and Health Sciences", type: "generic", url: "https://www.brcn.edu/" },
  // Was pointing at the bare homepage. Real HR page links to three separate
  // ADP recruitment categories (faculty/non-faculty/student-worker); this is
  // the faculty-specific one. IL dispatcher had no "adp" case yet even
  // though scrapeAdpAs/scrapeAdpApi already exist and are dispatched
  // elsewhere (e.g. FL) -- added one below, following FL's exact call
  // convention.
  { campus: "Bradley University", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=df6f93d4-2277-4999-ac63-88a55668ffd3&ccId=9200110706773_2&type=JS&lang=en_US" },
  { campus: "Carl Sandburg College", type: "generic", url: "https://www.sandburg.edu/about/administration/employment-human-resources.html" },
  { campus: "Catholic Theological Union at Chicago", type: "generic", url: "https://ctu.edu/jobs" },
  // Was pointing at the bare homepage -- no self-hosted careers/employment
  // page exists anywhere on ctschicago.edu (confirmed: /employment,
  // /careers, /jobs, and several /about/* variants all 404; the WordPress
  // sitemap's own "jobs" custom-post-type feed is a community job board CTS
  // runs for outside churches/ministries seeking pastors, not CTS's own
  // hiring -- "Senior Minister", "Pastor", "Chaplain" postings for other
  // congregations, last updated 2024). Real (if currently empty) listing
  // lives on HigherEdJobs (same University= convention already used for
  // Edward Waters University / American Academy of Dramatic Arts above).
  // Verified live: real infrastructure ("Chicago Theological Seminary"
  // search criteria correctly applied) but "No matching positions found" --
  // 0 current openings, not a coverage bug.
  { campus: "Chicago Theological Seminary", type: "generic", url: "https://www.higheredjobs.com/institution/search.cfm?University=Chicago+Theological+Seminary&suggest=3" },
  { campus: "City Colleges of Chicago-District Office", type: "generic", url: "https://www.ccc.edu/" },
  { campus: "College of DuPage", type: "csod", url: "https://cod.csod.com/ux/ats/careersite/4/home?c=cod" },
  { campus: "College of Lake County", type: "generic", url: "https://www.clcillinois.edu/" },
  { campus: "Columbia College Chicago", type: "generic", url: "https://www.colum.edu/faculty/jobs" },
  { campus: "Concordia University-Chicago", type: "generic", url: "https://cuchicago.applicantpro.com/jobs" },
  { campus: "Danville Area Community College", type: "generic", url: "https://dacc.edu/hr/employment" },
  { campus: "DePaul University", type: "generic", url: "https://www.depaul.edu/" },
  { campus: "Dominican University", type: "generic", url: "https://www.dom.edu/" },
  { campus: "East-West University", type: "generic", url: "https://www.eastwest.edu/" },
  { campus: "Elgin Community College", type: "generic", url: "https://elgin-community-college.career-pages.com/ecc-careers-elgin-community-college" },
  { campus: "Elmhurst University", type: "generic", url: "https://apply.workable.com/elmhurst-edu" },
  { campus: "Erikson Institute", type: "generic", url: "https://www.erikson.edu/careers" },
  { campus: "Eureka College", type: "generic", url: "https://www.eureka.edu/employment" },
];

// ID (Idaho)
const ID_CAMPUSES = [
  {
    campus: "University of Idaho",
    type: "peopleadmin",
    url: "https://uidaho.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=2&commit=Search",
  },
  {
    campus: "Boise State University",
    type: "enusfilter",
    url: "https://jobs.boisestate.edu/en-us/filter/?job-mail-subscribe-privacy=agree&search-keyword=&work-type=faculty",
  },
  {
    campus: "Idaho State University",
    type: "csod",
    url: "https://isu.csod.com/ux/ats/careersite/5/home?c=isu",
  },
  {
    campus: "Lewis-Clark State College",
    type: "generic",
    url: "https://lcsc.applicantpro.com/jobs",
  },
  {
    campus: "The College of Idaho",
    type: "generic",
    url: "https://collegeofidaho.edu/careers/",
  },
  {
    campus: "Northwest Nazarene University",
    type: "generic",
    url: "https://recruiting.paylocity.com/recruiting/jobs/All/dc628dad-def7-40c4-a8e8-46445f141a37/Northwest-Nazarene-University-Inc",
  },
  { campus: "Boise Bible College", type: "generic", url: "https://www.boisebible.edu/" },
  { campus: "Brigham Young University-Idaho", type: "generic", url: "https://www.byui.edu/human-resources/employment" },
  { campus: "College of Eastern Idaho", type: "schooljobs", url: "https://www.schooljobs.com/careers/cei" },
  { campus: "College of Southern Idaho", type: "generic", url: "https://www.csi.edu/" },
  { campus: "College of Western Idaho", type: "pageup", url: "https://careers.cwi.edu/cw/en-us/listing/" },
];

// IN (Indiana)
const IN_CAMPUSES = [
  {
    campus: "Indiana University",
    type: "peopleadmin",
    url: "https://indiana.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "Indiana State University",
    type: "peopleadmin",
    url: "https://jobs.indstate.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=2&commit=Search",
  },
  {
    campus: "Ball State University",
    type: "peopleadmin",
    url: "https://bsu.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=3&commit=Search",
  },
  {
    campus: "University of Southern Indiana",
    type: "generic",
    url: "https://www.usi.edu/hr/careers-at-usi",
  },
  {
    campus: "Purdue University",
    type: "generic",
    url: "https://careers.purdue.edu/go/Faculty/7721500/",
  },
  {
    campus: "University of Notre Dame",
    type: "generic",
    url: "https://jobs.nd.edu/",
  },
  {
    campus: "Butler University",
    type: "workday",
    url: "https://butler.wd5.myworkdayjobs.com/BUJobs",
  },
  {
    campus: "DePauw University",
    type: "workday",
    url: "https://depauw.wd5.myworkdayjobs.com/DePauw_University",
  },
  {
    campus: "Wabash College",
    type: "generic",
    url: "https://www.wabash.edu/employment/",
  },
  {
    campus: "Earlham College",
    type: "adp-career-center",
    url: "https://hr.earlham.edu/careers",
  },
  { campus: "Marian University-Ancilla", type: "generic", url: "https://www.marian.edu/faculty/jobs" },
  { campus: "Trine University-Regional/Non-Traditional Campuses", type: "generic", url: "https://www.trine.edu/human-resources/careers/index.aspx/faculty" },
  { campus: "Anabaptist Mennonite Biblical Seminary", type: "generic", url: "https://www.ambs.edu/employment" },
  { campus: "Bethany Theological Seminary", type: "generic", url: "https://www.bethanyseminary.edu/" },
  // Was pointing at the bare homepage; real ATS is Paylocity (already handled
  // fine by the generic scraper when pointed directly at it, same pattern as
  // Arkansas Colleges of Health Education / Freed-Hardeman University /
  // Northwest Nazarene University). Verified live (two fresh page loads):
  // 4 postings incl. "Adjunct Instructor - Composition".
  { campus: "Calumet College of Saint Joseph", type: "generic", url: "https://recruiting.paylocity.com/recruiting/jobs/All/d3b73b32-f518-47ab-82f7-ac57a8a45ce4/Calumet-College" },
  { campus: "Christian Theological Seminary", type: "generic", url: "https://www.cts.edu/careers" },
  // Was pointing at the bare homepage. Real employment page
  // (ctsfw.edu/about/who-we-are/employment/) links to this institution-
  // specific Paylocity recruiting tenant. Verified live: currently "Sorry,
  // there are currently no jobs matching this criteria" -- genuinely 0 open
  // postings right now, but this is the correct, working, institution-
  // scoped ATS (same platform/pattern as Freed-Hardeman University, already
  // scraped fine as "generic" with no special dispatch needed) so future
  // postings will be picked up once they're listed.
  { campus: "Concordia Theological Seminary", type: "generic", url: "https://recruiting.paylocity.com/recruiting/jobs/All/07aeeac2-22ba-48be-81e4-96e31b9ef75b/Concordia-Theological-Seminary" },
  { campus: "Franklin College", type: "generic", url: "https://franklincollege.edu/about/key-offices/office-of-human-resources/employment-opportunities" },
];

// WV (West Virginia)
const WV_CAMPUSES = [
  {
    campus: "West Virginia University",
    type: "taleo",
    url: "https://wvu.taleo.net/careersection/faculty/jobsearch.ftl?lang=en",
  },
  {
    campus: "Marshall University",
    type: "peopleadmin",
    url: "https://marshall.peopleadmin.com/postings/search",
  },
  {
    campus: "West Virginia State University",
    type: "generic",
    url: "https://wvstateu.edu/news/faculty-and-staff-opening-week-schedule-of-events",
  },
  {
    campus: "University of Charleston",
    type: "generic",
    url: "https://www.ucwv.edu/employment/",
  },
  {
    campus: "West Virginia Wesleyan College",
    type: "generic",
    url: "https://www.wvwc.edu/jobs?faculty",
  },
  { campus: "Mercer County Technical Education Center", type: "generic", url: "https://mercercountyschools.sites.thrillshare.com/o/mctec" },
  { campus: "West Virginia University Hospital Departments of Rad Tech and Nutrition", type: "generic", url: "https://wvumedicine.org/radtech" },
  { campus: "Appalachian Bible College", type: "generic", url: "https://abc.edu/" },
  // Was pointing at the about/employment page, which only links out (no
  // per-posting anchors of its own). Real per-posting listing lives on
  // HigherEdJobs (same pattern already used for Edward Waters University).
  // Verified live: 3 real current postings (Head Softball Coach, Plumber,
  // First Year Advisor/Learning Specialist) -- none faculty-titled today, so
  // this stays at 0, but future faculty postings will now be caught.
  { campus: "Bethany College", type: "generic", url: "https://www.higheredjobs.com/institution/search.cfm?aID=2641" },
  { campus: "Blue Ridge Community and Technical College", type: "generic", url: "https://www.blueridgectc.edu/" },
  { campus: "Bluefield State University", type: "generic", url: "https://bluefieldstate.edu/" },
  { campus: "BridgeValley Community & Technical College", type: "generic", url: "https://www.bridgevalley.edu/" },
  { campus: "Carver Career Center", type: "generic", url: "https://www.carvercareercenter.edu/" },
  { campus: "Catholic International University", type: "generic", url: "https://catholiciu.edu/employment-opportunities" },
  { campus: "Concord University", type: "generic", url: "https://www.concord.edu/" },
  { campus: "Davis & Elkins College", type: "generic", url: "https://www.dewv.edu/" },
  { campus: "Eastern West Virginia Community and Technical College", type: "generic", url: "https://easternwv.edu/employment-opportunities" },
  { campus: "Fairmont State University", type: "generic", url: "https://www.fairmontstatejobs.com/" },
  { campus: "Fred W Eberle Technical Center", type: "generic", url: "https://fetc.edu/" },
];

// TX (Texas)
const TX_CAMPUSES = [
  {
    campus: "University of Texas at Austin",
    type: "workday",
    url: "https://utaustin.wd1.myworkdayjobs.com/UTstaff",
  },
  {
    campus: "Texas A&M University",
    type: "tamu-faculty",
    url: "https://faculty.tamu.edu/Positions",
  },
  {
    campus: "University of Houston",
    type: "nau-search",
    url: "https://careers.uh.edu/jobs/search",
  },
  {
    campus: "Texas Tech University",
    type: "workday",
    url: "https://ttu.wd5.myworkdayjobs.com/TTU",
  },
  {
    campus: "University of Texas at Dallas",
    type: "peopleadmin",
    url: "https://jobs.utdallas.edu/postings/search",
  },
  {
    campus: "University of Texas at Arlington",
    type: "peopleadmin",
    url: "https://uta.peopleadmin.com/postings/search",
  },
  {
    campus: "University of Texas at San Antonio",
    type: "peoplesoft-hrs",
    url: "https://zahr-prd-candidate-ada.utshare.utsystem.edu/psc/ZAHRPRDADA/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?FOCUS=Applicant&Page=HRS_APP_SCHJOB&Action=U&FOCUS=Applicant&SiteId=21",
  },
  {
    campus: "University of North Texas",
    type: "generic",
    url: "https://careers.untsystem.edu/jobs/search/search-page-unt-faculty",
  },
  {
    campus: "Rice University",
    type: "peopleadmin",
    url: "https://jobs.rice.edu/postings/search",
  },
  {
    campus: "Baylor University",
    type: "interfolio-inst",
    url: "https://apply.interfolio.com/55109/positions",
  },
  {
    campus: "Southern Methodist University",
    type: "generic",
    url: "https://www.smu.edu/businessfinance/hr/workingatsmu/faculty-careers",
  },
  {
    campus: "Texas Christian University",
    type: "nau-search",
    url: "https://jobs.tcu.edu/jobs/search/faculty-jobs",
  },
  {
    campus: "Trinity University",
    type: "workday",
    url: "https://trinity.wd1.myworkdayjobs.com/en-US/Trinity_University?jobFamilyGroup=d065843291d601021156859e24a40000",
  },
  {
    campus: "Southwestern University",
    type: "generic",
    url: "https://www.southwestern.edu/human-resources/career-opportunities/",
  },
  {
    campus: "Texas State University",
    type: "peopleadmin",
    url: "https://jobs.hr.txstate.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=3&query_position_type_id%5B%5D=4&435=&commit=Search",
  },
  {
    campus: "University of Texas at El Paso",
    type: "interviewexchange",
    url: "https://utep.interviewexchange.com/static/clients/533UTM1/index.jsp",
  },
  { campus: "Abilene Christian University-Undergraduate Online", type: "generic", url: "https://www.acu.edu/academics/online/undergraduate" },
  { campus: "Alamo Community College District Central Office", type: "generic", url: "https://alamo.edu/district/" },
  { campus: "Dallas College", type: "generic", url: "https://careers.dallascollege.edu/us/en/faculty-jobs" },
  { campus: "Laredo College", type: "schooljobs", url: "https://www.schooljobs.com/careers/laredoedu?examType%5B0%5D=Faculty&sort=PostingDate%7CDescending" },
  { campus: "Northeast Lakeview College", type: "generic", url: "https://www.alamo.edu/nlc" },
  { campus: "Northwest Vista College", type: "generic", url: "https://alamo.edu/nvc/" },
  { campus: "Palo Alto College", type: "csod", url: "https://alamo.csod.com/ats/careersite/search.aspx?site=18&c=alamo" },
  { campus: "Remington College-Dallas Campus", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=8a43162b-bbe7-4cdf-af0d-a628a4f65790&ccId=9201027207438_2&lang=en_US&&source=EN&selectedMenuKey=CareerCenter" },
  { campus: "Remington College-Fort Worth Campus", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=8a43162b-bbe7-4cdf-af0d-a628a4f65790&ccId=9201027237235_2&lang=en_US&&source=EN&selectedMenuKey=CareerCenter" },
  { campus: "Remington College-Houston Southeast Campus", type: "generic", url: "https://www.remingtoncollege.edu/locations/houston/webster/" },
  { campus: "Remington College-North Houston Campus", type: "generic", url: "https://www.remingtoncollege.edu/locations/houston/greenspoint/" },
  { campus: "Remington College-Online Dallas", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=8a43162b-bbe7-4cdf-af0d-a628a4f65790&ccId=9201027234110_2&lang=en_US&&source=EN&selectedMenuKey=CareerCenter" },
  { campus: "San Antonio College", type: "csod", url: "https://alamo.csod.com/ats/careersite/search.aspx?site=12&c=alamo" },
  { campus: "Southwest College for the Deaf", type: "generic", url: "https://howardcollege.edu/swcd/" },
  { campus: "St Philip's College", type: "generic", url: "https://www.alamo.edu/spc/" },
  { campus: "The Chicago School at Dallas", type: "generic", url: "https://www.thechicagoschool.edu/in-the-community/careers" },
  { campus: "The Chicago School-College of Nursing", type: "generic", url: "https://www.thechicagoschool.edu/in-the-community/careers" },
  { campus: "Covenant School of Nursing and Allied Health", type: "generic", url: "https://covenanthealth.org/cson" },
  { campus: "Abilene Christian University", type: "workday", url: "https://acu.wd108.myworkdayjobs.com/ACUCareers" },
  { campus: "Alvin Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/alvincollege" },
  { campus: "Amarillo College", type: "generic", url: "https://www.actx.edu/" },
  { campus: "Amberton University", type: "generic", url: "https://amberton.edu/careers" },
  { campus: "Angelina College", type: "generic", url: "https://www.angelina.edu/" },
  { campus: "Angelo State University", type: "generic", url: "https://www.angelo.edu/" },
  // Was pointing at the bare homepage. Real careers page is /careers, linked
  // from the main nav. Verified live: real page, but "Current Open
  // Positions" is just an evergreen Populi application form ("ABU CAREERS
  // APPLY HERE") with no actual per-posting job board -- the only listed
  // item is an external church childcare job, not a university faculty
  // posting. Routed to it anyway for correctness; will structurally rarely
  // produce a link-based posting for the generic scraper to catch.
  { campus: "Arlington Baptist University", type: "generic", url: "https://abu.edu/careers" },
  // Was pointing at the bare homepage (no careers link in top nav). Real
  // page is /human-resources/careers, linked from /human-resources, with
  // real per-posting anchors (/details/~board/jobs/post/...). Verified live:
  // real page, 5 current openings (Head Softball Coach, Warehouse
  // Coordinator, Assistant Director of Admission, Mailing & Printing
  // Services Assistant, Associate VP for Institutional Advancement) -- none
  // currently faculty-titled (the page has its own "FACULTY POSITIONS"
  // filter category, just empty right now), but this is real, correct
  // infrastructure vs. a homepage that will never show anything.
  { campus: "Austin College", type: "generic", url: "https://www.austincollege.edu/human-resources/careers" },
  { campus: "Austin Community College District", type: "generic", url: "https://www.austincc.edu/" },
  { campus: "Austin Presbyterian Theological Seminary", type: "generic", url: "https://www.austinseminary.edu/about/employment-opportunities" },
  { campus: "Bakke Graduate University", type: "generic", url: "https://www.bgu.edu/" },
  { campus: "Baptist Missionary Association Theological Seminary", type: "generic", url: "https://www.bmats.edu/" },
  { campus: "Baptist University of the Americas", type: "generic", url: "https://www.bua.edu/about/employment-opportunities" },
  { campus: "Baylor College of Medicine", type: "generic", url: "https://www.bcm.edu/" },
  { campus: "Blinn College District", type: "generic", url: "https://www.blinn.edu/" },
  // Was pointing at the bare homepage. Homepage links to "Employment
  // Opportunities" (employment.brazosport.edu), which redirects to this
  // institution-specific Paycom tenant. Not left as "generic": the Paycom
  // SPA's job cards mash the title + employment-type + full description
  // into one anchor's textContent ending in "..." (a truncated blurb), which
  // trips the shared generic scraper's truncated-title rejection on every
  // single card; the ATS-handoff fallback that kicks in afterward has no
  // paycom-specific URL normalizer (unlike workday's), so it hands off to
  // whichever single job's *detail* URL it grabbed first instead of the
  // listing root, and scrapePaycomAs then finds 0 postings on that one-job
  // page. Calling scrapePaycomAs directly against the listing URL avoids
  // both problems (it has its own smarter title-splitting logic). TX
  // dispatcher had no "paycom" case yet -- added below. Verified live (two
  // fresh page loads): 9 real postings after the shared adjunct/part-time
  // filter, including "ADN FACULTY" (full-time) and "FFACULTY - INDUSTRIAL &
  // COMMERCIAL CONSTRUCTION MANAGEMENT FACULTY" (full-time).
  {
    campus: "Brazosport College",
    type: "paycom",
    url: "https://www.paycomonline.net/v4/ats/web.php/portal/C3B2B056DC3ED5A1D17132585A7FF495/career-page",
  },
  { campus: "Brite Divinity School", type: "generic", url: "https://www.brite.edu/" },
  { campus: "Central Texas College", type: "generic", url: "https://www.ctcd.edu/" },
  { campus: "Christ Mission College", type: "generic", url: "https://cmctx.edu/" },
  { campus: "Cisco College", type: "generic", url: "https://www.cisco.edu/" },
  { campus: "Clarendon College", type: "generic", url: "https://www.clarendoncollege.edu/" },
  { campus: "Coastal Bend College", type: "generic", url: "https://www.coastalbend.edu/" },
  { campus: "College of Biblical Studies-Houston", type: "generic", url: "https://cbshouston.edu/" },
  // Was pointing at the bare PeopleAdmin homepage, which only has a "Faculty"
  // nav link to the real search-results page, not a listing itself -- routed
  // directly to that Faculty-filtered search results page. TX dispatcher
  // already has a "peopleadmin" case -- reused directly. Verified live (two
  // fresh page loads): 80 real current faculty/adjunct postings (Adjunct
  // Anatomy & Physiology Instructor, Adjunct English Instructor, Assistant
  // Professor of Theatre Design and Technology, etc.).
  {
    campus: "College of the Mainland",
    type: "peopleadmin",
    url: "https://jobs.com.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id=3&435=&query_organizational_tier_3_id=any&commit=Search",
  },
  { campus: "Collin County Community College District", type: "generic", url: "https://www.collin.edu/hr/employment" },
  { campus: "Commonwealth Institute of Funeral Service", type: "generic", url: "https://commonwealth.edu/commonwealth-careers" },
  { campus: "Concordia University Texas", type: "generic", url: "https://www.concordia.edu/" },
  { campus: "Criswell College", type: "generic", url: "https://www.criswell.edu/" },
  { campus: "Dallas Baptist University", type: "generic", url: "https://recruiting.adp.com/srccar/public/RTI.home?c=1174615&d=DBUCareerSite" },
  { campus: "Dallas Christian College", type: "generic", url: "https://www.dallas.edu/" },
  { campus: "Dallas Institute of Funeral Service", type: "generic", url: "https://www.dallasinstitute.edu/" },
  { campus: "Dallas Theological Seminary", type: "generic", url: "https://www.dts.edu/" },
  { campus: "Del Mar College", type: "generic", url: "https://www.delmar.edu/" },
  { campus: "East Texas A&M University", type: "generic", url: "https://www.etamu.edu/human-resources/employment" },
  { campus: "East Texas Baptist University", type: "generic", url: "https://www.etbu.edu/info-for/faculty-and-staff/human-resources/employment-opportunities-etbu" },
  { campus: "El Paso Community College", type: "generic", url: "https://www.epcc.edu/" },
  { campus: "Episcopal Theological Seminary of the Southwest", type: "generic", url: "https://ssw.edu/alumni/jobs" },
  { campus: "Frank Phillips College", type: "generic", url: "https://fpctx.edu/jobs" },
];

// FL (Florida)
const FL_CAMPUSES = [
  {
    campus: "University of Florida",
    type: "pageup",
    url: "https://explore.jobs.ufl.edu/en-us/listing/",
  },
  {
    campus: "Florida State University",
    type: "fsu-peoplesoft",
    url: "https://jobs.omni.fsu.edu/psc/sprdhr_er/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL&Action=U",
  },
  {
    campus: "University of Central Florida",
    type: "ucf-search",
    url: "https://jobs.ucf.edu/jobs/search",
  },
  {
    campus: "University of South Florida",
    type: "oracle-cx",
    url: "https://fa-ewkd-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/USF/jobs?lastSelectedFacet=CATEGORIES&selectedCategoriesFacet=300000015432176",
  },
  {
    campus: "Florida International University",
    type: "fiu-api",
    url: "https://search.careers.fiu.edu/api/jobs",
  },
  {
    campus: "Florida Atlantic University",
    type: "workday",
    url: "https://fau.wd1.myworkdayjobs.com/FAU",
  },
  {
    campus: "University of North Florida",
    type: "workday",
    url: "https://unf.wd5.myworkdayjobs.com/unfjobs",
  },
  {
    campus: "University of Miami",
    type: "workday",
    url: "https://umiami.wd1.myworkdayjobs.com/UMFaculty",
  },
  {
    campus: "Nova Southeastern University",
    type: "generic",
    url: "https://nsucareers.nova.edu/jobs/search/faculty-jobs",
  },
  {
    campus: "Rollins College",
    type: "generic",
    url: "https://jobs.rollins.edu/",
  },
  {
    campus: "Eckerd College",
    // URL is an ExactHire ATS (a React/MUI SPA), not InterviewExchange — a
    // dedicated scrapeExactHireAs already handles this platform.
    type: "exacthire",
    url: "https://eckerd.exacthire.com/",
  },
  {
    campus: "Stetson University",
    type: "generic",
    url: "https://www.stetson.edu/administration/human-resources/faculty-opportunities.php",
  },
  {
    campus: "New College of Florida",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/ncfl",
  },
  {
    campus: "Florida Southern College",
    type: "flsouthern-portal",
    url: "https://portal.flsouthern.edu/ICS/Employment_App/",
  },
  { campus: "Jacksonville University", type: "generic", url: "https://www.ju.edu/humanresources/employment-opportunities.php" },
  { campus: "Polytechnic University of Puerto Rico-Miami", type: "generic", url: "https://www.pupr.edu/miami/" },
  // Was pointing at the bare pupr.edu/orlando campus homepage. Real ATS
  // (found via the main pupr.edu HR page's "Employment Opportunities"
  // Elementor tab) is a single ADP Workforce Now board explicitly shared
  // across "Polytechnic University, Miami Campus" and "Polytechnic
  // University, Orlando Campus" -- scoped via scrapeAdpApi's new
  // locationFilter param. ADP's own requisitionLocations field is mostly
  // empty for this tenant (confirmed via a raw API dump), but the campus is
  // baked into the title text itself for at least the current faculty
  // posting, so locationFilter matches against title+location combined.
  // Verified live: real posting "PROFESSOR - ORLANDO" among 9 total
  // postings district-wide.
  {
    campus: "Polytechnic University of Puerto Rico-Orlando",
    type: "adp",
    url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=5388a0c5-18fe-449e-b500-098740269275&ccId=19000101_000001&type=JS&lang=en_US",
    locationFilter: "Orlando",
  },
  { campus: "Erwin Technical College", type: "generic", url: "https://www.hillsboroughschools.org/faculty/jobs" },
  // hillsboroughschools.org domain -- a Hillsborough County Public Schools
  // (K-12 district) adult/career-technical center, same shape as Erwin
  // Technical College above and Downey Adult School (round 17 exclusion).
  // Likely a policy-exclusion candidate rather than a scraper fix.
  { campus: "H W Brewster Technical College", type: "generic", url: "https://www.hillsboroughschools.org/Brewster" },
  // orangetechcollege.net's own "Campuses Home" page states this is run
  // directly by Orange County Public Schools (a K-12 district) across 7
  // local campuses (Apopka/Avalon/East/Eatonville/Main/South/West) -- same
  // non-independent CTE-center shape as the Hillsborough/Suwannee/Sarasota
  // technical colleges in this batch. Likely policy-exclusion candidates
  // (both East and West Campus) rather than scraper fixes.
  { campus: "Orange Technical College-East Campus", type: "generic", url: "https://www.orangetechcollege.net/campuses/east_campus" },
  { campus: "Orange Technical College-West Campus", type: "generic", url: "https://www.orangetechcollege.net/campuses/west_campus" },
  // rtc.suwannee.k12.fl.us domain -- a Suwannee County School District (K-12)
  // technical center. Likely a policy-exclusion candidate rather than a
  // scraper fix.
  { campus: "Riveroak Technical College", type: "generic", url: "https://rtc.suwannee.k12.fl.us/o/rtc" },
  // sarasotacountyschools.net domain -- a Sarasota County Schools (K-12)
  // technical center. Likely a policy-exclusion candidate rather than a
  // scraper fix.
  { campus: "Suncoast Technical College", type: "generic", url: "https://www.sarasotacountyschools.net/o/stcsmc" },
  { campus: "Academy for Five Element Acupuncture", type: "generic", url: "https://acupuncturist.edu/employment/" },
  { campus: "Academy for Nursing and Health Occupations", type: "generic", url: "https://www.anho.edu/" },
  { campus: "AdventHealth University", type: "generic", url: "https://jobs.adventhealth.com/job-search-results?department%5B%5D=AdventHealth%20University" },
  { campus: "Albizu University-Miami", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=89df2234-abda-481d-9d9f-d75161691110&ccId=9200493117153_2&type=JS&lang=en_US" },
  { campus: "Ana G. Mendez University", type: "generic", url: "https://jobs.agmu.edu/home" },
  { campus: "Atlantic Institute of Oriental Medicine", type: "generic", url: "https://www.atom.edu/faculty/jobs" },
  { campus: "Atlantic Technical College", type: "generic", url: "https://www.atlantictechnicalcollege.edu/" },
  { campus: "Ave Maria School of Law", type: "generic", url: "https://www.avemarialaw.edu/" },
  { campus: "Ave Maria University", type: "generic", url: "https://www.avemaria.edu/" },
  { campus: "Baptist University of Florida", type: "generic", url: "https://www.buf.edu/" },
  { campus: "Barry University", type: "generic", url: "https://my.barry.edu/faculty/jobs" },
  { campus: "Beacon College", type: "generic", url: "https://www.beaconcollege.edu/" },
  // Was pointing at the bare homepage. Real page (hr/job-opportunities.html)
  // embeds a cross-origin Paycor iframe (recruitingbypaycor.com) with real
  // current faculty postings ("Assistant Professor-Mass Communications",
  // "Assistant/Associate Professor of Accounting", "Assistant Professor of
  // Exceptional Student Education", several Adjunct Instructor pool
  // postings) -- confirmed live inside the iframe. The shared generic
  // scraper only reads the top-level document, not cross-origin iframes, and
  // no Paycor-specific scraper exists in this codebase (same shape as Cairn
  // University-Langhorne, same Paycor platform). Documented, not patched
  // (would require a new scraper) -- still a real improvement over the
  // homepage even though the postings aren't extracted yet.
  { campus: "Bethune-Cookman University", type: "generic", url: "https://www.cookman.edu/hr/job-opportunities.html" },
  { campus: "Broward College", type: "generic", url: "https://www.broward.edu/error/404.html?requestUrl=/faculty/jobs" },
  { campus: "Chipola College", type: "generic", url: "https://www.chipola.edu/about/administrative-offices/human-resources/job-openings" },
  // Was pointing at the bare homepage. Real page is /about-cf/.../work-at-cf/,
  // which hands off to an institution-specific ADP career site
  // (myjobs.adp.com/collegeofcentralfloridaexternalcs/ -- a newer ADP product
  // than workforcenow.adp.com; confirmed real and institution-specific, with
  // "Recently Posted Jobs" rendering live). Documented, not patched: every
  // job card on this newer ADP UI renders with no real <a href> at all (only
  // 3-4 unrelated policy/privacy anchors exist on the whole page), and the
  // existing scrapeAdpApi only recognizes workforcenow.adp.com URLs, so
  // neither generic DOM scraping nor the existing ADP handoff can extract
  // postings from this UI yet. Still a real improvement over the homepage
  // even though the handoff currently yields 0.
  { campus: "College of Central Florida", type: "generic", url: "https://myjobs.adp.com/collegeofcentralfloridaexternalcs" },
  { campus: "Daytona State College", type: "schooljobs", url: "https://www.schooljobs.com/careers/daytonastate/faculty" },
  { campus: "Doral College", type: "generic", url: "https://doral.edu/" },
  { campus: "Dragon Rises College of Oriental Medicine", type: "generic", url: "https://www.dragonrises.edu/" },
  // Was pointing at the bare homepage. Real HR job-opportunities page embeds
  // its actual listing via a same-origin-adjacent <iframe> pointing at this
  // webapps subdomain; pointed directly at the iframe's own URL instead of
  // the wrapper page. Verified live (two fresh page loads): 20 real
  // postings, nearly all faculty/instructor-titled (Adjunct Faculty -
  // Mathematics, Nursing Instructor, Aviation Maintenance Instructor,
  // Computer Science Instructor, Aerospace Technology Instructor, etc.).
  { campus: "Eastern Florida State College", type: "generic", url: "https://webapps.easternflorida.edu/hr/employment-opportunities.cfm" },
  // Real, working, University-scoped HigherEdJobs search (already correctly
  // wired). Verified live (two fresh loads): 9 real postings with real
  // anchors, but none currently faculty-titled (Grant/Budget Analyst,
  // Accounting Coordinator, Assistant Baseball Coach, Director of Career
  // Exploration, Athletic Trainer, etc.) -- genuinely 0 faculty openings
  // right now, not a bug.
  { campus: "Edward Waters University", type: "generic", url: "https://www.higheredjobs.com/institution/search.cfm?University=Edward%20Waters%20University&suggest=3" },
  // Was pointing at the "Benefits" info subpage of careers.erau.edu (not a
  // listing page at all). The real ATS is a single Workday tenant
  // (embryriddle.wd1.myworkdayjobs.com/External) shared across every ERAU
  // campus (Daytona Beach, Prescott, Worldwide, plus assorted global
  // detachments) -- 138 total openings, an unscoped misattribution risk if
  // pointed at directly. Its own API supports a real "locations" facet,
  // confirmed via the /wday/cxs/.../jobs POST response's facet list
  // ("Daytona Beach, FL" = id ac0092a9a0de019c86717943ff093d57, 81 of the
  // 138). scrapeWorkdayAs (already dispatched by FL) parses facets straight
  // out of the URL's query string via scrapeWorkdayApi, so a bare
  // "?locations=<id>" query param is enough -- no new scraper code needed.
  // Verified live (two fresh runs of the real dispatch path): 15 real,
  // Daytona-Beach-scoped faculty postings (e.g. "Tenure Track Assistant/
  // Associate Professor of Mechanical Engineering, Daytona Beach Campus",
  // "Assistant Professor and Director of Flight Operations, Daytona Beach
  // Campus"), every title explicitly tagged "Daytona Beach Campus".
  {
    campus: "Embry-Riddle Aeronautical University-Daytona Beach",
    type: "workday",
    url: "https://embryriddle.wd1.myworkdayjobs.com/External?locations=ac0092a9a0de019c86717943ff093d57",
  },
  { campus: "Embry-Riddle Aeronautical University-Worldwide", type: "generic", url: "https://worldwide.erau.edu/" },
  { campus: "Everglades University", type: "generic", url: "https://evergladesuniversity.isolvedhire.com" },
  // Was pointing at the bare flagler.edu homepage. Real "Faculty Job
  // Openings" link (from the HR page) hands off to a single-institution
  // Interfolio board (apply.interfolio.com/11601/positions) -- the existing
  // "interfolio-inst" type/scraper already handles this exact URL shape via
  // Interfolio's own public JSON API (logic.interfolio.com/byc-search/...),
  // no browser rendering needed. Verified live: 4 real postings, 3 adjunct/
  // professor-titled ("Adjunct Business Administration, Management, Business
  // Admin, International", "Adjunct Professor of Criminology", "Adjunct
  // Professor, Computer Information Systems").
  { campus: "Flagler College", type: "interfolio-inst", url: "https://apply.interfolio.com/11601/positions" },
  // flaglertech.edu's homepage is explicitly a Flagler Schools (Flagler
  // County Public Schools, a K-12 district) site -- "Flagler Palm Coast High
  // School", "Flagler Schools families", county school-board budget notices.
  // Likely a policy-exclusion candidate rather than a scraper fix.
  { campus: "Flagler Technical College", type: "generic", url: "https://flaglertech.edu/" },
  { campus: "Florida Agricultural and Mechanical University", type: "generic", url: "https://www.famu.edu/" },
  // Real, correctly-functioning page with genuine current postings
  // ("Professor of Mechanical Engineering", "Dual Enrollment Adjunct
  // Faculty" -- verified live) -- but every posting renders as a WordPress
  // accordion (`<h3 class="accordion__item__title">` inside a
  // `<div class="accordion__thumb">`) with no `<a href>` anywhere nearby.
  // The shared generic scraper's no-anchor accordion fallback only
  // recognizes `accordion-trigger`/`accordion__toggle`/`accordion-button`/
  // `accordion-header`/button[class*=accordion] class patterns, none of
  // which match this site's `accordion__item__title` naming -- a new,
  // narrower shared-scraper gap than the fully anchor-less pure-text cases
  // documented in earlier rounds (Alaska Bible College, Spring Hill
  // College). Documented, not patched (touches the shared function used by
  // every "generic" institution) -- URL is already correct.
  { campus: "Florida College", type: "generic", url: "https://floridacollege.edu/careers" },
  { campus: "Florida Gateway College", type: "schooljobs", url: "https://www.schooljobs.com/careers/fgcedu" },
  { campus: "Florida Gulf Coast University", type: "generic", url: "https://www.fgcu.edu/jobs/" },
  { campus: "Florida Institute of Technology", type: "generic", url: "https://www.fit.edu/employment" },
  { campus: "Florida Institute of Technology-Online", type: "workday", url: "https://floridatech.wd5.myworkdayjobs.com/FloridaTechCareers" },
  // Was pointing at the bare fmuniv.edu homepage. Real "Employment
  // Opportunities" link (from the Office of Human Resources page) hands off
  // to a single-institution Paycom board. Verified live: 40 total postings,
  // several real faculty titles ("INSTRUCTOR OF HISTORY", "ADJUNCT
  // INSTRUCTOR OF MUSIC | STEEL DRUM", "ADJUNCT INSTRUCTOR OF ENGLISH",
  // "ADJUNCT INSTRUCTOR OF COMMUNICATIONS", "ADJUNCT INSTRUCTOR OF THEATRE
  // ARTS").
  {
    campus: "Florida Memorial University",
    type: "paycom",
    url: "https://www.paycomonline.net/v4/ats/web.php/portal/3A7F245516E9EFA544C4D6ECB8AB8287/career-page",
  },
  { campus: "Florida Polytechnic University", type: "generic", url: "https://floridapoly.edu/" },
  // Real, working SilkRoad ATS (confirmed genuine infrastructure), but page
  // 1 (the bare URL) only shows Administrative/Management categories --
  // real faculty postings live on page 2's "Faculty" and "Faculty (temp) -
  // Adjuncts" categories, and the shared generic scraper doesn't paginate
  // this platform. SilkRoad already has no dedicated scraper type in this
  // repo, but Cameron University elsewhere in this file proves "generic"
  // already handles a SilkRoad tenant scoped via its own
  // "?SelectedCategory=<id>" query param (a real server-side filter, not a
  // client-only widget) -- found this tenant's own category id (36329 =
  // "Faculty") via the page's own category-header element IDs
  // ("Jobs_PagedJobList_Category__36329"). Verified live (two fresh loads):
  // exactly 2 real postings, "Professor, Early Childhood Education" and
  // "Professor, Nursing (Lee)".
  {
    campus: "Florida SouthWestern State College",
    type: "generic",
    url: "https://jobs.silkroad.com/FSWSC/fswsccareerssilkroadcom",
  },
  { campus: "Florida State College at Jacksonville", type: "generic", url: "https://www.fscj.edu/" },
  // "Job Postings" link is College Central Network, a student job-placement
  // service (not an employee/HR careers board) -- and fortmyerstech.edu
  // (Lee County Schools' Fleetforce CDL note, "School Board of Lee County"
  // link) confirms this is a Lee County Public Schools (K-12 district)
  // technical center, same non-independent CTE shape as the other technical
  // colleges in this batch. Likely a policy-exclusion candidate rather than
  // a scraper fix.
  { campus: "Fort Myers Technical College", type: "generic", url: "https://www.fortmyerstech.edu/" },
];

// GA (Georgia)
// Abraham Baldwin, Albany State, Atlanta Metro State, Augusta, Clayton State,
// College of Coastal Georgia, Columbus State, Dalton State, East Georgia
// State, Kennesaw State, and North Georgia are covered by the system-wide
// USG scrape (scrapeUsgFaculty / USG_URL) instead of per-campus entries here
// — same "never per-campus for system members" rule as CSU. UGA and Georgia
// State keep their own PeopleAdmin entries below; USG_CANONICAL_CAMPUSES
// deliberately excludes both (they've never appeared as a Business Unit on
// that feed) so they can't get double-scraped under a second name spelling.
//
// Albany/Athens/Atlanta/Augusta/Central Georgia/Chattahoochee/Coastal Pines/
// Columbus Technical College are likewise covered by the system-wide TCSG
// scrape (scrapeTcsgFaculty / TCSG_URL) — its jobs page explicitly covers
// "the TCSG System Office, as well as our 22 Colleges", not just whichever
// currently has an open posting.
const GA_CAMPUSES = [
  { campus: "University of Georgia", type: "peopleadmin", url: "https://www.ugajobsearch.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&225=&436=&query_position_type_id%5B%5D=7&query_position_type_id%5B%5D=8&commit=Search" },
  { campus: "Georgia State University", type: "peopleadmin", url: "https://facultycareers.gsu.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=3&435=&commit=Search" },
  { campus: "Spelman College", type: "peopleadmin", url: "https://spelman.peopleadmin.com/postings/search?commit=Search&query_position_type_id%5B%5D=3&sort=225+asc&utf8=%E2%9C%93" },
  { campus: "Agnes Scott College", type: "generic", url: "https://www.agnesscott.edu/" },
  { campus: "Andrew College", type: "generic", url: "https://www.andrewcollege.edu/employment-opportunities" },
  { campus: "Atlanta's John Marshall Law School", type: "generic", url: "https://www.johnmarshall.edu/" },
  { campus: "Berry College", type: "interviewexchange", url: "https://berry.interviewexchange.com/static/clients/563BCM1/index.jsp" },
  { campus: "Beulah Heights University", type: "generic", url: "https://www.beulah.edu/" },
  { campus: "Brenau University", type: "generic", url: "https://www.brenau.edu/" },
  // Was pointing at the bare homepage. Real employment page (found via the
  // "Employment" footer link) has genuine current faculty openings (e.g.
  // "Assistant/Associate Professor of English / Humanities", "...of
  // Chemistry", "...of Kinesiology") but they're rendered as FAQ-accordion
  // <h3> headings with no <a href> per posting -- same anchor-blind-spot
  // shape as Centenary College of Louisiana below. Routed to the real page
  // anyway so it's at least the correct page (matches Belmont Abbey/
  // Anabaptist Mennonite precedent), but the generic scraper still can't
  // extract these titles.
  { campus: "Brewton-Parker College", type: "generic", url: "https://bpc.edu/about-bpc/information/employment/" },
  { campus: "Clark Atlanta University", type: "generic", url: "https://www.cau.edu/" },
  { campus: "College of Athens", type: "generic", url: "https://collegeofathens.edu/coa-employment" },
  { campus: "Columbia Theological Seminary", type: "generic", url: "https://www.ctsnet.edu/careers" },
  { campus: "Covenant College", type: "generic", url: "https://covenant.workbrightats.com/jobs" },
  { campus: "Emmanuel University", type: "generic", url: "https://www.ec.edu/" },
  { campus: "Emory University", type: "generic", url: "https://www.emory.edu/" },
  { campus: "Emory University-Oxford College", type: "generic", url: "https://www.oxford.emory.edu/resources/human-resources/careers.html" },
  // Already correctly wired (real single-institution ApplicantPro board,
  // real anchors per posting) -- verified live: 74 total postings, many
  // real faculty titles ("Adjunct Instructor - Biology", "Assistant
  // Professor of Reading", "Lecturer of Political Science", "Department
  // Chair of Nursing", "Assistant/Associate Professor of Agribusiness and
  // Applied Economics"). institutions-master.json's missing/generic labels
  // are simply stale here, same as Northern Arizona University in round 17.
  { campus: "Fort Valley State University", type: "generic", url: "https://fvsu.applicantpro.com/jobs" },
  { campus: "Kennesaw State University", type: "peopleadmin", url: "https://kennesaw.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=3&commit=Search" },
  { campus: "Albany State University", type: "generic", url: "https://www.asurams.edu/human-resources/employmentopp/employment.php" },
  { campus: "Augusta Technical College", type: "generic", url: "https://www.easyhrweb.com/JC_AugustaTech/JobListings/joblistings.aspx" },
  { campus: "University of North Georgia", type: "generic", url: "https://ung.edu/human-resources/employment-opportunities/index.php" },
  // These 14 TCSG member colleges are deliberately NOT covered by scrapeTcsgFaculty's
  // tcsg.edu system-wide feed for one of two reasons: at discovery time that feed
  // showed 0 or non-faculty-only postings for them (real faculty openings live on
  // Team Georgia Careers, careers.georgia.gov, agency-filtered per college), or the
  // college runs its own independent EasyHRWeb JobCenter instead. See
  // data/career-url-overrides.json for per-college verification notes/counts.
  { campus: "Albany Technical College", type: "generic", url: "https://careers.georgia.gov/jobs-search?search_api_fulltext=&field_agency_name=4901&field_job_family=All&field_employee_status=All&field_job_level=All&field_schedule=All&field_shift=All" },
  { campus: "Athens Technical College", type: "generic", url: "https://careers.georgia.gov/jobs-search?search_api_fulltext=&field_agency_name=4906&field_job_family=All&field_employee_status=All&field_job_level=All&field_schedule=All&field_shift=All" },
  { campus: "Central Georgia Technical College", type: "generic", url: "https://www.centralgatech.edu/" },
  { campus: "Columbus Technical College", type: "generic", url: "https://careers.georgia.gov/jobs-search?search_api_fulltext=&field_agency_name=4931&field_job_family=All&field_employee_status=All&field_job_level=All&field_schedule=All&field_shift=All" },
  { campus: "Georgia Northwestern Technical College", type: "generic", url: "https://careers.georgia.gov/jobs-search?search_api_fulltext=&field_agency_name=4936&field_job_family=All&field_employee_status=All&field_job_level=All&field_schedule=All&field_shift=All" },
  { campus: "Lanier Technical College", type: "generic", url: "https://careers.georgia.gov/jobs-search?search_api_fulltext=&field_agency_name=4956&field_job_family=All&field_employee_status=All&field_job_level=All&field_schedule=All&field_shift=All" },
  { campus: "North Georgia Technical College", type: "generic", url: "https://careers.georgia.gov/jobs-search?search_api_fulltext=&field_agency_name=4971&field_job_family=All&field_employee_status=All&field_job_level=All&field_schedule=All&field_shift=All" },
  { campus: "Oconee Fall Line Technical College", type: "generic", url: "https://careers.georgia.gov/jobs-search?search_api_fulltext=&field_agency_name=4891&field_job_family=All&field_employee_status=All&field_job_level=All&field_schedule=All&field_shift=All" },
  { campus: "Ogeechee Technical College", type: "generic", url: "https://careers.georgia.gov/jobs-search?search_api_fulltext=&field_agency_name=4991&field_job_family=All&field_employee_status=All&field_job_level=All&field_schedule=All&field_shift=All" },
  { campus: "Savannah Technical College", type: "generic", url: "https://careers.georgia.gov/jobs-search?search_api_fulltext=&field_agency_name=4976&field_job_family=All&field_employee_status=All&field_job_level=All&field_schedule=All&field_shift=All" },
  { campus: "South Georgia Technical College", type: "generic", url: "https://www.southgatech.edu/" },
  { campus: "Southern Crescent Technical College", type: "generic", url: "https://careers.georgia.gov/jobs-search?search_api_fulltext=&field_agency_name=4946&field_job_family=All&field_employee_status=All&field_job_level=All&field_schedule=All&field_shift=All" },
  { campus: "Southern Regional Technical College", type: "generic", url: "https://careers.georgia.gov/jobs-search?search_api_fulltext=&field_agency_name=4966&field_job_family=All&field_employee_status=All&field_job_level=All&field_schedule=All&field_shift=All" },
  { campus: "West Georgia Technical College", type: "generic", url: "https://careers.georgia.gov/jobs-search?search_api_fulltext=&field_agency_name=4921&field_employee_status=All&field_job_level=All&field_schedule=All&field_shift=All&search_api_fulltext=" },
];

// AL (Alabama)
const AL_CAMPUSES = [
  { campus: "University of Alabama", type: "peopleadmin", url: "https://careers.ua.edu/faculty/jobs" },
  // auemployment.com (PeopleAdmin) is now a dead tenant -- its own homepage
  // banner says Auburn migrated to a new hiring platform effective March 2,
  // "The current site (auemployment.com) will no longer host new job
  // postings after this date," which is why query_position_type_id[]=6
  // (Faculty) returns 0 now. Real ATS is a white-labeled iCIMS instance at
  // jobs.auburn.edu (apply links resolve to facultyjobs-auburn.icims.com).
  // Verified live (two fresh page loads): 53 Faculty-tagged results, incl.
  // real current postings ("Assistant Professor - Meat Science", "Assistant
  // Professor - Nutritional Physiology and Metabolism"). No existing AL
  // dispatch case for "icims" (function scrapeIcimsAs already exists and is
  // used by other states) -- added one below, following the exact call
  // convention already used for it elsewhere (e.g. MA_PRIVATE_CAMPUSES).
  { campus: "Auburn University", type: "icims", url: "https://jobs.auburn.edu/auburn/jobs?tags2=Faculty" },
  { campus: "University of Alabama at Birmingham", type: "peopleadmin", url: "https://uab.peopleadmin.com/postings/search" },
  { campus: "University of South Alabama", type: "generic", url: "https://www.southalabama.edu/departments/academicaffairs/facultyposition.html" },
  // Real, correctly-reached page -- lists current openings directly,
  // including real faculty postings ("Adjunct Instructor–English (Pool)",
  // "Adjunct Instructor – Psychology (Pool)", "Adjunct Instructor Chemistry
  // FA26"). Same "shared-scraper gap" shape as Alaska Bible College/Black
  // River Technical College elsewhere in this file, and already noted by
  // name in the generic scraper's own CTA-anchor-lookup comment: every
  // title on this page is plain text with no per-posting href at all (not
  // even a CTA link), so there's nothing for the anchor-based scraper to
  // find. Documented, not patched (would need a dedicated custom scraper).
  { campus: "Spring Hill College", type: "generic", url: "https://www.shc.edu/about-spring-hill-jesuit-college/spring-hill-college-jobs/" },
  { campus: "Remington College-Mobile Campus", type: "generic", url: "https://www.remingtoncollege.edu/locations/mobile/" },
  { campus: "Alabama A & M University", type: "schooljobs", url: "https://www.schooljobs.com/careers/aamu" },
  { campus: "Alabama College of Osteopathic Medicine", type: "generic", url: "https://www.acom.edu/" },
  { campus: "Alabama State University", type: "schooljobs", url: "https://www.governmentjobs.com/careers/alasu" },
  // Was pointing at the bare homepage. Real employment page is a rolling
  // "email your CV to facultycareers@..." call with no job board/anchors at
  // all -- routed to it anyway for correctness, but it will structurally
  // never produce a link-based posting for the generic scraper to catch.
  { campus: "Amridge University", type: "generic", url: "https://www.amridgeuniversity.edu/about/employment" },
  // Was the bare HR landing page. This is a white-labeled PeopleAdmin instance
  // on a custom domain — ATS-detection only recognizes the literal
  // peopleadmin.com hostname, so hand-off never fired. 366[]=1 confirmed live
  // as the Faculty filter.
  { campus: "Athens State University", type: "peopleadmin", url: "https://jobs.athens.edu/postings/search?366%5B%5D=1&commit=Search" },
  { campus: "Auburn University at Montgomery", type: "generic", url: "https://www.aum.edu/" },
  // Was pointing at the bare homepage. Real ATS is SchoolJobs/NEOGOV, scoped
  // to Bevill State within the Alabama Community College System tenant
  // (schooljobs.com/careers/accs/bevillstatecc). The main (full-time)
  // postings page has only 1 non-faculty opening right now, but the
  // "Part-Time Faculty/Adjunct Positions" sub-page has 18 real current
  // adjunct instructor postings (Adjunct Art/Automotive/Biology/Business/
  // English/History/Mathematics/Music Instructor, etc.) -- verified live.
  // AL dispatcher already has a "schooljobs" case (used elsewhere) --
  // reused directly.
  { campus: "Bevill State Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/accs/bevillstatecc/promotionaljobs" },
  { campus: "Bishop State Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/accs/bishopstate" },
  { campus: "Central Alabama Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/accs/cacc" },
  { campus: "Chattahoochee Valley Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/accs/jobs/newprint/4482590" },
  { campus: "Coastal Alabama Community College", type: "generic", url: "https://www.coastalalabama.edu/about/employment" },
  { campus: "Enterprise State Community College", type: "schooljobs", url: "https://schooljobs.com/careers/accs/enterprise/promotionaljobs" },
  { campus: "Faulkner University", type: "generic", url: "https://faulkner.applicantpro.com/jobs" },
];

// MS (Mississippi)
const MS_CAMPUSES = [
  { campus: "University of Mississippi", type: "workday", url: "https://olemiss.wd12.myworkdayjobs.com/External__Faculty" },
  { campus: "Mississippi University for Women", type: "peopleadmin", url: "https://muw.peopleadmin.com/postings/search" },
  { campus: "Delta State University", type: "peopleadmin", url: "https://deltastate.peopleadmin.com/postings/search" },
  { campus: "Millsaps College", type: "generic", url: "https://millsaps.edu/offices/human-resources/employment-opportunities/" },
  { campus: "Alcorn State University", type: "generic", url: "https://www.schooljobs.com/careers/alcornstateuniversity" },
  // Was pointing at the bare homepage. Real employment page lists real
  // postings as PDF anchors. Verified live (direct scraper run, twice): 2
  // real current faculty postings ("Assistant/Associate Professor of
  // Counseling", "Adjunct Faculty - DBA").
  { campus: "Belhaven University", type: "generic", url: "https://www.belhaven.edu/about/contact/employment.html" },
  // Was pointing at the bare homepage. Real page is /jobs-at-bmcu, linked
  // from the homepage. Confirmed real content there: a real current faculty
  // opening ("Professor of Exercise Science - School of Kinesiology"), but
  // it's a single static page with the full posting text under a plain
  // heading -- no per-posting anchor at all for the generic scraper to
  // catch. Routed to the real page anyway for correctness.
  { campus: "Blue Mountain Christian University", type: "generic", url: "https://www.bmc.edu/jobs-at-bmcu" },
  { campus: "Board of Trustees-Mississippi State Institutions of Higher Learning", type: "generic", url: "https://www.mississippi.edu/" },
  { campus: "Coahoma Community College", type: "generic", url: "https://www.coahomacc.edu/" },
  // Was pointing at the HR contact-info page (no listings of its own). The
  // parent "Employees/Jobs" page's "Jobs/Employment" link goes to this
  // institution-specific Paycom tenant. Not left as "generic": same shape as
  // Brazosport College (TX) -- the Paycom SPA's job-card anchors mash title +
  // employment-type + truncated description into one textContent ending in
  // "...", which trips the shared generic scraper's truncated-title
  // rejection on every card, and the ATS-handoff fallback that follows has
  // no paycom URL normalizer so it grabs a single job's detail URL instead
  // of the listing root. Calling scrapePaycomAs directly avoids both. MS
  // dispatcher had no "paycom" case yet -- added above. Verified live (two
  // fresh page loads): 10 real postings after the shared adjunct/part-time
  // filter, including "Career and Technical Education LPN Instructor Pool -
  // Adjunct" and two "Workforce Plumbing Instructor" postings.
  {
    campus: "Copiah-Lincoln Community College",
    type: "paycom",
    url: "https://www.paycomonline.net/v4/ats/web.php/portal/1F33F8BBDC686BCE369D823D8B8EF3B4/career-page",
  },
  { campus: "East Central Community College", type: "generic", url: "https://www.eccc.edu/" },
  { campus: "East Mississippi Community College", type: "schooljobs", url: "https://www.governmentjobs.com/careers/eastmisscc" },
];

// LA (Louisiana)
const LA_CAMPUSES = [
  { campus: "Louisiana State University", type: "workday", url: "https://lsu.wd1.myworkdayjobs.com/LSU?Job_Profiles=7a9995fc77aa101fe03ed2adb83abd3b&Job_Profiles=7a9995fc77aa101fe03fb0edd613be1b&Job_Profiles=7a9995fc77aa101fe03ea5230b41bd10&Job_Profiles=7a9995fc77aa101fe03c558ab5c0bac4&Job_Profiles=7a9995fc77aa101fe03fb8c46670be23&Job_Profiles=7a9995fc77aa101fe03fa8fe7ecdbe13&Job_Profiles=48b1ff5a2bae01637b1270c77c372403" },
  { campus: "Louisiana Tech University", type: "workday", url: "https://ulsltu.wd503.myworkdayjobs.com/LATECHCareers" },
  { campus: "Dillard University", type: "generic", url: "https://www.dillard.edu/human-resources/" },
  // URL had a stray "%20OR%20school%20of%20radiologic%20technology" baked
  // into the path (looks like a malformed multi-page search query).
  { campus: "Baton Rouge General Medical Center School of Nursing & School of Radiologic Technology", type: "generic", url: "https://www.brgeneral.org/about/careers" },
  { campus: "Remington College-Baton Rouge Campus", type: "generic", url: "https://www.remingtoncollege.edu/baton-rouge-career-college" },
  { campus: "Remington College-Lafayette Campus", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=8a43162b-bbe7-4cdf-af0d-a628a4f65790&ccId=9201027239359_2&lang=en_US&&source=EN&selectedMenuKey=CareerCenter" },
  { campus: "Remington College-Shreveport Campus", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=8a43162b-bbe7-4cdf-af0d-a628a4f65790&ccId=9201027242374_2&lang=en_US&&source=EN&selectedMenuKey=CareerCenter" },
  // Checked for the same shared-Workday-tenant fix applied to The Chicago
  // School at Los Angeles / San Diego / Chicago (round 18/19): the tenant's
  // own facet list (confirmed via a direct POST to
  // /wday/cxs/tcsedsystem/TCSPP/jobs) has NO location entry for New Orleans
  // or Xavier at all -- 0 of the tenant's 72 current postings are tagged to
  // this campus. The Chicago School's own live "Campus Locations" page no
  // longer even lists Xavier University of Louisiana among its campuses
  // (Online, Anaheim, Chicago, Dallas, Los Angeles, Washington D.C. only),
  // suggesting this partnership may no longer be active. Nothing to scope
  // to -- left as the bare locations page rather than pointing at the
  // unscoped shared tenant (which would misattribute other campuses'
  // postings here). Documented, not patched.
  { campus: "The Chicago School at Xavier University of Louisiana", type: "generic", url: "https://www.thechicagoschool.edu/in-the-community/locations/" },
  // Checked thoroughly: no self-hosted careers/employment/jobs page exists
  // anywhere on lafayette.aie.edu or the parent aie.edu site (confirmed by
  // reading every footer/nav link on both -- only "Career Pathways" pages,
  // which are student-outcomes marketing content, not a hiring board).
  // HigherEdJobs (the established fallback for institutions with no
  // self-hosted board, e.g. Chicago Theological Seminary) has no listing
  // for this institution either ("No matching positions found" against
  // real search infrastructure). Real current openings do exist (a web
  // search found "Game Art and Animation Instructor" and "Game Programming
  // Instructor" postings) but only on third-party boards this codebase
  // doesn't scrape (Indeed, ArtStation, Tallo, BeBee) -- documented, not
  // patched; left at the bare homepage since there is no better URL.
  { campus: "Academy of Interactive Entertainment", type: "generic", url: "https://lafayette.aie.edu/" },
  { campus: "Baton Rouge Community College", type: "generic", url: "https://www.mybrcc.edu/" },
  { campus: "Bossier Parish Community College", type: "generic", url: "https://www.bpcc.edu/human-resources/employment-opportunities" },
  { campus: "Bridges Christian College", type: "generic", url: "https://www.bcc.edu/" },
  { campus: "Centenary College of Louisiana", type: "generic", url: "https://www.centenary.edu/directories/offices-services-directory/human-resources/job-opportunities" },
  // Was pointing at the bare homepage. Real careers page is /careers, with
  // real per-posting PDF anchors the generic scraper can read. Verified live
  // (two fresh page loads): many current Instructor/Adjunct Instructor
  // postings (e.g. "Drafting & Design Instructor (9-Month) - Alexandria
  // Campus", "Practical Nursing Instructor/Coordinator - Alexandria Campus").
  { campus: "Central Louisiana Technical Community College", type: "generic", url: "https://www.cltcc.edu/careers" },
  { campus: "Delgado Community College", type: "generic", url: "https://careers.lctcs.edu/?colleges=DCC" },
  { campus: "Digital Media Institute", type: "generic", url: "https://www.dmi.edu/" },
  { campus: "Fletcher Technical Community College", type: "generic", url: "https://careers.lctcs.edu/?colleges=Fletcher+Technical+Community+College" },
  // URL was already correct -- a real Oracle Cloud CX page pre-filtered by
  // keyword=franu with location facets applied, genuinely scoped to FranU
  // specifically (every job title prefixed "FranU ...", location Baton
  // Rouge, LA) rather than an unscoped FMOL Health System-wide board -- but
  // type: "generic" only reads real <a href> job links, and this SPA
  // renders every job card with no per-job href of its own (only 8 total
  // page links, none pointing at a job). Same "right URL, wrong type" shape
  // as University of Puget Sound (round 13). LA dispatcher had no
  // "oracle-cx" case yet -- added above (function already existed, used by
  // TX). Verified live (two fresh page loads): 11 open jobs, 3 real faculty
  // postings (FranU Nursing Instructor PRN, FranU Assistant Professor
  // Physician Assistant, and a Clinical Coordinator role).
  {
    campus: "Franciscan Missionaries of Our Lady University",
    type: "oracle-cx",
    url: "https://eqtm.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/fmolhs-careers/jobs?keyword=franu&lastSelectedFacet=LOCATIONS&mode=location&selectedLocationsFacet=300000004524509%3B300000004524395",
  },
];

// AR (Arkansas)
const AR_CAMPUSES = [
  { campus: "University of Arkansas", type: "workday", url: "https://uasys.wd5.myworkdayjobs.com/UAF_External_Career_Site?timeType=8676082fcc890179341a6d2e71495800&jobFamilyGroup=eaddfab9343f0113688d32d525e70000" },
  { campus: "University of Central Arkansas", type: "peopleadmin", url: "https://jobs.uca.edu/postings/search" },
  { campus: "Cossatot Community College of the University of Arkansas", type: "generic", url: "https://www.cccua.edu/about-ua-cossatot/human-resources/employment-opportunities.html" },
  { campus: "University of Arkansas at Little Rock", type: "generic", url: "https://ualr.edu/careers/person-type/faculty" },
  { campus: "University of Arkansas Hope-Texarkana", type: "generic", url: "https://www.uaht.edu/staff/employment-opportunities.php" },
  { campus: "Arkansas Baptist College", type: "generic", url: "https://www.arkansasbaptist.edu/" },
  { campus: "Arkansas Colleges of Health Education", type: "generic", url: "https://recruiting.paylocity.com/recruiting/jobs/All/966a7ab2-15b9-4608-8364-32d0b75d2c2b/Arkansas-Colleges-of-Health-Education" },
  { campus: "Arkansas Northeastern College", type: "generic", url: "https://www.anc.edu/academics/faculty-jobs" },
  { campus: "Arkansas State University", type: "generic", url: "https://www.astate.edu/jobs?redirect=true" },
  { campus: "Arkansas State University Mid-South", type: "generic", url: "https://www.asumidsouth.edu/" },
  { campus: "Arkansas State University System", type: "generic", url: "https://www.asusystem.edu/" },
  { campus: "Arkansas State University Three Rivers", type: "generic", url: "https://www.asutr.edu/" },
  { campus: "Arkansas State University-Beebe", type: "generic", url: "https://jobs.asub.edu/" },
  { campus: "Arkansas State University-Mountain Home", type: "generic", url: "https://phe.tbe.taleo.net/phe02/ats/careers/v2/jobSearch?act=redirectCwsV2&cws=58&org=ARKASTAT2" },
  { campus: "Arkansas State University-Newport", type: "generic", url: "https://www.asun.edu/" },
  { campus: "Arkansas Tech University", type: "schooljobs", url: "https://www.governmentjobs.com/careers/atu/Faculty" },
  { campus: "Baptist Health College Little Rock", type: "generic", url: "https://www.bhclr.edu/" },
  // Was pointing at the bare homepage. Real page is /employment, a real
  // "Current Openings" table with per-posting titles (Paramedic Program
  // Director - Faculty, Industrial Automation Instructor, Math Instructor,
  // Adjunct Welding Technology, etc.) each linked via a real <a href>. NOT
  // wired as a working fix: every posting's anchor target is hosted under
  // /news/<slug> (the college posts openings as WordPress "news" articles),
  // and the shared generic scraper explicitly excludes any /news\b path as
  // non-job noise -- so this whole page's real postings are filtered out by
  // that shared exclusion. URL updated anyway for correctness/specificity
  // over the old bare homepage.
  { campus: "Black River Technical College", type: "generic", url: "https://www.blackrivertech.edu/employment" },
  { campus: "Central Baptist College", type: "generic", url: "https://www.cbc.edu/jobs" },
  { campus: "Champion Christian College", type: "generic", url: "https://www.champion.edu/careers" },
  { campus: "Crowley's Ridge College", type: "generic", url: "https://crc.edu/careers" },
  { campus: "East Arkansas Community College", type: "generic", url: "https://www.uaeacc.edu/employment" },
  { campus: "Ecclesia College", type: "generic", url: "https://ecollege.edu/employment" },
];

// KS (Kansas)
const KS_CAMPUSES = [
  { campus: "University of Kansas", type: "generic", url: "https://employment.ku.edu/jobs/faculty" },
  { campus: "Kansas State University", type: "generic", url: "https://careers.k-state.edu/jobs/search?query=faculty" },
  { campus: "Baker University", type: "generic", url: "https://www.bakeru.edu/about-baker/careers-baker" },
  { campus: "Southwestern College (KS)", type: "generic", url: "https://www.sckans.edu/about/employment" },
  { campus: "Allen County Community College", type: "generic", url: "https://www.allencc.edu/contact/careers/opportunities" },
  { campus: "Barclay College", type: "generic", url: "https://www.barclaycollege.edu/" },
  { campus: "Barton County Community College", type: "generic", url: "https://bartonccc.agilehr.com/careers" },
  { campus: "Benedictine College", type: "generic", url: "https://www.benedictine.edu/jobs" },
  { campus: "Bethel College-North Newton", type: "generic", url: "https://forms.bethelks.edu/about/who-we-are/career-opportunities/current-position-openings" },
  { campus: "Butler Community College", type: "generic", url: "https://employment.butlercc.edu/postings/search" },
  { campus: "Central Christian College of Kansas", type: "generic", url: "https://centralchristian.edu/about-ccck/employment" },
  { campus: "Cleveland University-Kansas City", type: "generic", url: "https://www.cleveland.edu/" },
  { campus: "Cloud County Community College", type: "generic", url: "https://www.cloud.edu/about/employment" },
  { campus: "Coffeyville Community College", type: "generic", url: "https://www.coffeyville.edu/human-resources/job-openings" },
  // The configured page's real job list is embedded via a cross-origin
  // <iframe src="https://colbycc.apscareerportal.com/?embed=1">, unreadable
  // by the shared generic scraper. Navigating directly to the underlying
  // APS Career Portal (AppOne) URL as its own top-level page works fine
  // (same platform/pattern already used for Clarendon College, type
  // "generic"). Verified live (two fresh page loads): real faculty postings
  // (Adjunct Faculty - Generic, Clinical Nursing Instructor - Adjunct).
  { campus: "Colby Community College", type: "generic", url: "https://colbycc.apscareerportal.com/jobs?locale=en-US" },
  // Was pointing at the bare homepage. The "Work at Cowley" page's "Cowley
  // Job Listings" button goes to this institution-specific Paycom tenant.
  // Not left as "generic": same Paycom-SPA truncated-title shape as
  // Brazosport College (TX) / Copiah-Lincoln Community College (MS) -- the
  // shared generic scraper's inline extraction rejects every card and its
  // ATS-handoff fallback grabs a single job's detail URL instead of the
  // listing root. Calling scrapePaycomAs directly avoids both. KS
  // dispatcher had no "paycom" case yet -- added above. Verified live (two
  // fresh page loads): 8 real postings after the shared adjunct/part-time
  // filter, including "Wind Energy Technology Instructor (Adjunct)" and four
  // department-specific Adjunct pool postings.
  {
    campus: "Cowley County Community College",
    type: "paycom",
    url: "https://www.paycomonline.net/v4/ats/web.php/portal/D735C44B01F6404D0C91B262228D396A/career-page",
  },
  // Was pointing at the bare employment landing page (no per-posting
  // anchors -- just a row of category icon-links to a shared ADP Workforce
  // Now tenant, each icon wrapping a distinct ccId category: Staff,
  // Part-Time, Faculty, Adjunct, Athletics, Student, Arizona -- confirmed by
  // matching each <img> filename to its enclosing <a href>). Split into two
  // entries for the Faculty and Adjunct category ccIds (scrapeAdpApi takes
  // one ccId per URL, and this ADP tenant has no combined "all faculty"
  // category). Verified live via the tenant's own job-requisitions API:
  // Faculty ccId returns 1 real posting ("Faculty - Automotive Technology",
  // Main Campus, Dodge City, KS); Adjunct ccId returns 8 real postings, all
  // Dodge City, KS (e.g. "Part Time Nursing Instructor", "Adjunct
  // Instructor - Allied Health/Nursing", "Adjunct Instructor -
  // Mathematics/Sciences") -- confirming this tenant is NOT shared beyond
  // Dodge City despite the "Arizona" category icon (that category's
  // postings never appeared under Faculty/Adjunct in this check).
  {
    campus: "Dodge City Community College",
    type: "adp",
    url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=fb38771a-5afe-4371-bf51-3936ebb49ef7&ccId=9200394770924_2&type=JS&lang=en_US",
  },
  {
    campus: "Dodge City Community College",
    type: "adp",
    url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=fb38771a-5afe-4371-bf51-3936ebb49ef7&ccId=9200394771142_2&type=JS&lang=en_US",
  },
  { campus: "Donnelly College", type: "generic", url: "https://www.donnelly.edu/staff/careers" },
  { campus: "Emporia State University", type: "generic", url: "https://www.emporia.edu/" },
  { campus: "Flint Hills Technical College", type: "generic", url: "https://my.fhtc.edu/ICS/Careers/" },
  { campus: "Fort Hays State University", type: "generic", url: "https://www.fhsu.edu/career/faculty/" },
  { campus: "Fort Hays State University-Northwest Kansas Technical College", type: "generic", url: "https://www.fhnw.edu/careers" },
  { campus: "Fort Hays Tech North Central", type: "generic", url: "https://www.fhtechnc.edu/" },
  { campus: "Fort Scott Community College", type: "generic", url: "https://www.fortscott.edu/" },
  { campus: "Friends University", type: "generic", url: "https://www.friends.edu/" },
];

// OK (Oklahoma)
const OK_CAMPUSES = [
  { campus: "Oklahoma State University", type: "generic", url: "https://jobs.okstate.edu/faculty/jobs" },
  { campus: "University of Oklahoma", type: "interfolio", url: "https://apply.interfolio.com/16123/positions" },
  { campus: "University of Oklahoma Health Sciences Center", type: "interfolio", url: "https://apply.interfolio.com/46259/positions" },
  { campus: "Autry Technology Center", type: "generic", url: "https://autrytech.tedk12.com/hire/index.aspx" },
  { campus: "Bacone College", type: "generic", url: "https://www.bacone.edu/" },
  {
    campus: "Cameron University",
    type: "generic",
    url: "https://jobs.silkroad.com/Cameron/Careers?StartDate=&EndDate=&SearchString=&SelectedCategory=36314&SelectedPositionType=FullTimeRegular#mainContent",
  },
  // Real ATS is TedK12/SchoolSpring (cvtech.tedk12.com, "View Our Open
  // Positions" link from this page, same platform already used un-scraped by
  // Autry Technology Center above). Confirmed real content there: 13
  // postings, many real current instructor openings ("Electrical Instructor
  // (FCI - El Reno)", "Plumbing Instructor (FCI - El Reno)", "Adjunct
  // Clinical Instructor LTCA - RN or LPN License"), but it's a card-based SPA
  // with no per-job <a href> at all -- no existing scraper handles this
  // platform's shape. Left as "generic" pointed at this page (which does
  // have a real, stable link out to the ATS) rather than the ATS URL
  // directly, since neither produces results without patching shared logic.
  { campus: "Canadian Valley Technology Center", type: "generic", url: "https://www.cvtech.edu/employment-opportunities" },
  { campus: "Carl Albert State College", type: "generic", url: "https://carlalbert.edu/about-casc/job-openings" },
  { campus: "College of the Muscogee Nation", type: "generic", url: "https://cmn.edu/" },
  { campus: "Community Care College", type: "generic", url: "https://www.communitycarecollege.edu/" },
  { campus: "Connors State College", type: "generic", url: "https://jobs.okstate.edu/connors-state-college-home" },
  // Was pointing at the bare homepage. The "Job Opportunities" HR page hands
  // off to this institution-specific BambooHR board (same platform already
  // used verbatim by Bay Mills Community College). Already correctly
  // extracted by the shared generic scraper once pointed at the right page,
  // no code change needed. Verified live (two fresh page loads): 2 real
  // current faculty postings (Adjunct Instructors - College of Liberal Arts
  // and Social Sciences; Instructor of Geographic Information Systems).
  { campus: "East Central University", type: "generic", url: "https://ecokedu.bamboohr.com/careers" },
  { campus: "Eastern Oklahoma State College", type: "generic", url: "https://www.eosc.edu/about/human-resources/employment-opportunities" },
  { campus: "Family of Faith Christian University", type: "generic", url: "https://www.familyoffaith.edu/" },
];

// MO (Missouri)
const MO_CAMPUSES = [
  {
    campus: "University of Missouri",
    type: "umsystem-hrs",
    url: "https://erecruit.umsystem.edu/psc/tamext/COLUM/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL&ACTION=U&FOCUS=Applicant&SiteId=9",
  },
  {
    campus: "University of Missouri-Kansas City",
    type: "umsystem-hrs",
    url: "https://erecruit.umsystem.edu/psc/tamext/KCITY/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL&ACTION=U&FOCUS=Applicant&SiteId=8",
  },
  {
    campus: "University of Missouri-St. Louis",
    type: "umsystem-hrs",
    url: "https://erecruit.umsystem.edu/psp/tamext/STLOU/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL&ACTION=U&FOCUS=Applicant&SiteId=11",
  },
  { campus: "Missouri State University", type: "generic", url: "https://jobs.missouristate.edu/postings/search" },
  { campus: "Washington University in St. Louis", type: "workday", url: "https://wustl.wd1.myworkdayjobs.com/External" },
  { campus: "Missouri University of Science and Technology", type: "generic", url: "https://jobs.mst.edu/postings/search?query_position_type_id%5B%5D=3" },
  { campus: "Drury University-College of Continuing Professional Studies", type: "generic", url: "https://www.drury.edu/hr/drury-university-jobs/" },
  { campus: "Urshan Graduate School of Theology", type: "generic", url: "https://urshan.edu/ugst" },
  { campus: "A T Still University of Health Sciences", type: "generic", url: "https://www.atsu.edu/employment" },
  { campus: "Aquinas Institute of Theology", type: "generic", url: "https://www.ai.edu/" },
  { campus: "Avila University", type: "adp", url: "https://workforcenow.cloud.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=f2ab6114-2e48-45a8-8ffc-c90819d5d7ff&ccId=19000101_000001&lang=en_US" },
  { campus: "Barnes-Jewish College Goldfarb School of Nursing", type: "generic", url: "https://www.barnesjewishcollege.edu/resources/nursing-careers" },
  { campus: "Bolivar Technical College", type: "generic", url: "https://www.bolivarcollege.edu/" },
  { campus: "Calvary University", type: "generic", url: "https://www.calvary.edu/employment" },
  { campus: "Central Christian College of the Bible", type: "generic", url: "https://centralbible.edu/about-central/employment" },
  { campus: "Central Methodist University-College of Graduate and Extended Studies", type: "generic", url: "https://www.centralmethodist.edu/" },
  { campus: "Central Methodist University-College of Liberal Arts and Sciences", type: "generic", url: "https://www.centralmethodist.edu/about/offices/human-resources/jobs-fayette/index-faculty.html" },
  { campus: "City Vision University", type: "generic", url: "https://www.cityvision.edu/" },
  // Configured URL (/academics/faculty-jobs) just renders the homepage.
  // Real page is /jobs, linked from the nav as "Human Resources". Verified
  // live: real current postings with faculty-containing anchor text
  // (Faculty Position in Computer Science, Adjunct Faculty in Agriculture/
  // Biology/Chemistry/Computer Science/Physics, Adjunct Faculty in Applied
  // Nutrition, Adjunct Faculty in Engineering, Adjunct Faculty in Political
  // Science, Adjunct Faculty in Studio Art, Adjunct Faculty in Theatre).
  { campus: "College of the Ozarks", type: "generic", url: "https://www.cofo.edu/jobs" },
  { campus: "Conception Seminary College", type: "generic", url: "https://www.conception.edu/" },
  // Was pointing at the bare homepage; the /about/careers/ page's "Search
  // careers" button links to this institution-specific Paycom tenant
  // (clientkey unique to Concordia Seminary, not a shared board). Generic
  // scraper already hands this off to the Paycom probe. Verified live: real
  // ATS, genuinely 0 faculty-titled openings right now (2 current postings,
  // both staff roles: Coordinator Health/Wellness/HR Part-Time, Enrollment
  // Operations Specialist) -- real infrastructure, not a coverage bug.
  { campus: "Concordia Seminary", type: "generic", url: "https://www.paycomonline.net/v4/ats/web.php/jobs?clientkey=7B3368F639C1C383CE30B8FEBA882F60&fromClientSide=true" },
  { campus: "Cottey College", type: "generic", url: "https://cottey.edu/employment" },
  // Was pointing at the bare homepage; the nav's "Jobs" link goes to the
  // real institution-specific positions page (full-time + part-time
  // sections listed directly in page text, plus a separate ministry-jobs
  // database for outside churches/students, not CTS's own hiring). Verified
  // live (two fresh page loads): genuinely 0 faculty/instructor postings
  // right now -- only "Associate Dean of Students" (full-time) and "Grounds
  // Maintenance" (part-time) currently listed.
  { campus: "Covenant Theological Seminary", type: "generic", url: "https://www.covenantseminary.edu/jobs" },
  { campus: "Cox College", type: "generic", url: "https://coxcollege.edu/" },
  { campus: "Crowder College", type: "generic", url: "https://www.crowder.edu/employment" },
  { campus: "Culver-Stockton College", type: "generic", url: "https://culver.edu/employment" },
  { campus: "Drury University", type: "generic", url: "https://www.drury.edu/academic-affairs/open-faculty-positions" },
  { campus: "East Central College", type: "generic", url: "https://www.eastcentral.edu/hr/employment-opportunities" },
  { campus: "Eden Theological Seminary", type: "generic", url: "https://www.eden.edu/faculty/jobs" },
  { campus: "Evangel University", type: "generic", url: "https://www.evangel.edu/" },
  { campus: "Evangel University-College of Online Learning", type: "generic", url: "https://www.evangel.edu/" },
  { campus: "Evangel University-James River Assembly of God Church", type: "generic", url: "https://www.evangel.edu/" },
  { campus: "Fontbonne University", type: "generic", url: "https://www.fontbonne.edu/" },
];

// KY (Kentucky)
const KY_CAMPUSES = [
  { campus: "Northern Kentucky University", type: "peopleadmin", url: "https://jobs.nku.edu/postings/search" },
  { campus: "Murray State University", type: "peopleadmin", url: "https://www.murraystatejobs.com/postings/search" },
  { campus: "Morehead State University", type: "peopleadmin", url: "https://moreheadstate.peopleadmin.com/postings/search" },
  // Was pointing at the bare campus homepage. Real ATS is the same PageUp
  // platform as Hopkinsville Community College above (careers.kctcs.edu),
  // this campus's own "gateway-jobs" tenant scoped further with the site's
  // own Faculty + Adjunct Faculty category facet (linked from the tenant's
  // own "See all Faculty openings" button). The given HINT URL was a single
  // job-detail page, not a real search/listing URL -- replaced with the
  // proper category-scoped search URL instead. Verified live (raw DOM dump,
  // not just the visually-rendered first card, since the results list is
  // virtualized/lazy-rendered past the viewport): 7 real postings, all
  // Gateway-tagged and Northern Kentucky-located (Florence/Edgewood/
  // Covington/Fort Wright), matching the page's own "Adjunct Faculty (5) +
  // Faculty (2)" category counts exactly with zero unaccounted-for entries
  // -- e.g. "Adjunct Faculty - Electrical Construction", "Clinical Nursing
  // Instructor Part-time", "Instructor - Interdisciplinary Early Childhood
  // Education and Program Coordinator".
  {
    campus: "Gateway Community and Technical College",
    type: "pageup",
    url: "https://careers.kctcs.edu/jobs/search/gateway-jobs?page=1&query=&category_uids%5B%5D=7bf29a1b2c109f72dcf4f573996c912e&category_uids%5B%5D=23ff5099afa2deb8b85349a245f8b261",
  },
  { campus: "Hopkinsville Community College", type: "pageup", url: "https://careers.kctcs.edu/jobs/search/hopkinsville-jobs" },
  { campus: "Alice Lloyd College", type: "generic", url: "https://www.alc.edu/" },
  { campus: "Asbury Theological Seminary", type: "generic", url: "https://asburyseminary.edu/info/employment" },
  { campus: "Asbury University", type: "generic", url: "https://www.asbury.edu/" },
  // Was pointing at the bare homepage. Real ATS is PageUp (careers.kctcs.edu,
  // KCTCS system-wide tenant filtered to Ashland). Verified live (two fresh
  // page loads): real current Adjunct Faculty postings (Adjunct Faculty Arts
  // and Sciences, Adjunct Industrial Maintenance Instructor, Part-time
  // Adjunct Nursing Clinical Instructor).
  { campus: "Ashland Community and Technical College", type: "pageup", url: "https://careers.kctcs.edu/jobs/search/ashland-jobs" },
  { campus: "Bellarmine University", type: "interviewexchange", url: "https://bellarmine.interviewexchange.com/static/clients/459BMM1/index.jsp" },
  // Was pointing at the bare homepage. Real ATS is NEOGOV/SchoolJobs
  // (schooljobs.com/careers/berea, linked from /human-resources/prospective-employees).
  // Verified live: 15 postings, incl. a real current "Adjunct Faculty"
  // opening. No existing KY dispatch case for "schooljobs" (function
  // scrapeSchoolJobsAs already exists) -- added one below.
  { campus: "Berea College", type: "schooljobs", url: "https://www.schooljobs.com/careers/berea" },
  { campus: "Big Sandy Community and Technical College", type: "generic", url: "https://bigsandy.kctcs.edu/" },
  { campus: "Bluegrass Community and Technical College", type: "generic", url: "https://bluegrass.kctcs.edu/" },
  { campus: "Brescia University", type: "generic", url: "https://www.brescia.edu/employment/" },
  { campus: "Campbellsville University", type: "generic", url: "https://www.campbellsville.edu/academics/academic-affairs/basc/career-services/employment-resources.html" },
  { campus: "Centre College", type: "generic", url: "https://www.centre.edu/about/employment-centre" },
  { campus: "Clear Creek Baptist Bible College", type: "generic", url: "https://ccbbc.edu/careers" },
  { campus: "Eastern Kentucky University", type: "generic", url: "https://careers.eku.edu/jobs/search" },
  { campus: "Elizabethtown Community and Technical College", type: "generic", url: "https://elizabethtown.kctcs.edu/" },
  // Was pointing at the bare homepage. Careers menu's "Faculty" page links
  // to this institution-specific ADP Workforce Now recruitment portal
  // (cid/ccId scoped to FNU). KY dispatcher had no "adp" case yet -- added
  // above. Verified live (two fresh page loads): 3 open postings, including
  // "Future Faculty position interest-CV Submission" and "Psychiatric
  // Mental Health NP Regional Clinical [Faculty]".
  {
    campus: "Frontier Nursing University",
    type: "adp",
    url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=6402b8ee-59dd-44df-9062-65b5c6f1338c&ccId=9200072699685_2&lang=en_US",
  },
];

// TN (Tennessee)
const TN_CAMPUSES = [
  { campus: "Middle Tennessee State University", type: "generic", url: "https://careers.mtsu.edu/jobs/search?page=1&employment_type_uids%5B%5D=631bbbc303d4bf114ecc14a243ae4fd8&employment_type_uids%5B%5D=1c7cbdbbab7a83ed143e662427bb71fb&employment_type_uids%5B%5D=6dba428614ebe4b8b23f08b99fa1ae7d&employment_type_uids%5B%5D=481b6f9c12f58817f1891af748b2a200&query=" },
  { campus: "Remington College-Memphis Campus", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=8a43162b-bbe7-4cdf-af0d-a628a4f65790&ccId=9201027240777_2&lang=en_US&&source=EN&selectedMenuKey=CareerCenter" },
  { campus: "Remington College-Nashville Campus", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=8a43162b-bbe7-4cdf-af0d-a628a4f65790&ccId=9201027241619_2&lang=en_US&&source=EN&selectedMenuKey=CareerCenter" },
  { campus: "American Baptist College", type: "adp", url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=be310d42-8bd7-429d-b06f-97f3e3a8fb26&ccId=19000101_000001&lang=en_US" },
  { campus: "Austin Peay State University", type: "generic", url: "https://www.apsu.edu/careers/" },
  { campus: "Baptist Health Sciences University", type: "generic", url: "https://careers.baptistonline.org/search/jobs?cfm3=BHSU%20University&ns_category=baptist-health-sciences-university" },
  { campus: "Belmont University", type: "generic", url: "https://www.belmont.edu/" },
  { campus: "Bethel University", type: "generic", url: "https://www.bethelu.edu/" },
  { campus: "Bryan College-Dayton", type: "generic", url: "https://www.bryan.edu/campus/employment" },
  { campus: "Carson-Newman University", type: "generic", url: "https://www.cn.edu/employment" },
  { campus: "Chattanooga State Community College", type: "generic", url: "https://careers.tbr.edu/jobs/search?page=1&department_uids%5B%5D=5e8b9af07af26b990281f98a55916b89&query=" },
  { campus: "Christian Brothers University", type: "generic", url: "https://www.cbu.edu/" },
  { campus: "Cleveland State Community College", type: "generic", url: "https://careers.tbr.edu/jobs/search?page=1&department_uids%5B%5D=69934bce71572d17bf08cc9694cd703b&query=" },
  { campus: "Columbia State Community College", type: "generic", url: "https://careers.tbr.edu/jobs/search?page=1&department_uids%5B%5D=00422e53b3658b451c3b786acccf7957&query=" },
  { campus: "Cumberland University", type: "paycom", url: "https://www.paycomonline.net/v4/ats/web.php/portal/DEB43C3FD051B594AA4F4829C8587DC3/career-page" },
  { campus: "Dyersburg State Community College", type: "generic", url: "https://careers.tbr.edu/jobs/search?page=1&department_uids%5B%5D=61c0f276056e339286da973ddb4bc056&department_uids%5B%5D=9f9e21fea409fb46e385bdbfa9c3b530&query=" },
  { campus: "East Tennessee State University", type: "generic", url: "https://www.etsu.edu/jobs/" },
  { campus: "Fisk University", type: "generic", url: "https://www.fisk.edu/about/administration/division-of-human-resources/employment-opportunities-at-fisk" },
  { campus: "Freed-Hardeman University", type: "generic", url: "https://recruiting.paylocity.com/recruiting/jobs/All/b4cbe30c-f4c8-4962-b4f9-b6dc9388b0f3/Freed-Hardeman-University?location=All%20Locations&department=Faculty" },
];

// AK (Alaska)
const AK_CAMPUSES = [
  { campus: "University of Alaska System", type: "generic", url: "https://careers.alaska.edu/jobs/search/faculty-jobs" },
  // "/faculty/jobs" actually redirects to the faculty bio/directory page (a
  // list of current faculty members with their degrees), not job postings.
  // The real "Employment & Volunteer" page (linked from the homepage
  // footer) lists current openings directly in page text, including
  // "Adjunct Faculty" roles (General Education/Science, Bible/Ministry).
  // Verified live (two fresh page loads): real adjunct faculty openings
  // present, though listed as plain text with no per-posting href.
  { campus: "Alaska Bible College", type: "generic", url: "https://www.akbible.edu/employment" },
  { campus: "Alaska Christian College", type: "generic", url: "https://alaskacc.edu/about/employment" },
  { campus: "Alaska Pacific University", type: "generic", url: "https://www.alaskapacific.edu/about/employment#openings" },
];

// HI (Hawaii)
const HI_CAMPUSES = [
  { campus: "University of Hawaii System", type: "schooljobs", url: "https://www.schooljobs.com/careers/hawaiiedu?keywords=faculty" },
  { campus: "Chaminade University of Honolulu", type: "generic", url: "https://chaminade.edu/employment-opportunities/" },
  { campus: "Brigham Young University-Hawaii", type: "generic", url: "https://www.byuh.edu/" },
];

/* ============================== EXPRESS ============================== */

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAREER_OVERRIDES_PATH = path.join(__dirname, "data", "career-url-overrides.json");

function loadCareerOverridesMap() {
  try {
    if (!fs.existsSync(CAREER_OVERRIDES_PATH)) return new Map();
    const payload = JSON.parse(fs.readFileSync(CAREER_OVERRIDES_PATH, "utf8"));
    const rows = Array.isArray(payload?.overrides) ? payload.overrides : [];
    const map = new Map();
    for (const row of rows) {
      const name = clean(row?.name || "").toLowerCase();
      const url = clean(row?.career_url || "");
      if (!name || !url) continue;
      map.set(name, { career_url: url, platform_type: clean(row?.platform_type || "") || null });
    }
    return map;
  } catch (e) {
    console.warn(`⚠️  Failed to load career URL overrides: ${e?.message || e}`);
    return new Map();
  }
}

const CAREER_OVERRIDES = loadCareerOverridesMap();

function resolveCareerUrlOverride(campusName, fallbackUrl) {
  const key = clean(campusName || "").toLowerCase();
  const override = CAREER_OVERRIDES.get(key);
  return override?.career_url || fallbackUrl;
}

function resolveCareerUrlOverridePlatform(campusName) {
  const key = clean(campusName || "").toLowerCase();
  return CAREER_OVERRIDES.get(key)?.platform_type || null;
}

// Every *_CAMPUSES array above is a static literal: campuses with a non-"generic"
// type dispatch straight to their specialized scraper using the HARDCODED url,
// never consulting career-url-overrides.json at all (only scrapeGenericJobPage
// does that). So when a Workday tenant migrates, a PeopleAdmin site gets replaced
// by Workday, etc., and a corrected URL gets discovered into the overrides file,
// institutions configured with a specific type keep silently scraping the stale
// URL forever — confirmed live for Furman University and Mount Holyoke College
// (dead Workday tenants, "Workday is currently unavailable"), Northern Kentucky
// University (PeopleAdmin URL redirects to a generic HR page; real listings are
// on Workday now), and William & Mary (same PeopleAdmin-was-replaced-by-Workday
// pattern). Mutate every array in place once overrides are loaded so every
// dispatch path — not just the generic one — sees the corrected data.
//
// If the override's platform differs from this campus's static type, route
// through "generic" rather than swapping to the override's exact platform: every
// state's dispatch chain already has a "generic" branch (scrapeGenericJobPage),
// which resolves this SAME override again and dispatches to the true specialized
// handler via OVERRIDE_PLATFORM_DISPATCH — so nothing is lost, and we never risk
// introducing a type a given state's chain has no branch for.
function applyCareerUrlOverridesInPlace(campuses) {
  for (const c of campuses) {
    const key = clean(c?.campus || "").toLowerCase();
    const override = CAREER_OVERRIDES.get(key);
    if (!override) continue;
    const overridePlatform = override.platform_type || c.type;
    c.type = overridePlatform === c.type ? c.type : "generic";
    c.url = override.career_url || c.url;
  }
}

for (const campuses of [
  CT_PRIVATE_CAMPUSES, UMASS_CAMPUSES, MA_PRIVATE_CAMPUSES, UC_CAMPUSES, CA_PRIVATE_CAMPUSES,
  NJ_CAMPUSES, NJ_PRIVATE_CAMPUSES, CLAREMONT_CAMPUSES, PA_CAMPUSES, PA_PRIVATE_CAMPUSES,
  NC_CAMPUSES, VA_CAMPUSES, SC_CAMPUSES, DE_CAMPUSES, MD_CAMPUSES, RI_CAMPUSES, RI_PRIVATE_CAMPUSES,
  NH_CAMPUSES, AZ_CAMPUSES, NY_SUNY_CAMPUSES, NY_PRIVATE_CAMPUSES, OR_CAMPUSES, WA_CAMPUSES,
  ME_CAMPUSES, VT_CAMPUSES, MN_CAMPUSES, ND_CAMPUSES, SD_CAMPUSES, NE_CAMPUSES, IA_CAMPUSES,
  WY_CAMPUSES, MT_CAMPUSES, WI_CAMPUSES, CO_CAMPUSES, OH_CAMPUSES, NM_CAMPUSES, NV_CAMPUSES,
  UT_CAMPUSES, MI_CAMPUSES, IL_CAMPUSES, ID_CAMPUSES, IN_CAMPUSES, WV_CAMPUSES, TX_CAMPUSES,
  FL_CAMPUSES, GA_CAMPUSES, AL_CAMPUSES, MS_CAMPUSES, LA_CAMPUSES, AR_CAMPUSES, KS_CAMPUSES,
  OK_CAMPUSES, MO_CAMPUSES, KY_CAMPUSES, TN_CAMPUSES, AK_CAMPUSES, HI_CAMPUSES,
]) {
  applyCareerUrlOverridesInPlace(campuses);
}

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const vueDistDir = path.join(__dirname, "web-vue", "dist");
if (fs.existsSync(vueDistDir)) {
  app.use("/vue", express.static(vueDistDir));
  app.get("/vue", (_req, res) => res.sendFile(path.join(vueDistDir, "index.html")));
  app.get("/vue/*", (_req, res) => res.sendFile(path.join(vueDistDir, "index.html")));
} else {
  app.get("/vue", (_req, res) => {
    res.status(503).send("Vue preview is not built yet. Run: cd web-vue && npm run build");
  });
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, data: null };

app.get("/api/jobs", async (req, res) => {

  try {
    const refresh = req.query.refresh === "1";
    if (!refresh && cache.data && Date.now() - cache.at < CACHE_TTL_MS) {
      return res.json({ cached: true, ...cache.data });
    }

    const data = await scrapeAllJobsStandalone();
    
    // Local GPU LLM summarization (offline)
    if (data && Array.isArray(data.jobs)) {
      console.log(`📡 Calling local summarizer for ${data.jobs.length} jobs`);
      data.jobs = await callLocalSummarizer(data.jobs);
      // Add systemGroup field to each job
      for (const job of data.jobs) {
        job.systemGroup = getSystemGroup(job.source) || null;
      }
      // Recompute count after enrichment/normalization
      data.count = data.jobs.length;
    }
cache = { at: Date.now(), data };

    // Write jobs.json for BOTH local (public) and GitHub Pages (docs)
    try {
      const targets = ["public", "docs"];
      for (const dir of targets) {
        const outDir = path.join(__dirname, dir);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, "jobs.json"), JSON.stringify(data, null, 2), "utf-8");
      }
      console.log("✅ Wrote jobs.json to /public and /docs");
    } catch (e) {
      console.error("❌ Failed to write jobs.json:", e?.message || e);
    }

    res.json({ cached: false, ...data });
  } catch (err) {
    console.error("❌ /api/jobs:", err);
    res.status(500).json({ error: "Scrape failed", details: String(err?.message || err) });
  }
});

function startServer() {
  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`   Refresh scrape: http://localhost:${PORT}/api/jobs?refresh=1`);
  });
}
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) startServer();

/* ======================= EXPORTED ENTRYPOINT ======================= */

export async function scrapeAllJobsStandalone() {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });

    let tasks = [
      { name: "CT", fn: () => scrapeCtAll(context) },
      { name: "AZ", fn: () => scrapeAzAll(context) },
      { name: "CSU", fn: () => scrapeCsuFaculty(context) },
      { name: "USG", fn: () => scrapeUsgFaculty(context) },
      { name: "TCSG", fn: () => scrapeTcsgFaculty() },
      { name: "UMass", fn: () => scrapeUmassAll(context) },
      { name: "UMass Amherst", fn: () => scrapeUmassAmherst(context) },
      { name: "MA Private", fn: () => scrapeMaPrivate(context) },
      { name: "UC", fn: () => scrapeUcAll(context) },
      { name: "CA Private", fn: () => scrapeCaPrivate(context) },
      { name: "CA CC", fn: () => scrapeCaCcRegistry() },
      { name: "NJ", fn: () => scrapeNjAll(context) },
      { name: "NC", fn: () => scrapeNcAll(context) },
      { name: "VA", fn: () => scrapeVaAll(context) },
      { name: "SC", fn: () => scrapeScAll(context) },
      { name: "DE", fn: () => scrapeDeAll(context) },
      { name: "MD", fn: () => scrapeMdAll(context) },
      { name: "RI", fn: () => scrapeRiAll(context) },
      { name: "PA", fn: () => scrapePaAll(context) },
      { name: "MI", fn: () => scrapeMiAll(context) },
            { name: "IL", fn: () => scrapeIlAll(context) },
{ name: "Claremont Colleges", fn: () => scrapeClaremontAll(context) },
      { name: "NY", fn: () => scrapeNyAll(context) },
      { name: "OR", fn: () => scrapeOrAll(context) },
      { name: "WA", fn: () => scrapeWaAll(context) },
      { name: "ME", fn: () => scrapeMeAll(context) },
      { name: "NH", fn: () => scrapeNhAll(context) },
      { name: "VT", fn: () => scrapeVtAll(context) },
      { name: "MN", fn: () => scrapeMnAll(context) },
      { name: "ND", fn: () => scrapeNdAll(context) },
      { name: "SD", fn: () => scrapeSdAll(context) },
      { name: "NE", fn: () => scrapeNeAll(context) },
      { name: "IA", fn: () => scrapeIaAll(context) },
      { name: "WY", fn: () => scrapeWyAll(context) },
      { name: "WI", fn: () => scrapeWiAll(context) },
      { name: "MT", fn: () => scrapeMtAll(context) },
      { name: "CO", fn: () => scrapeCoAll(context) },
      { name: "OH", fn: () => scrapeOhAll(context) },
      { name: "NM", fn: () => scrapeNmAll(context) },
      { name: "NV", fn: () => scrapeNvAll(context) },
      { name: "UT", fn: () => scrapeUtAll(context) },
      { name: "ID", fn: () => scrapeIdAll(context) },
      { name: "IN", fn: () => scrapeInAll(context) },
      { name: "WV", fn: () => scrapeWvAll(context) },
      { name: "GA", fn: () => scrapeGaAll(context) },
      { name: "AL", fn: () => scrapeAlAll(context) },
      { name: "MS", fn: () => scrapeMsAll(context) },
      { name: "LA", fn: () => scrapeLaAll(context) },
      { name: "AR", fn: () => scrapeArAll(context) },
      { name: "KS", fn: () => scrapeKsAll(context) },
      { name: "OK", fn: () => scrapeOkAll(context) },
      { name: "MO", fn: () => scrapeMoAll(context) },
      { name: "KY", fn: () => scrapeKyAll(context) },
      { name: "TN", fn: () => scrapeTnAll(context) },
      { name: "AK", fn: () => scrapeAkAll(context) },
      { name: "HI", fn: () => scrapeHiAll(context) },
      { name: "TX", fn: () => scrapeTxAll(context) },
      { name: "FL", fn: () => scrapeFlAll(context) },

    ];
    // Apply CAMPUS_ALLOWLIST (e.g., set CAMPUS_ALLOWLIST=UC to only scrape UC)
    tasks = tasks.filter(t => isAllowedSystem(t.name));

    // Track failures globally
    const failures = [];

    const results = await mapWithConcurrency(tasks, MAX_PARALLEL_SYSTEMS, async (t) => {
      try {
        return await t.fn();
      } catch (e) {
        const errMsg = e?.message || String(e);
        const shortErr = errMsg.includes("Timeout") ? "Timeout" : errMsg.substring(0, 50);
        console.error(`❌ ${t.name} scrape failed:`, errMsg);
        failures.push({ name: t.name, error: shortErr });
        return null;
      }
    });

    const jobs = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (Array.isArray(r)) jobs.push(...r);
    }

    // Normalize known noisy locations (e.g., building names) to campus city/state.
    const normalizedJobs = jobs.map(normalizeLocationByCollege).map(normalizeJobEnrichment);

    // Print failure summary
    if (failures.length > 0) {
      console.log("\n" + "=".repeat(60));
      console.log(`⚠️  SCRAPER FAILURES SUMMARY (${failures.length} failed):`);
      console.log("=".repeat(60));
      failures.forEach(f => console.log(`  • ${f.name}: ${f.error}`));
      console.log("=".repeat(60) + "\n");
    }

    // Global faculty filter: remove non-faculty jobs that slipped through individual scrapers
    const preFilterCount = normalizedJobs.length;
    let facultyJobs = normalizedJobs.filter(j => {
      const t = String(j.title || "").toLowerCase();
      // Reject news/announcement headlines scraped as jobs (e.g. "...Announces
      // Promotion of X to Full Professor...Learn More") — even though they
      // contain "professor"/"faculty". High-precision signals: a "Learn/Read
      // More" CTA suffix, news verbs, or a leading "Mon DD, YYYY |" date headline.
      if (/\b(learn|read)\s+more$/.test(t)) return false;
      if (/\b(announces|announced|celebrates|in memoriam|obituary|remembering|congratulat|receives)\b/.test(t)) return false;
      if (/(dean|president)['’]?s?\s+lists?\b|\bhonor roll\b|\bcommencement\b|\bmagazine\b/.test(t)) return false;
      if (/^\s*[a-z]+\.?\s+\d{1,2},?\s+\d{4}\s*\|/.test(t)) return false;
      // Keep if title contains faculty-related keywords
      if (looksFacultyish(t)) return true;
      // Also keep common academic titles not caught by looksFacultyish
      if (/\bdean\b/.test(t)) return true;
      if (/\bchair\b/.test(t) && /department|program/i.test(t)) return true;
      if (/\bfellow\b/.test(t) && !/\bfellow\s*(ship)?\b.*\bnon/i.test(t)) return true;
      if (/\bpost[\s-]?doc(?:toral)?\b/.test(t)) return true;
      // Remove junk titles like "View Details" or empty-ish titles
      if (t.length < 10) return false;
      if (/^view\s+details?$/i.test(t)) return false;
      return false;
    });

    // Safety fallback: if the global filter is too aggressive (especially NY feeds),
    // keep non-junk titles so summarization can still run.
    const filteredRatio = preFilterCount > 0 ? (facultyJobs.length / preFilterCount) : 1;
    if (preFilterCount > 0 && (facultyJobs.length === 0 || filteredRatio < 0.05)) {
      const fallbackJobs = normalizedJobs.filter(j => {
        const t = String(j?.title || "").trim();
        if (!t) return false;
        if (t.length < 8) return false;
        if (/^view\s+details?$/i.test(t)) return false;
        if (/^(job|position)\s*#?\d*$/i.test(t)) return false;
        return true;
      });
      if (fallbackJobs.length > 0 && (isNyOnlyRun() || facultyJobs.length === 0)) {
        console.warn(`⚠️  Global faculty filter looked over-aggressive (${preFilterCount} → ${facultyJobs.length}); using fallback set (${fallbackJobs.length})`);
        facultyJobs = fallbackJobs.map(normalizeJobEnrichment);
      }
    }
    if (preFilterCount !== facultyJobs.length) {
      console.log(`🔍 Global faculty filter: ${preFilterCount} → ${facultyJobs.length} (removed ${preFilterCount - facultyJobs.length} non-faculty jobs)`);
    }

    // Policy exclusion filter: remove campuses on the high-confidence restricted list.
    const beforePolicyExclusion = facultyJobs.length;
    facultyJobs = facultyJobs.filter((j) => !isPolicyExcludedCollege(j?.college));
    if (beforePolicyExclusion !== facultyJobs.length) {
      console.log(
        `🧾 Policy exclusions: ${beforePolicyExclusion} → ${facultyJobs.length} (removed ${beforePolicyExclusion - facultyJobs.length} jobs)`
      );
    }

    const beforeControlExclusion = facultyJobs.length;
    facultyJobs = facultyJobs.filter((j) => !isPrivateForProfitCollege(j?.college));
    if (beforeControlExclusion !== facultyJobs.length) {
      console.log(
        `🏷️  Control exclusions (private for-profit): ${beforeControlExclusion} → ${facultyJobs.length} (removed ${beforeControlExclusion - facultyJobs.length} jobs)`
      );
    }

    // Sort by title
    facultyJobs.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    return {
      scrapedAt: new Date().toISOString(),
      count: facultyJobs.length,
      jobs: facultyJobs,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ============================== HELPERS ============================== */

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Title-case a SHOUTING (all-caps) title while preserving acronyms and codes.
const TITLE_SMALL_WORDS = new Set(["a","an","and","as","at","but","by","for","from","in","nor","of","on","or","per","the","to","via","vs","with"]);
const TITLE_ACRONYMS = new Set(["AI","ML","IT","HR","PR","STEM","STEAM","ESL","EFL","GIS","HCI","CS","EE","ECE","CMS","AMO","RF","OB","GYN","ENT","ICU","ER","UX","UI","PHD","MD","DO","RN","LPN","BSN","MSN","DNP","CRNA","JD","LLM","MBA","MFA","MPH","DVM","EDD","PSYD","DDS","US","USA","UK","EU","NYC","DC","UC","CSU","SUNY","CUNY","VA","NIH","NSF","WOT","HS","II","III","IV","VI","VII"]);
function titleCaseShout(str) {
  let seen = 0;
  return str.replace(/[A-Za-z][A-Za-z0-9'’]*/g, (w) => {
    const isFirst = seen++ === 0;
    if (/[0-9]/.test(w)) return w;                 // codes like FH14 — leave as-is
    const up = w.toUpperCase();
    if (TITLE_ACRONYMS.has(up)) return up;         // known acronym → keep caps
    if (w.length === 1) return up;                 // single letter (e.g. "Clinical X")
    const lo = w.toLowerCase();
    if (!isFirst && TITLE_SMALL_WORDS.has(lo)) return lo;
    return lo.charAt(0).toUpperCase() + lo.slice(1);
  });
}

export function normalizeJobTitle(rawTitle) {
  let t = clean(rawTitle);
  if (!t) return t;
  // Some feeds leak HTML/media markup directly into title fields.
  t = stripHtmlToText(t);
  // Decode leftover HTML entities (e.g. "Dean&#39;s Office" → "Dean's Office",
  // "&#x2013;" → "–"). Then collapse "--" double-hyphens to a " - " separator.
  t = t.replace(/&#x27;|&#39;/gi, "'").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&quot;/gi, '"')
       .replace(/&#x([0-9a-f]{2,5});/gi, (_, h) => { try { return String.fromCharCode(parseInt(h, 16)); } catch { return _; } })
       .replace(/&#(\d{2,5});/g, (_, n) => { try { return String.fromCharCode(Number(n)); } catch { return _; } });
  t = t.replace(/\s*--\s*/g, " - ");
  t = t.replace(/^\s*(?:image|photo)\s+(?=[A-Z0-9])/i, "");
  t = t.replace(/\bimage[-\w]*\.(?:png|jpe?g|gif|svg|webp)\b/gi, " ");
  const dateToken =
    "(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{4}\\s*[-/]\\s*\\d{2,4}|\\d{2}\\s*[-/]\\s*\\d{2})";
  // Drop leading bracket tags like "[INTERNAL]" / "[RE-POST]".
  while (/^\[[^\]]{1,40}\]\s*/.test(t)) t = t.replace(/^\[[^\]]{1,40}\]\s*/, "");
  // Unwrap full-title brackets.
  t = t.replace(/^\[([^\]]+)\]$/, "$1");
  // Drop leading markdown-bold/asterisk status tags like "**INTERNAL ONLY**",
  // "*REVISED*", "*REPOST*" (the wrapped text must be an ALL-CAPS short tag so
  // real titles aren't touched), then strip any stray leading "**".
  while (/^\s*\*+\s*[A-Z][A-Z0-9 /&.-]{0,28}[A-Z]\s*\*+\s*/.test(t)) {
    t = t.replace(/^\s*\*+\s*[A-Z][A-Z0-9 /&.-]{0,28}[A-Z]\s*\*+\s*/, "");
  }
  t = t.replace(/^\s*\*+\s*/, "");
  // Strip leading date stamps and academic-year prefixes.
  t = t.replace(/^\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?\s*/i, "");
  t = t.replace(/^\s*(?:AY\s*)?'?\d{2,4}\s*(?:-|\/)\s*'?\d{2,4}\s*/i, "");
  // Strip leading requisition/posting numbers (e.g. Oracle CE "131520-Title" or
  // "822960 - Title"). Requires 5+ digits so 4-digit year prefixes are untouched.
  t = t.replace(/^\s*\d{5,}\s*-\s*(?=[A-Za-z])/, "");
  // Normalize a leading appointment-length prefix: "12 month- Title" / "10 Month
  // Title" / "9 month - Title" → "12-Month Title".
  t = t.replace(/^\s*(\d{1,2})\s*[- ]?\s*month\b[-\s]*/i, "$1-Month ");
  // Strip a leading UMiami-style college/department code prefix, e.g.
  // "A&S - PHI - Lecturer" → "Lecturer". Requires two ALL-CAPS code tokens so
  // normal titles ("MBA - Finance - Director", "ESL - Coordinator") are safe.
  t = t.replace(/^[A-Z][A-Z&]{0,4}\s*[-–]\s*[A-Z]{2,6}\s*[-–]\s+/, "");
  // Remove trailing requisition/position ids that pollute title text.
  t = t.replace(/\s*[—-]\s*#\d[\dA-Za-z/& -]*$/g, "");
  t = t.replace(/\s*-\s*#\d[\dA-Za-z/& ,.-]*(?=\s*[—-]\s*[A-Za-z])/g, "");
  t = t.replace(/\s+#\d[\dA-Za-z/& ,.-]*(?=\s*[—-]\s*[A-Za-z])/g, "");
  t = t.replace(/\s+#\d[\dA-Za-z/& -]*$/g, "");
  t = t.replace(/\s*-\s*\d{4,7}(?=\s*[—-]\s*[A-Za-z])/g, "");
  // Trailing parenthesized requisition codes like "(174831)" / "(R012345)":
  // a 5+ digit run with an optional short letter prefix and NO spaces, so real
  // qualifiers — "(9-month Tenure Track)", "(Tenure-Track)", "(VAPSHCS)" — survive.
  t = t.replace(/\s*\(\s*#?[A-Za-z]{0,4}\d{5,}[A-Za-z\d-]*\)\s*$/g, "");
  // Trailing bracketed requisition codes like "[R0148940]" / "[REQ-12345]":
  // bracket content with no spaces and a 3+ digit run (so "[K-12]" and word tags
  // are kept). Brackets at the end of a title are virtually always codes.
  t = t.replace(/\s*\[[^\]\s]*\d{3,}[^\]\s]*\]\s*$/g, "");
  // Drop a trailing asterisk-footnote status tag like "(*Restricted)" /
  // "(*Restricted*)" — the leading "*" marks it as a posting flag, not part of
  // the title. Real parentheticals (e.g. "(Tenure-Track)") don't start with "*".
  t = t.replace(/\s*\(\s*\*[^)]*\)\s*$/g, "");
  // Drop trailing posting-status tags: "(INTERNAL)" / "(External)" / "(Reposted)"
  // / "(Confidential)". (Meaningful parentheticals like "(Multiple Positions)"
  // and "(Tenure-Track)" are left alone.)
  t = t.replace(/\s*\((?:internal|external|confidential|reposted?|re-?post)\)\s*$/i, "");
  // Remove trailing dates and academic-year tails.
  t = t.replace(new RegExp(`\\s*(?:[—-]\\s*)?${dateToken}(?:\\s*(?:to|through|[-–—])\\s*${dateToken})?\\s*$`, "i"), "");
  t = t.replace(new RegExp(`\\s*\\((?:\\s*${dateToken}(?:\\s*(?:to|through|[-–—])\\s*${dateToken})?)\\)\\s*$`, "i"), "");
  t = t.replace(/\s*[—-]?\s*(?:AY\s*)?'?\d{2,4}\s*(?:-|\/)\s*'?\d{2,4}\s*$/i, "");
  // Drop "(AY 26/27)" / "(AY 26-27)" academic-year parenthetical tags.
  t = t.replace(/\s*\(\s*AY\b[^)]*\)/gi, "");
  // Michigan State HR title artifacts: drop the "1855" professorship prefix,
  // normalize "FixedTerm", and rewrite "{Rank}[-/ ]{Appointment} - Of {College}"
  // into the readable "{Rank} of {College} - {Appointment}". Anchored on " - Of "
  // (capital Of), an MSU-specific artifact, so other titles are unaffected.
  t = t.replace(/^\s*1855\s+(?=[A-Za-z])/, "");
  t = t.replace(/\bFixed[\s-]?Term\b/gi, "Fixed Term");
  {
    const msu = t.match(/^(.*?)\s*[-\s]\s*(Tenure System|Fixed Term|Health Programs(?:\s+Fixed Term)?)\s+-\s+Of\s+(.+)$/i);
    if (msu) {
      t = `${clean(msu[1])} of ${clean(msu[3])} - ${clean(msu[2])}`;
    } else {
      t = t.replace(/\s+-\s+Of\s+/g, " of ");
    }
  }
  // Repair concatenated all-caps titles seen on some feeds (e.g., Duke AJO).
  t = t.replace(/\bTENURETRACK\b/gi, "TENURE TRACK");
  t = t.replace(/\bASSISTANTPROFESSOR\b/gi, "ASSISTANT PROFESSOR");
  t = t.replace(/\bASSISTANTPROFESSOR1\b/gi, "ASSISTANT PROFESSOR");
  t = t.replace(/\bASSOCIATEPROFESSOR\b/gi, "ASSOCIATE PROFESSOR");
  t = t.replace(/\bASSOCIATEPROFESSOR1\b/gi, "ASSOCIATE PROFESSOR");
  t = t.replace(/\bASSOCPROFESSOR\b/gi, "ASSOCIATE PROFESSOR");
  t = t.replace(/\bPROFESSORIN\b/gi, "PROFESSOR IN ");
  t = t.replace(/\b(PROFESSOR|LECTURER|INSTRUCTOR|FACULTY)(\d+)\b/gi, "$1");
  // Strip feed tails that leak location/region/deadline metadata into the title:
  //   - University of Houston: "… - {City}, {State}, United States - {fragment}"
  //   - SUNY: "… Region: {region} Open until filled" (and a standalone deadline)
  // then trim any dangling trailing separators/punctuation left behind.
  {
    // UH feed: "{role} - {City}, {State}, United States[ - {tail}]". The tail is
    // sometimes the real subject ("English") and sometimes garbage ("of … Staff
    // Full-Time …"). Keep a short Title-Case subject, drop sentence/garbage tails.
    const uh = t.match(/^(.*?)\s*[-–—]\s+[^,\-–—]+,\s*[^,]+,\s*United States\b\s*(?:[-–—]\s*(.*))?$/i);
    if (uh) {
      const role = clean(uh[1]);
      const rest = clean(uh[2] || "");
      const subjectLike = rest && rest.length <= 45 && /^[A-Z]/.test(rest) && !/[.]/.test(rest) &&
        !/\b(staff|full-time|part-time|come work|the co|dean,)\b/i.test(rest);
      t = subjectLike ? `${role} - ${rest}` : role;
    }
  }
  t = t.replace(/\s+Region:\s.*$/i, "");
  t = t.replace(/\s*[-–—:,]?\s*open until filled\.?\s*$/i, "");
  // Strip trailing location metadata that some feeds append to the title (the
  // location lives in its own field). Three safe shapes, all anchored on a real
  // 2-letter US state code at the end:
  //  1. em-dash concatenation/location tail (Wayne State, Arizona): "… — of {dept} {City}, ST"
  //  2. comma-delimited location: "…, {Place}, ST"
  //  3. a curated known city joined by a space (USC "Los Angeles", Cameron "Lawton", …)
  const US_STATE = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
  t = t.replace(new RegExp(`\\s+—\\s.*,\\s*(?:${US_STATE})\\s*$`), "");
  t = t.replace(new RegExp(`,\\s*[A-Z][A-Za-z .'/-]+,\\s*(?:${US_STATE})\\s*$`), "");
  t = t.replace(new RegExp(`\\s+(?:Los Angeles|San Francisco|San Diego|Santa Barbara|Lawton|Anchorage|Poulsbo|Woodinville|Detroit|Tucson|Phoenix|Albuquerque|New Orleans|Pomona|Orange|Sacramento|Riverside),\\s*(?:${US_STATE})\\s*$`), "");
  // Collapse a trailing department/phrase that's an IMMEDIATE adjacent repeat —
  // some feeds append the department again at the end ("… Mechanical Engineering
  // Mechanical Engineering", "Family Medicine Family Medicine"). Only an exact
  // back-to-back repeat at the very end is collapsed, so non-repeats are safe.
  t = t.replace(/\b(\w+(?:[\s&/.-]+\w+){0,6})\s*[,;:–—-]?\s+\1\s*$/i, "$1");
  t = t.replace(/\s*\(\s*\)/g, "");          // drop empty parens "()" residue
  t = t.replace(/[\s\-–—|•:,]+$/, "");
  // Convert a fully-uppercase ("shouting") title to Title Case, preserving
  // acronyms/codes. Only when there are no lowercase letters and enough letters
  // to be a real title (not a deliberate short acronym).
  if (!/[a-z]/.test(t) && t.replace(/[^A-Za-z]/g, "").length >= 10) {
    t = titleCaseShout(t);
  }
  return clean(t);
}

function inferAcademicFieldsFromTitle(title) {
  const t = clean(title);
  if (!t) return { department: null, specialization: null };

  let dept = null;
  let spec = null;
  const normalizeField = (value) => {
    let v = clean(value || "");
    if (!v) return null;
    // Remove academic year prefixes that leak into department/specialization.
    v = v.replace(/^(?:AY\s*)?'?\d{2,4}\s*[/-]\s*\d{2,4}\b\s*[:\-]?\s*/i, "");
    v = v.replace(/^\d{4}\s*\/\s*\d{2,4}\b\s*[:\-]?\s*/i, "");
    v = v.replace(/^Pool\s*-\s*/i, "");
    v = v.replace(/\s*[-–]?\s*(?:AY\s*)?\d{4}\s*\/\s*\d{2,4}\s*$/i, "");
    v = v.replace(/\s*[—-]\s*AY\s*\d{4}\s*-\s*\d{4}\s*\(\d{3,}\)\s*$/i, "");
    v = v.replace(/\s*[—-]?\s*#\d[\dA-Za-z/& -]*$/i, "");
    v = v.replace(/\s*[—-]\s*(?:United|ed)\s+States.*$/i, "");
    v = v.replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/i, "");
    v = v.replace(/\s*[—-]\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/i, "");
    v = v.replace(/[—-]+\s*$/g, "");
    v = v.replace(/\s{2,}/g, " ").trim();
    return v || null;
  };

  // Pattern: "Assistant Professor of X", "Lecturer in Y", "Chair of Z"
  let m = t.match(/\b(?:Professor|Lecturer|Instructor|Chair)\s+(?:of|in)\s+(.+)$/i);

  // Pattern: "Postdoctoral ... in X"
  if (!m) m = t.match(/\bPost(?:doc|doctoral)\b.*?\bin\s+(.+)$/i);

  // Pattern: "Assistant Professor, Computer Science"
  if (!m) {
    const commaMatch = t.match(/\b(?:Professor|Lecturer|Instructor|Chair)[^,]*,\s*([A-Za-z][A-Za-z0-9 &/'().-]{2,100})$/i);
    if (commaMatch) m = [commaMatch[0], commaMatch[1]];
  }

  // Pattern: title previously enriched as "Title — Department Name"
  if (!m) {
    const parts = t.split(/\s+[—-]\s+/);
    if (parts.length >= 2) m = [parts[0], parts.slice(1).join(" — ")];
  }

  if (m && m[1]) {
    const value = clean(String(m[1]).replace(/[.;,:]+\s*$/g, ""));
    if (value && value.length <= 120) {
      let normalized = normalizeField(value);
      normalized = normalized?.replace(/^of\s+practice,\s*/i, "");
      normalized = normalized?.replace(/^practice,\s*/i, "");
      dept = normalized;
      spec = normalized;
    }
  }

  return { department: dept || null, specialization: spec || null };
}

function cleanDepartmentField(value) {
  let v = clean(value || "");
  if (!v) return null;
  v = v.replace(/^(?:United|ed)\s+States\s+/i, "");
  v = v.replace(/\s*(?:United|ed)\s+States.*$/i, "");
  v = v.replace(/\s*[—-]\s*(?:United|ed)\s+States.*$/i, "");
  v = v.replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/i, "");
  v = v.replace(/\s*[—-]\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/i, "");
  v = v.replace(/\s*[—-]\s*AY\s*\d{4}\s*-\s*\d{4}\s*\(\d{3,}\)\s*$/i, "");
  v = v.replace(/\s*[—-]?\s*#\d[\dA-Za-z/& -]*$/i, "");
  v = v.replace(/\s*-\s*\d{4,7}\s*$/i, "");
  v = v.replace(/\bFaculty\s+Faculty\b/gi, "Faculty");
  v = v.replace(/\s+\bFaculty\b\s*$/i, "");
  v = v.replace(/\s*(?:arrow-right--line|read more|learn more)\s*$/i, "");
  v = v.replace(/[—-]+\s*$/g, "");
  v = v.replace(/[|•]+$/g, "").trim();
  if (!v) return null;
  if (v.length > 120) return null;
  if (/^\/?\d{1,2}\/\d{1,2}\/\d{2,4}$/i.test(v)) return null;
  const low = v.toLowerCase();
  if (["summary", "job summary", "position summary", "overview", "description", "details"].includes(low)) return null;
  if (/^(assistant|associate|full|clinical|teaching|visiting|adjunct)\s+(professor|lecturer|instructor)\b/i.test(v)) return null;
  if (/^faculty\s*&\s*staff$/i.test(v)) return null;
  return v;
}

function normalizeJobEnrichment(job) {
  if (!job || typeof job !== "object") return job;

  let department = cleanDepartmentField(job.department);
  let specialization = cleanDepartmentField(job.specialization);

  const inferred = inferAcademicFieldsFromTitle(job.title || "");
  const inferredDept = cleanDepartmentField(inferred.department || inferred.specialization);

  if (!department) department = specialization || inferredDept || null;
  if (!specialization) specialization = inferredDept || department || null;

  return {
    ...job,
    department: department || null,
    specialization: specialization || null,
  };
}

const COLLEGE_LOCATION_DEFAULTS = {
  "University of Pennsylvania": "Philadelphia, PA",
  "Carnegie Mellon University": "Pittsburgh, PA",
  "Drexel University": "Philadelphia, PA",
  "Lehigh University": "Bethlehem, PA",
  "Villanova University": "Villanova, PA",
  "Bucknell University": "Lewisburg, PA",
  "Swarthmore College": "Swarthmore, PA",
  "Gettysburg College": "Gettysburg, PA",
  "Dickinson College": "Carlisle, PA",
  "Lafayette College": "Easton, PA",
  "Franklin & Marshall College": "Lancaster, PA",
  "Brown University": "Providence, RI",
  "Bryant University": "Smithfield, RI",
  "Providence College": "Providence, RI",
  "Rhode Island School of Design": "Providence, RI",
  "Salve Regina University": "Newport, RI",
  "Rhode Island College": "Providence, RI",
  "University of Rhode Island": "Kingston, RI",
  "University of Delaware": "Newark, DE",
  "Delaware State University": "Dover, DE",
  "Delaware Technical Community College": "Dover, DE",
  "Wilmington University": "New Castle, DE",
  "University of Maryland, Baltimore": "Baltimore, MD",
  "University of Maryland, Baltimore County": "Catonsville, MD",
  "University of Maryland, College Park": "College Park, MD",
  "Johns Hopkins University": "Baltimore, MD",
  "Morgan State University": "Baltimore, MD",
  "Towson University": "Towson, MD",
  "St. Mary's College of Maryland": "St. Mary's City, MD",
  "Goucher College": "Towson, MD",
  "University of Maine System": "Orono, ME",
  "Bates College": "Lewiston, ME",
  "Bowdoin College": "Brunswick, ME",
  "University of New Hampshire System": "Durham, NH",
  "Dartmouth College": "Hanover, NH",
  "Saint Anselm College": "Manchester, NH",
  "Colby College": "Waterville, ME",
  "CT State Community College": "New Britain, CT",
  "CT State Asnuntuck": "Enfield, CT",
  "CT State Capital": "Hartford, CT",
  "CT State Gateway": "New Haven, CT",
  "CT State Housatonic": "Bridgeport, CT",
  "CT State Manchester": "Manchester, CT",
  "CT State Naugatuck Valley": "Waterbury, CT",
  "CT State Norwalk": "Norwalk, CT",
  "CT State Quinebaug Valley": "Danielson, CT",
  "CT State Three Rivers": "Norwich, CT",
  "CT State Tunxis": "Farmington, CT",
  "Pomona College": "Claremont, CA",
  "Scripps College": "Claremont, CA",
  "Harvey Mudd College": "Claremont, CA",
  "Claremont Graduate University": "Claremont, CA",
  "University of Vermont": "Burlington, VT",
  "Middlebury College": "Middlebury, VT",
  "Bennington College": "Bennington, VT",
  "Saint Michael's College": "Colchester, VT",
  "University of Oregon": "Eugene, OR",
  "Southern Oregon University": "Ashland, OR",
  "Portland State University": "Portland, OR",
  "Oregon State University": "Corvallis, OR",
  "Oregon Institute of Technology": "Klamath Falls, OR",
  "Eastern Oregon University": "La Grande, OR",
  "Western Oregon University": "Monmouth, OR",
  "Reed College": "Portland, OR",
  "Lewis & Clark College": "Portland, OR",
  "Willamette University": "Salem, OR",
  "University of Portland": "Portland, OR",
  "Linfield University": "McMinnville, OR",
  "Pacific University": "Forest Grove, OR",
  "George Fox University": "Newberg, OR",
  "University of Washington": "Seattle, WA",
  "Washington State University": "Pullman, WA",
  "Western Washington University": "Bellingham, WA",
  "Eastern Washington University": "Cheney, WA",
  "Central Washington University": "Ellensburg, WA",
  "Evergreen State College": "Olympia, WA",
  "Seattle University": "Seattle, WA",
  "Gonzaga University": "Spokane, WA",
  "University of Puget Sound": "Tacoma, WA",
  "Whitman College": "Walla Walla, WA",
  "Whitworth University": "Spokane, WA",
  "Pacific Lutheran University": "Tacoma, WA",
  "Seattle Pacific University": "Seattle, WA",
  "Saint Martin's University": "Lacey, WA",
  "University of New Mexico": "Albuquerque, NM",
  "New Mexico State University": "Las Cruces, NM",
  "St. John's College (Santa Fe)": "Santa Fe, NM",
  "Colorado School of Mines": "Golden, CO",
  "University of Denver": "Denver, CO",
  "Colorado College": "Colorado Springs, CO",
  "Arizona State University": "Tempe, AZ",
  "Northern Arizona University": "Flagstaff, AZ",
  "University of Arizona": "Tucson, AZ",
  "Prescott College": "Prescott, AZ",
  "CU Boulder": "Boulder, CO",
  "CU Denver": "Denver, CO",
  "CU Anschutz": "Aurora, CO",
  "UCCS": "Colorado Springs, CO",
  "Colorado State University": "Fort Collins, CO",
  "University of Nevada, Reno": "Reno, NV",
  "University of Nevada, Las Vegas": "Las Vegas, NV",
  "Nevada State University": "Henderson, NV",
  "University of Utah": "Salt Lake City, UT",
  "Weber State University": "Ogden, UT",
  "Utah Valley University": "Orem, UT",
  "Southern Utah University": "Cedar City, UT",
  "Utah Tech University": "St. George, UT",
  "Utah State University": "Logan, UT",
  "Brigham Young University": "Provo, UT",
  "Westminster University (Utah)": "Salt Lake City, UT",
  "University of Idaho": "Moscow, ID",
  "Boise State University": "Boise, ID",
  "Idaho State University": "Pocatello, ID",
  "Lewis-Clark State College": "Lewiston, ID",
  "The College of Idaho": "Caldwell, ID",
  "Northwest Nazarene University": "Nampa, ID",
  "Ohio State University": "Columbus, OH",
  "University of Toledo": "Toledo, OH",
  "Ohio University": "Athens, OH",
  "Kent State University": "Kent, OH",
  "Cleveland State University": "Cleveland, OH",
  "Wright State University": "Dayton, OH",
  "University of Cincinnati": "Cincinnati, OH",
  "Case Western Reserve University": "Cleveland, OH",
  "University of Dayton": "Dayton, OH",
  "Oberlin College": "Oberlin, OH",
  "Kenyon College": "Gambier, OH",
  "Denison University": "Granville, OH",
  "Indiana University": "Bloomington, IN",
  "Indiana State University": "Terre Haute, IN",
  "Ball State University": "Muncie, IN",
  "University of Southern Indiana": "Evansville, IN",
  "Purdue University": "West Lafayette, IN",
  "University of Notre Dame": "Notre Dame, IN",
  "Butler University": "Indianapolis, IN",
  "DePauw University": "Greencastle, IN",
  "Wabash College": "Crawfordsville, IN",
  "Earlham College": "Richmond, IN",
  "West Virginia University": "Morgantown, WV",
  "Marshall University": "Huntington, WV",
  "West Virginia State University": "Institute, WV",
  "University of Charleston": "Charleston, WV",
  "West Virginia Wesleyan College": "Buckhannon, WV",
  "Bethany College (WV)": "Bethany, WV",
  "SUNY Onondaga Community College": "Onondaga, NY",
  "University of Minnesota": "Minneapolis, MN",
  "Minnesota State System": "St. Paul, MN",
  "Carleton College": "Northfield, MN",
  "Macalester College": "Saint Paul, MN",
  "University of North Dakota": "Grand Forks, ND",
  "North Dakota State University": "Fargo, ND",
  "University of Mary": "Bismarck, ND",
  "University of Jamestown": "Jamestown, ND",
  "South Dakota Board of Regents": "Pierre, SD",
  "South Dakota State University": "Brookings, SD",
  "University of South Dakota": "Vermillion, SD",
  "South Dakota School of Mines and Technology": "Rapid City, SD",
  "Black Hills State University": "Spearfish, SD",
  "Northern State University": "Aberdeen, SD",
  "Dakota State University": "Madison, SD",
  "Augustana University": "Sioux Falls, SD",
  "University of Sioux Falls": "Sioux Falls, SD",
  "University of Nebraska-Lincoln": "Lincoln, NE",
  "University of Nebraska Omaha": "Omaha, NE",
  "University of Nebraska Medical Center": "Omaha, NE",
  "Creighton University": "Omaha, NE",
  "Nebraska Wesleyan University": "Lincoln, NE",
  "Doane University": "Crete, NE",
  "University of Iowa": "Iowa City, IA",
  "Iowa State University": "Ames, IA",
  "University of Northern Iowa": "Cedar Falls, IA",
  "Drake University": "Des Moines, IA",
  "Grinnell College": "Grinnell, IA",
  "Luther College": "Decorah, IA",
  "University of Wyoming": "Laramie, WY",
  "Wyoming Catholic College": "Lander, WY",
  "UW-Madison": "Madison, WI",
  "UW-Milwaukee": "Milwaukee, WI",
  "UW System Comprehensives": "Madison, WI",
  "Marquette University": "Milwaukee, WI",
  "Beloit College": "Beloit, WI",
  "Lawrence University": "Appleton, WI",
  "St. Norbert College": "De Pere, WI",
  "Montana State University": "Bozeman, MT",
  "University of Montana": "Missoula, MT",
  "Carroll College": "Helena, MT",
  "Rocky Mountain College": "Billings, MT",
  "Central Michigan University": "Mount Pleasant, MI",
  "Eastern Michigan University": "Ypsilanti, MI",
  "Michigan Technological University": "Houghton, MI",
  "Michigan State University": "East Lansing, MI",
  "Oakland University": "Rochester, MI",
  "University of Michigan": "Ann Arbor, MI",
  "Wayne State University": "Detroit, MI",
  "Kalamazoo College": "Kalamazoo, MI",
  "Western Michigan University": "Kalamazoo, MI",
  "Northwestern University": "Evanston, IL",
  "University of Chicago": "Chicago, IL",
  "Chicago State University": "Chicago, IL",
  "Eastern Illinois University": "Charleston, IL",
  "Governors State University": "University Park, IL",
  "Illinois State University": "Normal, IL",
  "University of Illinois Chicago": "Chicago, IL",
  "University of Illinois Springfield": "Springfield, IL",
  "University of Illinois Urbana-Champaign": "Champaign, IL",
  "Northeastern Illinois University": "Chicago, IL",
  "Knox College": "Galesburg, IL",
  "Northern Illinois University": "DeKalb, IL",
  "Southern Illinois University Carbondale": "Carbondale, IL",
  "Southern Illinois University Edwardsville": "Edwardsville, IL",
  "Western Illinois University": "Macomb, IL",
  "University of Texas at Austin": "Austin, TX",
  "Texas A&M University": "College Station, TX",
  "University of Houston": "Houston, TX",
  "Texas Tech University": "Lubbock, TX",
  "University of Texas at Dallas": "Richardson, TX",
  "University of Texas at Arlington": "Arlington, TX",
  "University of Texas at San Antonio": "San Antonio, TX",
  "University of North Texas": "Denton, TX",
  "Rice University": "Houston, TX",
  "Baylor University": "Waco, TX",
  "Southern Methodist University": "Dallas, TX",
  "Texas Christian University": "Fort Worth, TX",
  "Trinity University": "San Antonio, TX",
  "Southwestern University": "Georgetown, TX",
  "University of Florida": "Gainesville, FL",
  "Florida State University": "Tallahassee, FL",
  "University of Central Florida": "Orlando, FL",
  "University of South Florida": "Tampa, FL",
  "Florida International University": "Miami, FL",
  "Florida Atlantic University": "Boca Raton, FL",
  "University of North Florida": "Jacksonville, FL",
  "University of Miami": "Coral Gables, FL",
  "Nova Southeastern University": "Fort Lauderdale, FL",
  "Rollins College": "Winter Park, FL",
  "Eckerd College": "St. Petersburg, FL",
  "Stetson University": "DeLand, FL",
  "New College of Florida": "Sarasota, FL",
  "Florida Southern College": "Lakeland, FL",
  "University of Georgia": "Athens, GA",
  "Georgia Institute of Technology": "Atlanta, GA",
  "Georgia State University": "Atlanta, GA",
  "Kennesaw State University": "Kennesaw, GA",
  "University of North Georgia": "Dahlonega, GA",
  "Emory University": "Atlanta, GA",
  "Mercer University": "Macon, GA",
  "Spelman College": "Atlanta, GA",
  "Morehouse College": "Atlanta, GA",
  "Agnes Scott College": "Decatur, GA",
  "Berry College": "Mount Berry, GA",
  "University of Alabama": "Tuscaloosa, AL",
  "Auburn University": "Auburn, AL",
  "University of Alabama at Birmingham": "Birmingham, AL",
  "University of South Alabama": "Mobile, AL",
  "Troy University": "Troy, AL",
  "Samford University": "Birmingham, AL",
  "Tuskegee University": "Tuskegee, AL",
  "Spring Hill College": "Mobile, AL",
  "University of Montevallo": "Montevallo, AL",
  "Huntingdon College": "Montgomery, AL",
  "University of Mississippi": "Oxford, MS",
  "Mississippi State University": "Starkville, MS",
  "University of Southern Mississippi": "Hattiesburg, MS",
  "Jackson State University": "Jackson, MS",
  "Mississippi University for Women": "Columbus, MS",
  "Delta State University": "Cleveland, MS",
  "Millsaps College": "Jackson, MS",
  "Belhaven University": "Jackson, MS",
  "Tougaloo College": "Tougaloo, MS",
  "Louisiana State University": "Baton Rouge, LA",
  "University of Louisiana at Lafayette": "Lafayette, LA",
  "University of New Orleans": "New Orleans, LA",
  "Louisiana Tech University": "Ruston, LA",
  "Tulane University": "New Orleans, LA",
  "Loyola University New Orleans": "New Orleans, LA",
  "Xavier University of Louisiana": "New Orleans, LA",
  "Dillard University": "New Orleans, LA",
  "Centenary College of Louisiana": "Shreveport, LA",
  "University of Arkansas": "Fayetteville, AR",
  "University of Arkansas at Little Rock": "Little Rock, AR",
  "Arkansas State University": "Jonesboro, AR",
  "University of Central Arkansas": "Conway, AR",
  "Arkansas Tech University": "Russellville, AR",
  "Harding University": "Searcy, AR",
  "Ouachita Baptist University": "Arkadelphia, AR",
  "Hendrix College": "Conway, AR",
  "Lyon College": "Batesville, AR",
  "University of Kansas": "Lawrence, KS",
  "Kansas State University": "Manhattan, KS",
  "Wichita State University": "Wichita, KS",
  "Emporia State University": "Emporia, KS",
  "Fort Hays State University": "Hays, KS",
  "Washburn University": "Topeka, KS",
  "Baker University": "Baldwin City, KS",
  "Bethany College (KS)": "Lindsborg, KS",
  "Southwestern College (KS)": "Winfield, KS",
  "University of Oklahoma": "Norman, OK",
  "Oklahoma State University": "Stillwater, OK",
  "University of Tulsa": "Tulsa, OK",
  "University of Central Oklahoma": "Edmond, OK",
  "Northeastern State University": "Tahlequah, OK",
  "Oral Roberts University": "Tulsa, OK",
  "Oklahoma City University": "Oklahoma City, OK",
  "University of Science and Arts of Oklahoma": "Chickasha, OK",
  "University of Missouri": "Columbia, MO",
  "University of Missouri-Kansas City": "Kansas City, MO",
  "Missouri State University": "Springfield, MO",
  "Washington University in St. Louis": "St. Louis, MO",
  "Saint Louis University": "St. Louis, MO",
  "University of Missouri-St. Louis": "St. Louis, MO",
  "Missouri University of Science and Technology": "Rolla, MO",
  "Truman State University": "Kirksville, MO",
  "Lindenwood University": "St. Charles, MO",
  "Westminster College (MO)": "Fulton, MO",
  "Drury University": "Springfield, MO",
  "University of Kentucky": "Lexington, KY",
  "University of Louisville": "Louisville, KY",
  "Western Kentucky University": "Bowling Green, KY",
  "Northern Kentucky University": "Highland Heights, KY",
  "Eastern Kentucky University": "Richmond, KY",
  "Murray State University": "Murray, KY",
  "Morehead State University": "Morehead, KY",
  "Berea College": "Berea, KY",
  "Centre College": "Danville, KY",
  "Transylvania University": "Lexington, KY",
  "University of Tennessee, Knoxville": "Knoxville, TN",
  "University of Memphis": "Memphis, TN",
  "Tennessee Tech University": "Cookeville, TN",
  "Middle Tennessee State University": "Murfreesboro, TN",
  "East Tennessee State University": "Johnson City, TN",
  "Vanderbilt University": "Nashville, TN",
  "Belmont University": "Nashville, TN",
  "Rhodes College": "Memphis, TN",
  "Sewanee: The University of the South": "Sewanee, TN",
  "Fisk University": "Nashville, TN",
  "Lipscomb University": "Nashville, TN",
  "University of Alaska System": "Anchorage, AK",
  "Chaminade University of Honolulu": "Honolulu, HI",
  "University of Hawaii System": "Honolulu, HI",
  "UC Berkeley": "Berkeley, CA",
  "UCLA": "Los Angeles, CA",
  "UC San Diego": "San Diego, CA",
  "UC San Francisco": "San Francisco, CA",
  "UC Santa Barbara": "Santa Barbara, CA",
  "UC Davis": "Davis, CA",
  "UC Irvine": "Irvine, CA",
  "UC Riverside": "Riverside, CA",
  "UC Santa Cruz": "Santa Cruz, CA",
  "UC Merced": "Merced, CA",
  "The College of New Jersey": "Ewing, NJ",
  "Kean University": "Union, NJ",
  "Montclair State University": "Montclair, NJ",
  "Rutgers, The State University of New Jersey": "New Brunswick, NJ",
  "New Jersey City University": "Jersey City, NJ",
  "New Jersey Institute of Technology": "Newark, NJ",
  "Ramapo College of New Jersey": "Mahwah, NJ",
  "Stockton University": "Galloway, NJ",
  "William Paterson University": "Wayne, NJ",
  "Cheyney University": "Cheyney, PA",
  "Commonwealth University": "Bloomsburg, PA",
  "East Stroudsburg University": "East Stroudsburg, PA",
  "Kutztown University": "Kutztown, PA",
  "Millersville University": "Millersville, PA",
  "PennWest": "California, PA",
  "Shippensburg University": "Shippensburg, PA",
  "Slippery Rock University": "Slippery Rock, PA",
  "West Chester University": "West Chester, PA",
  "The Pennsylvania State University": "University Park, PA",
  "Appalachian State University": "Boone, NC",
  "East Carolina University": "Greenville, NC",
  "Elizabeth City State University": "Elizabeth City, NC",
  "Fayetteville State University": "Fayetteville, NC",
  "North Carolina A&T State University": "Greensboro, NC",
  "North Carolina Central University": "Durham, NC",
  "NC State University": "Raleigh, NC",
  "UNC Asheville": "Asheville, NC",
  "UNC-Chapel Hill": "Chapel Hill, NC",
  "UNC Charlotte": "Charlotte, NC",
  "UNC Pembroke": "Pembroke, NC",
  "UNC School of the Arts": "Winston-Salem, NC",
  "UNC Wilmington": "Wilmington, NC",
  "Western Carolina University": "Cullowhee, NC",
  "Winston-Salem State University": "Winston-Salem, NC",
  "Duke University": "Durham, NC",
  "Wake Forest University": "Winston-Salem, NC",
  "Davidson College": "Davidson, NC",
  "Elon University": "Elon, NC",
  "UNC Greensboro": "Greensboro, NC",
  "University of Virginia": "Charlottesville, VA",
  "Virginia Tech": "Blacksburg, VA",
  "William & Mary": "Williamsburg, VA",
  "George Mason University": "Fairfax, VA",
  "Virginia Commonwealth University": "Richmond, VA",
  "Old Dominion University": "Norfolk, VA",
  "James Madison University": "Harrisonburg, VA",
  "University of Richmond": "Richmond, VA",
  "Washington and Lee University": "Lexington, VA",
  "Hollins University": "Roanoke, VA",
  "University of South Carolina": "Columbia, SC",
  "Clemson University": "Clemson, SC",
  "College of Charleston": "Charleston, SC",
  "Coastal Carolina University": "Conway, SC",
  "Winthrop University": "Rock Hill, SC",
  "The Citadel": "Charleston, SC",
  "Furman University": "Greenville, SC",
  "Wofford College": "Spartanburg, SC",
  "Presbyterian College": "Clinton, SC",
};

function toCollegeLocationKey(name) {
  let s = clean(normalizeCollegeName(String(name || ""))).toLowerCase();
  if (!s) return "";
  s = s.replace(/&/g, " and ");
  s = s.replace(/[’']/g, "");
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/\bthe\s+/g, "");
  s = s.replace(/\buniv(?:ersity)?\b/g, "university");
  s = s.replace(/\binst(?:itute)?\b/g, "institute");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

const COLLEGE_LOCATION_DEFAULTS_BY_KEY = new Map(
  Object.entries(COLLEGE_LOCATION_DEFAULTS).map(([college, location]) => [toCollegeLocationKey(college), location])
);

function getCollegeLocationFallback(collegeName) {
  const exact = COLLEGE_LOCATION_DEFAULTS[collegeName];
  if (exact) return exact;

  const key = toCollegeLocationKey(collegeName);
  if (!key) return null;

  const direct = COLLEGE_LOCATION_DEFAULTS_BY_KEY.get(key);
  if (direct) return direct;

  // Last-resort fuzzy match for minor token drift in scraper college labels.
  let best = null;
  let bestLen = 0;
  for (const [k, loc] of COLLEGE_LOCATION_DEFAULTS_BY_KEY.entries()) {
    if (k === key) return loc;
    if (k.includes(key) || key.includes(k)) {
      const l = Math.min(k.length, key.length);
      if (l > bestLen) {
        best = loc;
        bestLen = l;
      }
    }
  }
  return best || null;
}

function isLikelyGeographicLocation(location) {
  return !!normalizeUsLocation(location);
}

function normalizeUsLocation(location) {
  const t = clean(location);
  if (!t) return null;
  if (/^remote(\s+locations?)?$/i.test(t)) return "Remote";

  // If multiple locations are packed together, keep the first "City, ST" segment.
  let multi = t.match(/^([^,]{2,90},\s*[A-Z]{2})\s*,/i);
  if (multi) return clean(multi[1]).replace(/\s+([A-Z]{2})$/i, (_, s) => ` ${s.toUpperCase()}`);

  const stateNames = {
    Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
    Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
    Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA",
    Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
    Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
    "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH",
    Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA",
    Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
  };

  // "City, ST" or "City, ST, United States" (optionally with trailing campus descriptor)
  let m = t.match(/^([^,]{2,90}),\s*([A-Z]{2})(?:\s*,\s*United States)?(?:\s*\([^)]*campus[^)]*\))?(?:\s*-\s*.+)?$/i);
  if (m) return `${clean(m[1])}, ${m[2].toUpperCase()}`;

  // "City, State Name, United States" OR "City, State Name"
  m = t.match(/^([^,]{2,90}),\s*([A-Za-z .'-]{3,40})(?:\s*,\s*United States)?$/i);
  if (m) {
    const city = clean(m[1]);
    const stateName = clean(m[2]).replace(/\s+/g, " ");
    const abbr = stateNames[stateName] || null;
    if (abbr) return `${city}, ${abbr}`;
  }

  return null;
}

function normalizeLocationByCollege(job) {
  const sourceToState = {
    NY: "NY", CT: "CT", NJ: "NJ",
    "CT State": "CT",
    PA: "PA", RI: "RI", DE: "DE", MD: "MD", ME: "ME", NH: "NH", VT: "VT",
    NC: "NC", VA: "VA", SC: "SC",
    OR: "OR", WA: "WA",
    AZ: "AZ", UT: "UT", ID: "ID",
    MA: "MA", "UMass": "MA", "MA Private": "MA",
    "CA - CSU": "CA", CSU: "CA", UC: "CA", "CA Private": "CA", "Claremont Colleges": "CA", Claremont: "CA",
    CO: "CO", NM: "NM", NV: "NV", IL: "IL", MI: "MI", MN: "MN", ND: "ND", SD: "SD", NE: "NE", IA: "IA", WY: "WY", WI: "WI", MT: "MT", OH: "OH", IN: "IN", WV: "WV", TX: "TX", FL: "FL",
    GA: "GA", AL: "AL", MS: "MS", LA: "LA", AR: "AR", KS: "KS", OK: "OK", MO: "MO", KY: "KY", TN: "TN", AK: "AK", HI: "HI",
  };
  if (!job) return job;

  const fallback = getCollegeLocationFallback(job.college);
  const looksLikeInstitutionName = (text) =>
    /\b(university|college|institute|school|campus|polytechnic|academy|system)\b/i.test(String(text || ""));

  const normalized = normalizeUsLocation(job.location);
  if (normalized) {
    return { ...job, location: normalized };
  }

  // If we only have a city-like token, preserve it and append the source state.
  const raw = clean(job.location || "");
  const state = sourceToState[job.source] || null;
  const rawNoCampus = clean(raw.replace(/\s*\([^)]*campus[^)]*\)\s*$/i, ""));
  if (rawNoCampus && state && /^[\p{L}][\p{L} .'-]{1,80}$/u.test(rawNoCampus)) {
    if (fallback && looksLikeInstitutionName(rawNoCampus)) {
      return { ...job, location: fallback };
    }
    return { ...job, location: `${rawNoCampus}, ${state}` };
  }

  // Replace null or non-geographic locations with canonical campus city/state.
  if (fallback && (!raw || !isLikelyGeographicLocation(job.location))) {
    return { ...job, location: fallback };
  }
  if (state && raw && !isLikelyGeographicLocation(raw)) {
    return { ...job, location: fallback || `${clean(job.college || "Campus")}, ${state}` };
  }
  // Last resort: keep the record mappable as a campus-scoped location.
  if ((!raw || (state && raw.toUpperCase() === state)) && state) {
    return { ...job, location: fallback || `${clean(job.college || "Campus")}, ${state}` };
  }
  return job;
}

function uniqByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const u = (it?.url || "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(it);
  }
  return out;
}

function omitAdjunct(title) {
  const t = String(title || "").toLowerCase();
  return (
    /\bper\s*course\b/i.test(t) ||
    /part[\s-]?time/i.test(t) ||
    /parttime/i.test(t) ||
    /\bpt\b/i.test(t) ||
    /temporary/i.test(t) ||
    /\btemp\b/i.test(t) ||
    /\badministrator\b/i.test(t) ||
    /\badministrative\b/i.test(t) ||
    /\badmin\b/i.test(t)
  );
}

function omitUcFellowships(title) {
  return /\bfellow\b|\bfellowship\b/i.test(String(title || ""));
}


// Simple concurrency limiter for arrays of async tasks.
async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        out[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// Playwright occasionally throws "Execution context was destroyed" when a page
// auto-navigates (redirects / SPA transitions) while we are evaluating.
// This helper retries a few times and waits for the page to settle.
async function safeEvaluate(page, fn, { retries = 4, settleMs = 600 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      return await page.evaluate(fn);
    } catch (e) {
      const msg = String(e?.message || e);
      lastErr = e;
      const likely =
        msg.includes("Execution context was destroyed") ||
        msg.includes("Cannot find context with specified id") ||
        msg.includes("Target closed") ||
        msg.toLowerCase().includes("navigation") ||
        msg.toLowerCase().includes("frame was detached");
      if (!likely) throw e;
      await page.waitForTimeout(settleMs);
    }
  }
  throw lastErr;
}

// Navigate with retries for transient network failures. Some ATS hosts (e.g.
// careers.und.edu) sit behind a WAF that intermittently resets the connection
// on the listings path, so a single failed goto under-counts that source for
// the whole scrape. Retry on connection-reset / network errors only; surface
// anything else (bad URL, real 4xx) immediately.
async function gotoWithRetry(page, url, { retries = 3, settleMs = 1500, ...gotoOpts } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await page.goto(url, gotoOpts);
    } catch (e) {
      const msg = String(e?.message || e);
      lastErr = e;
      const transient =
        msg.includes("ERR_CONNECTION_RESET") ||
        msg.includes("ERR_CONNECTION_CLOSED") ||
        msg.includes("ERR_NETWORK_CHANGED") ||
        msg.includes("ERR_CONNECTION_REFUSED") ||
        msg.includes("ERR_TIMED_OUT") ||
        msg.includes("ERR_SOCKET_NOT_CONNECTED") ||
        msg.toLowerCase().includes("timeout");
      if (!transient || i === retries - 1) throw e;
      await page.waitForTimeout(settleMs * (i + 1)); // linear backoff
    }
  }
  throw lastErr;
}

export function looksFacultyish(title) {
  const s = String(title || "").toLowerCase();
  // Strict filter: only true faculty positions
  // Must contain professor, lecturer, instructor, faculty, or adjunct.
  // "Adjunct" alone (e.g. "Accounting Adjunct", "Spanish Adjunct") was missing
  // here -- titles that don't also say professor/instructor/lecturer/faculty
  // were silently dropped even though Adjunct is a tracked, first-class
  // category on the site (found via Adrian College / Belmont Abbey while
  // investigating the generic-scraper long tail, 2026-08-06). omitAdjunct()
  // still filters part-time/temp/per-course language separately below.
  return (
    s.includes("professor") ||
    s.includes("lecturer") ||
    s.includes("instructor") ||
    /\bfaculty\b/.test(s) ||
    /\badjunct\b/.test(s) ||
    // "Teaching Fellow" (e.g. "Visiting Teaching Fellow, 2026-27") is a real
    // faculty-track teaching appointment at small colleges (found at Dharma
    // Realm Buddhist University while investigating the generic-scraper long
    // tail, 2026-08-07) -- distinct from a plain "Fellow" (which is too
    // noisy/ambiguous on its own, e.g. research fellowships), so requires
    // "teaching" immediately alongside it.
    /\bteaching\s+fellows?\b/.test(s)
  );
}

/* ============================== CUNY ============================== */

// Fetch job description from CUNY detail page (requires JS rendering)
async function fetchCunyJobDescription(context, url, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const page = await context.newPage();
    try {
      await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Wait for JS to render content
      await page.waitForTimeout(2000);

      // Try to wait for job content to appear
      await page.waitForSelector('[class*="description"], [class*="job-detail"], [class*="content"], article', { timeout: 5000 }).catch(() => {});

      const description = await page.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

        // Try multiple selectors for job description
        const selectors = [
          '[class*="job-description"]',
          '[class*="description"]',
          '[class*="job-detail"]',
          '[class*="job-content"]',
          'article',
          '[class*="content"]',
          'main',
        ];

        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const text = clean(el.innerText);
            // Skip if too short or looks like navigation
            if (text.length > 200 && !text.startsWith("Jobs |")) {
              return text.slice(0, 5000); // Limit size
            }
          }
        }

        // Fallback: get visible text from body
        const body = document.body?.innerText || "";
        return clean(body).slice(0, 5000);
      });

      return description;
    } catch (e) {
      console.log(`CUNY detail fetch attempt ${attempt} failed for ${url}: ${e?.message}`);
      if (attempt === maxRetries) return null;
    } finally {
      await page.close().catch(() => {});
    }
  }
  return null;
}

// Fetch descriptions for multiple CUNY jobs in parallel
async function fetchCunyJobDescriptions(context, jobs, concurrency = 4) {
  const results = [...jobs];

  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(jobs.length / concurrency);
    console.log(`  Fetching CUNY descriptions batch ${batchNum}/${totalBatches}...`);

    const descriptions = await Promise.all(
      batch.map((job, idx) => fetchCunyJobDescription(context, job.url).then(desc => ({ idx: i + idx, desc })))
    );

    for (const { idx, desc } of descriptions) {
      if (desc) results[idx].description = desc;
    }
  }

  return results;
}

async function scrapeCunyFaculty(context) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, CUNY_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Wait for job links to appear (JS-rendered page)
    console.log("Waiting for CUNY jobs to load...");
    await page.waitForSelector('a[href*="/job/"]', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Check if we have any jobs before trying to expand
    const initialCount = await countCunyJobLinks(page);
    console.log(`CUNY initial job count: ${initialCount}`);

    if (initialCount > 0) {
      await expandToAllCunyJobs(page);
    }

    // Extract jobs directly from the listing page instead of fetching each one
    const jobs = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const results = [];
      const seen = new Set();

      // CUNY job cards typically have job title links
      const jobCards = document.querySelectorAll('a[href*="/job/"]');

      for (const a of jobCards) {
        const href = a.getAttribute("href");
        if (!href) continue;

        try {
          const url = new URL(href, location.href).toString();
          if (seen.has(url)) continue;
          seen.add(url);

          // Get the title — prefer a heading element inside the anchor
          const heading = a.querySelector("h1, h2, h3, h4, h5, h6, strong, [class*='title'], [role='heading']");
          let title = heading ? clean(heading.textContent) : "";
          if (!title || title.length < 5) {
            // Fall back to full text but strip location/campus suffixes
            title = clean(a.textContent);
            // Remove trailing location patterns like "New York, NYGRADUATE CENTER"
            title = title.replace(/(?:,?\s*(?:New York|Brooklyn|Bronx|Staten Island|Queens),?\s*NY).*$/i, "").trim();
          }

          // Skip if title looks like a navigation element
          if (!title || title.length < 5) continue;
          if (/^(apply|view|more|details|click|here)$/i.test(title)) continue;

          // Try to find college/campus info from nearby elements
          let college = null;
          const card = a.closest('article, .job-card, .job-listing, [class*="job"], li, tr, div');
          if (card) {
            // Look for location/campus info
            const locEl = card.querySelector('[class*="location"], [class*="campus"], [class*="college"], .job-location');
            if (locEl) college = clean(locEl.textContent);

            // Fallback: look for text that matches CUNY college names
            const cardText = card.textContent || "";
            const collegeMatch = cardText.match(/(Borough of Manhattan|Bronx|Brooklyn|City College|College of Staten Island|Hostos|Hunter|John Jay|Kingsborough|LaGuardia|Lehman|Medgar Evers|New York City College|Queens|Queensborough|York College|Baruch|BMCC|Graduate Center|School of Law|School of Professional Studies|CUNY\s+\w+)/i);
            if (collegeMatch && !college) college = clean(collegeMatch[1]);
          }

          results.push({ title, url, college });
        } catch {}
      }

      return results;
    });

    console.log(`CUNY jobs extracted from listing: ${jobs.length}`);

    const filtered = jobs
      .filter((j) => j.title && j.title.length > 5)
      .filter((j) => !omitAdjunct(j.title))
      .map((j) => ({
        title: j.title,
        url: j.url,
        source: "NY",
        category: "Faculty",
        college: normalizeCollegeName(j.college) || "City University of New York (CUNY)",
        location: null,
        description: null,
      }));

    console.log(`CUNY jobs after filtering: ${filtered.length}`);

    // Close listing page before fetching details
    await page.close().catch(() => {});

    // Fetch descriptions from detail pages (CUNY requires JS rendering)
    console.log(`Fetching CUNY job descriptions (JS-rendered pages)...`);
    const withDescriptions = await fetchCunyJobDescriptions(context, filtered, 4);

    const withDesc = withDescriptions.filter(j => j.description && j.description.length > 100).length;
    console.log(`CUNY jobs with descriptions: ${withDesc}/${filtered.length}`);

    return withDescriptions;
  } finally {
    // Page already closed above
  }
}

async function expandToAllCunyJobs(page) {
  const maxRounds = 120;
  const stableNeeded = 5;

  let stableRounds = 0;
  let prevCount = 0;

  const totalTarget = await tryParseTotalJobs(page);

  for (let round = 1; round <= maxRounds; round++) {
    const currentCount = await countCunyJobLinks(page);

    if (totalTarget && currentCount >= totalTarget) break;

    if (currentCount > prevCount) {
      prevCount = currentCount;
      stableRounds = 0;
    } else {
      stableRounds += 1;
    }
    if (stableRounds >= stableNeeded) break;

    const clicked = await clickMoreControl(page);
    if (clicked) {
      await waitForCunyLinkIncrease(page, currentCount, 12_000).catch(() => {});
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(clicked ? 1200 : 900);
  }
}

async function tryParseTotalJobs(page) {
  try {
    const txt = await page.evaluate(() => document.body?.innerText || "");
    const t = txt.replace(/\s+/g, " ");

    let m = t.match(/\b(\d{2,4})\s+Jobs\b/i);
    if (m) return Number(m[1]);

    m = t.match(/\bof\s+(\d{2,4})\b/i);
    if (m) return Number(m[1]);

    return null;
  } catch {
    return null;
  }
}

async function countCunyJobLinks(page) {
  return page.evaluate(() => {
    const urls = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      try {
        const u = new URL(a.href, location.href);
        if (/\/job\/?$/i.test(u.pathname)) urls.add(u.toString());
      } catch {}
    }
    return urls.size;
  });
}

async function waitForCunyLinkIncrease(page, previousCount, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const c = await countCunyJobLinks(page);
    if (c > previousCount) return;
    await page.waitForTimeout(350);
  }
  throw new Error("CUNY job link count did not increase in time");
}

async function clickMoreControl(page) {
  const roleCandidates = [
    page.getByRole("button", { name: /more|load more|show more/i }),
    page.getByRole("link", { name: /more|load more|show more/i }),
  ];

  for (const loc of roleCandidates) {
    try {
      if ((await loc.count()) > 0 && (await loc.first().isVisible({ timeout: 300 }))) {
        await loc.first().scrollIntoViewIfNeeded().catch(() => {});
        await loc.first().click({ timeout: 2000 }).catch(() => {});
        return true;
      }
    } catch {}
  }

  const selectors = [
    'button:has-text("More")',
    'button:has-text("Load more")',
    'button:has-text("Show more")',
    'a:has-text("More")',
    'a:has-text("Load more")',
    'a:has-text("Show more")',
  ];

  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      if ((await loc.count()) && (await loc.isVisible({ timeout: 300 }))) {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ timeout: 2000 }).catch(() => {});
        return true;
      }
    } catch {}
  }

  return false;
}

/* ============================== CT ============================== */

async function scrapeCtFacultyTeaching(context) {
  const page = await context.newPage();
  await gotoWithRetry(page, CT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(900);

  const beforeSig = await ctResultsSignature(page);

  const facultyInput = page.locator("#Faculty");
  if (await facultyInput.count()) {
    await facultyInput.check({ force: true }).catch(async () => {
      await page.locator('label[for="Faculty"]').click({ force: true });
    });
  } else {
    await page.locator('label[for="Faculty"]').click({ force: true }).catch(() => {});
  }

  await page
    .getByRole("button", { name: /apply|filter|search|submit|go|update/i })
    .first()
    .click()
    .catch(() => {});
  await waitForCtResultsUpdate(page, beforeSig).catch(() => {});
  await page.waitForTimeout(500);

  const ctJobs = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const abs = (href) => {
      try {
        return new URL(href, location.href).toString();
      } catch {
        return null;
      }
    };

    const extractCtStateCampus = (containerText) => {
      const m = (containerText || "").match(/CT State\s+[A-Za-z][A-Za-z\s]+/i);
      return m ? norm(m[0]) : null;
    };

    const out = [];
    const seen = new Set();
    const rows = Array.from(document.querySelectorAll("table tbody tr"));

    for (const tr of rows) {
      const a = tr.querySelector("a[href]");
      if (!a) continue;

      const url = abs(a.getAttribute("href"));
      const title = norm(a.textContent);
      if (!url || !title) continue;
      if (seen.has(url)) continue;

      const college = extractCtStateCampus(tr.innerText || "");
      if (!college) continue;

      seen.add(url);
      out.push({
        title,
        college,
        description: null,
        url,
        source: "CT State",
        category: "Faculty/Teaching",
      });
    }
    return out;
  });

  console.log(`CT Faculty/Teaching results scraped: ${ctJobs.length}`);
  await page.close().catch(() => {});
  return ctJobs;
}

async function ctResultsSignature(page) {
  return page.evaluate(() => {
    const main = document.querySelector("main") || document.querySelector('[role="main"]') || document.body;
    const txt = (main?.innerText || "").replace(/\s+/g, " ").trim();
    return txt.slice(0, 1400);
  });
}

async function waitForCtResultsUpdate(page, beforeSig) {
  const start = Date.now();
  while (Date.now() - start < 15_000) {
    const sig = await ctResultsSignature(page);
    if (sig && sig !== beforeSig) return;
    await page.waitForTimeout(250);
  }
  throw new Error("CT results did not update in time");
}

// Scrape Yale Academic Positions (Drupal paginated table)
async function scrapeYaleAcademicPositions(context, campusName, sourceName) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();
    const baseUrl = "https://academicpositions.yale.edu/job-posting";
    let consecutiveEmpty = 0;

    for (let pageNo = 0; pageNo <= 25; pageNo++) {
      const url = pageNo === 0 ? baseUrl : `${baseUrl}?page=${pageNo}`;

      // Retry page navigation up to 2 times (handles transient failures under load)
      let batch = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 90_000 });
          await page.waitForTimeout(1200);

          batch = await safeEvaluate(page, () => {
            const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
            const abs = (href) => {
              try { return new URL(href, location.href).toString(); } catch { return null; }
            };

            const out = [];
            // Yale uses table rows with links to job postings
            const rows = document.querySelectorAll("table tbody tr, .view-content .views-row, .views-table tbody tr");
            for (const row of rows) {
              const a = row.querySelector("a[href]");
              if (!a) continue;
              const href = abs(a.getAttribute("href"));
              const title = clean(a.textContent);
              if (!href || !title || title.length < 6) continue;
              out.push({ title, url: href });
            }

            // Fallback: if no table rows, try all links that look like job postings
            if (out.length === 0) {
              const links = document.querySelectorAll('a[href*="/job-posting/"], a[href*="/node/"]');
              for (const a of links) {
                const href = abs(a.getAttribute("href"));
                const title = clean(a.textContent);
                if (!href || !title || title.length < 6) continue;
                // Skip pagination/nav links
                if (/^(next|previous|first|last|\d+|›|‹|»|«)$/i.test(title)) continue;
                out.push({ title, url: href });
              }
            }

            // de-dupe within page
            const s = new Set();
            return out.filter((x) => (x.url && !s.has(x.url) ? (s.add(x.url), true) : false));
          });

          if (batch.length > 0 || attempt >= 2) break;
          // Empty result on first attempts — wait longer and retry (page may not have loaded fully)
          await page.waitForTimeout(2000);
        } catch (navErr) {
          if (attempt >= 2) throw navErr;
          await page.waitForTimeout(3000);
        }
      }

      let addedThisPage = 0;
      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        jobs.push({
          title: j.title,
          url: j.url,
          source: sourceName,
          category: "Faculty",
          college: campusName,
          location: "New Haven, CT",
          description: null,
        });
        addedThisPage++;
      }

      // Require 2 consecutive empty pages to stop (handles transient empty results under load)
      if (addedThisPage === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 2) break;
      } else {
        consecutiveEmpty = 0;
      }
    }

    // Yale pages often keep department/specialization in detail content.
    // Enrich each listing with metadata so summarizer has better signals.
    const enriched = await enrichYaleJobsWithDetails(context, jobs, campusName, sourceName);

    console.log(`${campusName} ${sourceName} listings scraped: ${enriched.length}`);
    return uniqByUrl(enriched);
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

function stripHtmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractYaleDeptFromText(text) {
  if (!text) return null;
  const patterns = [
    /(?:Department|Program|Division)\s*:\s*([A-Za-z&/,\- ]{3,100})/i,
    /School\s+of\s+([A-Za-z&/,\- ]{3,100})/i,
    /in\s+the\s+Department\s+of\s+([A-Za-z&/,\- ]{3,100})/i,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m && m[1]) {
      const v = clean(m[1]).replace(/[|;,:]+$/, "").trim();
      if (v.length >= 3 && v.length <= 100) return v;
    }
  }
  return null;
}

async function enrichYaleJobsWithDetails(context, jobs, campusName, sourceName) {
  const concurrency = Math.max(2, Number(process.env.YALE_DETAIL_CONCURRENCY || 6));
  return await mapWithConcurrency(jobs, concurrency, async (j) => {
    try {
      const res = await context.request.get(j.url, { timeout: 45_000 });
      if (!res.ok()) return j;
      const html = await res.text();
      const text = stripHtmlToText(html);

      // Prefer meta description for concise summary seed; fallback to visible text slice.
      const metaDescMatch = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']{20,2000})["']/i);
      const description = clean(metaDescMatch?.[1] || text.slice(0, 2500)) || null;

      const dept = extractYaleDeptFromText(text);
      let title = clean(j.title);
      if (dept && !title.toLowerCase().includes(dept.toLowerCase())) {
        title = `${title} — ${dept}`;
      }

      return {
        title,
        url: j.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: j.location || "New Haven, CT",
        description,
      };
    } catch {
      return j;
    }
  });
}

// Scrape private CT universities + UConn
async function scrapeCtPrivate(context) {
  const results = await mapWithConcurrency(
    CT_PRIVATE_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "CT");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "CT");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "CT");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "CT");
        if (type === "paycom") return await scrapePaycomAs(context, url, campus, "CT");
        if (type === "yale") return await scrapeYaleAcademicPositions(context, campus, "CT");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} CT scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

async function scrapeCtAll(context) {
  const [ctStateJobs, privateJobs] = await Promise.all([
    scrapeCtFacultyTeaching(context),
    scrapeCtPrivate(context),
  ]);
  return uniqByUrl([...ctStateJobs, ...privateJobs]);
}

/* ===================== CA Community Colleges (CCC Career Connect) ===================== */
// Statewide CA community-college job board (formerly the CCC Registry, migrated to
// a new platform Jan 2025), backed by a tRPC JSON API. ONE source covers ~all CA
// CCs with per-college attribution via jobCreator.name — so CA community colleges
// are scraped system-wide here, NOT per-campus, which avoids the shared-district-
// portal duplication (cf. the CSU "never per-campus for members" rule).
const CA_CC_API = "https://www.communitycollegecareerconnect.com/api/trpc";
const CA_CC_JOB_URL = "https://www.communitycollegecareerconnect.com/jobs/";
// Keep full-time, permanent faculty only — the board is ~90% part-time/adjunct/
// temporary pools, which the omit-adjunct policy excludes. (The API misspells the
// tenure-track position value as "Tenture".)
const CA_CC_KEEP_POSITIONS = new Set(["FullTime", "FullTimeTentureTrack"]);

function caCcTrpcUrl(proc, json) {
  return `${CA_CC_API}/${proc}?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json } }))}`;
}

async function caCcFetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`CA CC HTTP ${res.status}`);
  return (await res.json())?.[0]?.result?.data?.json;
}

async function scrapeCaCcRegistry() {
  const base = { jobTitle: "", jobCreatorName: "", classification: "Faculty", position: null, categories: null, regions: null, positions: null, display: null };

  let total = 0;
  try {
    total = Number(await caCcFetchJson(caCcTrpcUrl("job.countManyPublicSQL", { ...base, currentPage: 1 }))) || 0;
  } catch (e) {
    console.error("❌ CA CC count failed:", e?.message || e);
    return [];
  }
  if (!total) return [];

  const pages = Math.ceil(total / 12); // the API returns 12 jobs/page
  const perPage = await mapWithConcurrency(
    Array.from({ length: pages }, (_, i) => i + 1),
    6,
    async (p) => {
      try {
        const rows = await caCcFetchJson(caCcTrpcUrl("job.getManyPublicSQL", { ...base, currentPage: p }));
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    }
  );

  const seen = new Set();
  const jobs = [];
  for (const rows of perPage) {
    for (const r of rows || []) {
      if (!r?.id || !CA_CC_KEEP_POSITIONS.has(r.position) || seen.has(r.id)) continue;
      seen.add(r.id);
      jobs.push({
        title: clean(r.title),
        url: CA_CC_JOB_URL + r.id,
        source: "CA CC",
        category: clean(r.category?.niceName || r.category?.name || "Faculty"),
        college: clean(r.jobCreator?.name || ""),
        location: r.jobCreator?.region ? clean(r.jobCreator.region) : null,
        description: null,
      });
    }
  }
  // omitAdjunct backstop: the position tag is occasionally "FullTime" on titles
  // that say "Adjunct"/"Part-Time" — trust the title for those.
  const out = jobs.filter((j) => j.college && !omitAdjunct(j.title));
  console.log(`CA CC: ${total} faculty postings → ${out.length} full-time/permanent across ${new Set(out.map((j) => j.college)).size} colleges`);
  return out;
}

/* ============================== CSU ============================== */

async function scrapeCsuFaculty(context) {
  const page = await context.newPage();
  await gotoWithRetry(page, CSU_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(900);

  const jobs = await scrapeEnUsFilterSite(page, {
    source: "CSU",
    campus: null,
    category: "Instructional Faculty – Tenured/Tenure-Track",
  });

  console.log(`CSU listing scraped: ${jobs.length}`);

  const detailMap = await fetchCsuDetailsFromDetails(context, jobs.map((j) => j.url), 6);
  return jobs.map((j) => {
    const d = detailMap.get(j.url);
    const inferredCollege =
      j.college ||
      d?.college ||
      mapCsuLocationToCampus(d?.location) ||
      inferCsuCampusFromText(d?.aboutText) ||
      null;
    return {
      ...j,
      college: inferredCollege,
      location: j.location || d?.location || null,
    };
  });
}

// CSU campuses' own materials (job postings, "about" text) write their names in the
// comma style ("California State University, Bakersfield"), but IPEDS — and every
// other institution name in this dataset (institutions-master.json, server.js campus
// configs, policy-rules.json) — uses the hyphenated form ("California State
// University-Bakersfield"). Returning the comma form here made these campuses
// invisible to coverage tracking despite having real, current jobs: the job-count
// lookup in build-institutions-master.js matches by exact name, and the two forms
// never matched. Always resolve to the IPEDS/canonical hyphenated form.
function mapCsuLocationToCampus(location) {
  if (!location) return null;
  const key = clean(String(location));
  const byLocation = {
    "Bakersfield": "California State University-Bakersfield",
    "Channel Islands": "California State University-Channel Islands",
    "Chico": "California State University-Chico",
    "Dominguez Hills": "California State University-Dominguez Hills",
    "East Bay": "California State University-East Bay",
    "Fresno": "California State University-Fresno",
    "Fullerton": "California State University-Fullerton",
    "Humboldt": "California State Polytechnic University-Humboldt",
    "Long Beach": "California State University-Long Beach",
    "Los Angeles": "California State University-Los Angeles",
    "Maritime Academy": "California State University Maritime Academy",
    "Monterey Bay": "California State University-Monterey Bay",
    "Northridge": "California State University-Northridge",
    "Pomona": "California State Polytechnic University-Pomona",
    "Sacramento": "California State University-Sacramento",
    "San Bernardino": "California State University-San Bernardino",
    "San Diego": "San Diego State University",
    "San Francisco": "San Francisco State University",
    "San Jose": "San Jose State University",
    "San José": "San Jose State University",
    "San Luis Obispo": "California Polytechnic State University-San Luis Obispo",
    "San Marcos": "California State University-San Marcos",
    "Sonoma": "Sonoma State University",
    "Stanislaus": "California State University-Stanislaus",
  };
  return byLocation[key] || null;
}

// Same canonical-name goal as mapCsuLocationToCampus, but matched out of free text
// (a job posting's "about" section) rather than a structured location field — so the
// patterns look for the comma form campuses actually use in prose, then map each hit
// to the same IPEDS canonical name. The previous version returned the raw regex
// capture directly with an open-ended character class, which both kept the wrong
// (comma) name AND occasionally swallowed trailing address text into the "name"
// (e.g. "California State University, Stanislaus One University Circle Turlock").
function inferCsuCampusFromText(text) {
  if (!text) return null;
  const cleaned = clean(String(text));
  const patterns = [
    [/\bCalifornia State University Channel Islands\b/i, "California State University-Channel Islands"],
    [/\bCalifornia State University,\s*Bakersfield\b/i, "California State University-Bakersfield"],
    [/\bCalifornia State University,\s*Chico\b/i, "California State University-Chico"],
    [/\bCalifornia State University,\s*Dominguez Hills\b/i, "California State University-Dominguez Hills"],
    [/\bCalifornia State University,\s*East Bay\b/i, "California State University-East Bay"],
    [/\bCalifornia State University,\s*Fresno\b/i, "California State University-Fresno"],
    [/\bCalifornia State University,\s*Fullerton\b/i, "California State University-Fullerton"],
    [/\bCalifornia State University,\s*Long Beach\b/i, "California State University-Long Beach"],
    [/\bCalifornia State University,\s*Los Angeles\b/i, "California State University-Los Angeles"],
    [/\bCalifornia State University Maritime Academy\b/i, "California State University Maritime Academy"],
    [/\bCalifornia State University,\s*Monterey Bay\b/i, "California State University-Monterey Bay"],
    [/\bCalifornia State University,\s*Northridge\b/i, "California State University-Northridge"],
    [/\bCalifornia State University,\s*Sacramento\b/i, "California State University-Sacramento"],
    [/\bCalifornia State University,\s*San Bernardino\b/i, "California State University-San Bernardino"],
    [/\bCalifornia State University San Marcos\b/i, "California State University-San Marcos"],
    [/\bCalifornia State University,\s*Stanislaus\b/i, "California State University-Stanislaus"],
    [/\bCalifornia State Polytechnic University,\s*Pomona\b/i, "California State Polytechnic University-Pomona"],
    [/\bCalifornia State Polytechnic University,\s*Humboldt\b/i, "California State Polytechnic University-Humboldt"],
    [/\bCalifornia Polytechnic State University,\s*San Luis Obispo\b/i, "California Polytechnic State University-San Luis Obispo"],
    [/\bSan Diego State University\b/i, "San Diego State University"],
    [/\bSan Francisco State University\b/i, "San Francisco State University"],
    [/\bSan Jose State University\b/i, "San Jose State University"],
    [/\bSonoma State University\b/i, "Sonoma State University"],
    [/\bCal Poly Humboldt\b/i, "California State Polytechnic University-Humboldt"],
  ];
  for (const [re, canonical] of patterns) {
    if (re.test(cleaned)) return canonical;
  }
  return null;
}

async function fetchCsuDetailsFromDetails(context, urls, concurrency = 6) {
  const out = new Map();
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const url = urls[idx++];
      const page = await context.newPage();
      try {
        await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(500);

        const details = await page.evaluate(() => {
          const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

          const getFromDtDd = (wantedKeys) => {
            const dts = Array.from(document.querySelectorAll("dt"));
            for (const dt of dts) {
              const k = clean(dt.textContent).toLowerCase();
              if (!wantedKeys.some((w) => k.includes(w))) continue;
              const dd = dt.nextElementSibling;
              const v = clean(dd?.textContent);
              if (v) return v;
            }
            return null;
          };

          const location =
            getFromDtDd(["work location"]) ||
            getFromDtDd(["location"]) ||
            getFromDtDd(["city"]) ||
            clean(document.querySelector('#job-content span.location')?.textContent) ||
            null;

          const college =
            getFromDtDd(["campus"]) ||
            getFromDtDd(["organization"]) ||
            getFromDtDd(["agency"]) ||
            null;

          let orgFromLd = null;
          if (!college) {
            const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            for (const s of scripts) {
              try {
                const j = JSON.parse(s.textContent);
                const nodes = Array.isArray(j) ? j : j?.["@graph"] ? j["@graph"] : [j];
                for (const n of nodes) {
                  if (!n || typeof n !== "object") continue;
                  const org = n.hiringOrganization;
                  if (typeof org === "string") orgFromLd = clean(org);
                  else if (org && typeof org === "object" && typeof org.name === "string") orgFromLd = clean(org.name);
                  if (orgFromLd) break;
                }
              } catch {}
              if (orgFromLd) break;
            }
          }

          const aboutText = clean(document.querySelector('#job-details')?.innerText || "");
          return { location, college: college || orgFromLd || null, aboutText };
        });

        out.set(url, details);
      } catch {
        // ignore failures
      } finally {
        await page.close().catch(() => {});
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

/* ============================== USG ============================== */
// University System of Georgia: a shared PeopleSoft HCM careers site (not the
// simpler "en-us/filter" platform CSU/UMass use). No JSON API and no per-job
// deep-link URL exposed in the DOM (rows are onclick postback handlers, not
// <a href> links) — verified against the live site 2026-07-17. Pagination is
// a classic PeopleSoft "get more rows" postback (.ps_box-more), not scroll-
// triggered virtualization, so we click it and wait for each batch rather
// than scrolling.
const USG_CANONICAL_CAMPUSES = [
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
  // UGA, Georgia State University, and Georgia Tech run their own separate
  // PeopleAdmin sites (GA_CAMPUSES) and have never appeared as a Business
  // Unit on this feed in testing — deliberately omitted so a coincidental
  // future label match can't misattribute jobs to them.
];

function normalizeUsgBusinessUnit(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, "and")
    .replace(/\buniv\b/g, "university")
    .replace(/\bga\b/g, "georgia")
    .replace(/\bagri\b/g, "agricultural")
    .replace(/\bmetro\b/g, "metropolitan")
    .replace(/\s+/g, " ")
    .trim();
}

const USG_BUSINESS_UNIT_LOOKUP = new Map(
  USG_CANONICAL_CAMPUSES.map((name) => [normalizeUsgBusinessUnit(name), name])
);

function mapUsgBusinessUnitToCampus(businessUnit) {
  return USG_BUSINESS_UNIT_LOOKUP.get(normalizeUsgBusinessUnit(businessUnit)) || null;
}

// Parses the grid's rendered text into job rows. Each row is a consistent
// block: title line, then "Job ID<n>", "Location<..>", "Department<..>",
// "Business Unit<..>", "Posted Date<..>" — order-independent per field since
// we match by prefix, and bounded to stop at the next "Job ID" marker.
function parseUsgJobsFromText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const jobs = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^Job ID(\d+)$/.exec(lines[i]);
    if (!m) continue;
    const jobId = m[1];
    const title = lines[i - 1] || "";
    let location = "", department = "", businessUnit = "", postedDate = "";
    for (let k = i + 1; k < Math.min(i + 6, lines.length); k++) {
      const l = lines[k];
      if (l.startsWith("Location")) location = l.slice("Location".length).trim();
      else if (l.startsWith("Department")) department = l.slice("Department".length).trim();
      else if (l.startsWith("Business Unit")) businessUnit = l.slice("Business Unit".length).trim();
      else if (l.startsWith("Posted Date")) postedDate = l.slice("Posted Date".length).trim();
      else if (/^Job ID\d+$/.test(l)) break;
    }
    jobs.push({ jobId, title, location, department, businessUnit, postedDate });
  }
  return jobs;
}

async function scrapeUsgFaculty(context) {
  const page = await context.newPage();
  await gotoWithRetry(page, USG_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4000);

  const seenIds = new Map();
  let stableRounds = 0;
  for (let round = 0; round < 60 && stableRounds < 3; round++) {
    const text = await safeEvaluate(page, () => document.body.innerText);
    for (const j of parseUsgJobsFromText(text || "")) {
      if (!seenIds.has(j.jobId)) seenIds.set(j.jobId, j);
    }

    const clicked = await safeEvaluate(page, () => {
      const more = document.querySelector(".ps_box-more");
      if (!more) return false;
      more.click();
      return true;
    }).catch(() => false);
    if (!clicked) break;
    await page.waitForTimeout(1800);

    const after = await safeEvaluate(page, () => document.body.innerText);
    const newCount = parseUsgJobsFromText(after || "").length;
    stableRounds = newCount > seenIds.size ? 0 : stableRounds + 1;
  }
  await page.close().catch(() => {});

  let unmatched = 0;
  const jobs = [];
  for (const j of seenIds.values()) {
    if (!looksFacultyish(j.title)) continue;
    const campus = mapUsgBusinessUnitToCampus(j.businessUnit);
    if (!campus) { unmatched++; continue; }
    jobs.push({
      title: clean(j.title),
      url: `${USG_URL}#jobId=${j.jobId}`,
      source: "USG",
      category: "faculty",
      college: campus,
      location: j.location || null,
      description: null,
    });
  }
  if (unmatched > 0) {
    console.log(`USG: ${unmatched} faculty postings had an unrecognized Business Unit (not in USG_CANONICAL_CAMPUSES) — skipped.`);
  }
  console.log(`USG listing scraped: ${jobs.length} faculty postings across ${new Set(jobs.map((j) => j.college)).size} campuses`);
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

/* ============================== TCSG ============================== */
// Technical College System of Georgia: a WordPress site running the WP Job
// Manager plugin, shared across the system office + all 22 colleges. Unlike
// USG, this needs no browser session at all — jm-ajax/get_listings/ is a
// plain public POST endpoint (verified 2026-07-19) that returns
// {max_num_pages, html}, with html being the listing <li> markup. Each
// listing's "company" text field is empty (blank in every posting observed),
// but its logo image filename (.../<slug>-web-150x150.png) reliably encodes
// the posting college, so that's what we key off of instead.
const TCSG_URL = "https://www.tcsg.edu/jm-ajax/get_listings/";
const TCSG_CANONICAL_CAMPUSES = [
  "Albany Technical College",
  "Athens Technical College",
  "Atlanta Technical College",
  "Augusta Technical College",
  "Central Georgia Technical College",
  "Chattahoochee Technical College",
  "Coastal Pines Technical College",
  "Columbus Technical College",
  "Georgia Northwestern Technical College",
  "Georgia Piedmont Technical College",
  "Gwinnett Technical College",
  "Lanier Technical College",
  "North Georgia Technical College",
  "Oconee Fall Line Technical College",
  "Ogeechee Technical College",
  "Savannah Technical College",
  "South Georgia Technical College",
  "Southeastern Technical College",
  "Southern Crescent Technical College",
  "Southern Regional Technical College",
  "West Georgia Technical College",
  "Wiregrass Georgia Technical College",
];

function normalizeTcsgSlug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Exact match on the name minus "Technical College" first (handles all slugs
// observed live: albany, atlanta, chattahoochee, coastal-pines, gwinnett,
// southeastern, wiregrass). Falls back to a substring match only when it's
// unambiguous — an unrecognized or ambiguous slug is dropped rather than
// guessed, same "no silent false attribution" rule as the USG mapping.
const TCSG_SLUG_LOOKUP = TCSG_CANONICAL_CAMPUSES.map((name) => ({
  name,
  norm: normalizeTcsgSlug(name.replace(/\s*Technical College$/i, "")),
}));
function mapTcsgSlugToCampus(slug) {
  const norm = normalizeTcsgSlug(slug);
  if (!norm) return null;
  const exact = TCSG_SLUG_LOOKUP.find((c) => c.norm === norm);
  if (exact) return exact.name;
  const candidates = TCSG_SLUG_LOOKUP.filter((c) => c.norm.includes(norm) || norm.includes(c.norm));
  return candidates.length === 1 ? candidates[0].name : null;
}

function parseTcsgListingsHtml(html) {
  const out = [];
  const liRe = /<li class="post-\d+ job_listing type-job_listing status-(\w+)[\s\S]*?<\/li>\n?/g;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const block = m[0];
    const status = m[1];
    if (status !== "publish") continue; // skip status-expired

    const hrefMatch = /<a href="([^"]+)"/.exec(block);
    const titleMatch = /<h3>([\s\S]*?)<\/h3>/.exec(block);
    const logoMatch = /-web-150x150\.png/.test(block) ? /uploads\/2017\/06\/([a-z0-9-]+)-web-150x150\.png/.exec(block) : null;
    if (!hrefMatch || !titleMatch) continue;

    const title = clean(titleMatch[1].replace(/<[^>]+>/g, " "));
    const url = hrefMatch[1].replace(/&#(?:0*38|x26);/gi, "&");
    const campus = logoMatch ? mapTcsgSlugToCampus(logoMatch[1]) : null;
    out.push({ title, url, campus });
  }
  return out;
}

async function scrapeTcsgFaculty() {
  let unmatched = 0;
  const jobs = [];
  try {
    for (let page = 1; page <= 10; page++) {
      const resp = await fetch(TCSG_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 FacultyJobs/1.0" },
        body: new URLSearchParams({ search_keywords: "", search_location: "", page: String(page), per_page: "50" }).toString(),
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) break;
      const data = await resp.json();
      const listings = parseTcsgListingsHtml(data.html || "");
      for (const l of listings) {
        if (!looksFacultyish(l.title)) continue;
        if (!l.campus) { unmatched++; continue; }
        jobs.push({
          title: l.title,
          url: l.url,
          source: "TCSG",
          category: "faculty",
          college: l.campus,
          location: null,
          description: null,
        });
      }
      if (page >= Number(data.max_num_pages || 1)) break;
    }
  } catch (e) {
    console.error("❌ TCSG scrape failed:", e?.message || e);
    return [];
  }
  if (unmatched > 0) {
    console.log(`TCSG: ${unmatched} faculty postings had an unrecognized college logo — skipped.`);
  }
  console.log(`TCSG listing scraped: ${jobs.length} faculty postings across ${new Set(jobs.map((j) => j.college)).size} campuses`);
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

/* ============================== UMass ============================== */

async function scrapeUmassAll(context) {
  const out = [];

  await Promise.all(
    UMASS_CAMPUSES.map(async ({ campus, url }) => {
      try {
        const page = await context.newPage();
        await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(900);

        const jobs = await scrapeEnUsFilterSite(page, {
          source: "UMass",
          campus,
          category: "Faculty Full Time",
        });

        console.log(`${campus} listing scraped: ${jobs.length}`);
        out.push(...jobs);
        await page.close().catch(() => {});
      } catch (e) {
        console.error(`❌ ${campus} UMass scrape failed:`, e?.message || e);
      }
    })
  );

  return uniqByUrl(out);
}

/* ===== UMass Amherst (PageUp platform - new as of Jan 2026) ===== */

async function scrapeUmassAmherst(context) {
  const jobs = [];
  const page = await context.newPage();

  try {
    await gotoWithRetry(page, UMASS_AMHERST_URL, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(2000);

    // PageUp sites load jobs dynamically - wait for job cards
    await page.waitForSelector('a[href*="/jobs/"], .job-card, .job-listing, [data-job-id]', { timeout: 15_000 }).catch(() => {});

    let pageNum = 1;
    const maxPages = 10;

    while (pageNum <= maxPages) {
      const batch = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const out = [];

        // Try multiple selectors for PageUp job cards
        const jobLinks = Array.from(document.querySelectorAll('a[href*="/jobs/"]'));

        for (const a of jobLinks) {
          const href = a.getAttribute("href");
          if (!href || href.includes("/jobs/search")) continue;

          let title = clean(a.textContent);
          if (!title || title.length < 5) {
            const container = a.closest("li, article, div, tr") || a.parentElement;
            const h = container?.querySelector?.("h1,h2,h3,h4,.job-title,.title,strong");
            title = clean(h?.textContent) || title;
          }

          if (title && title.length >= 5) {
            const url = new URL(href, location.href).toString();
            out.push({ title, url });
          }
        }

        // Dedupe
        const seen = new Set();
        return out.filter((j) => {
          if (seen.has(j.url)) return false;
          seen.add(j.url);
          return true;
        });
      });

      for (const j of batch) {
        if (!jobs.find((x) => x.url === j.url)) {
          jobs.push({
            ...j,
            source: "UMass",
            college: "UMass Amherst",
            category: "Faculty",
            location: null,
            description: null,
          });
        }
      }

      console.log(`UMass Amherst page ${pageNum}: ${batch.length} jobs`);

      // Try to find and click next page
      const nextBtn = page.locator('a[aria-label*="Next" i], button[aria-label*="Next" i], a:has-text("Next"), .pagination a:last-child').first();
      if ((await nextBtn.count().catch(() => 0)) > 0 && (await nextBtn.isVisible().catch(() => false))) {
        const prevUrl = page.url();
        await nextBtn.click().catch(() => {});
        await page.waitForTimeout(2000);
        if (page.url() === prevUrl) break;
        pageNum++;
      } else {
        break;
      }
    }

    console.log(`UMass Amherst total scraped: ${jobs.length}`);
  } catch (e) {
    console.error(`❌ UMass Amherst scrape failed:`, e?.message || e);
  } finally {
    await page.close().catch(() => {});
  }

  return jobs;
}

async function scrapeJibeApiAs(startUrl, campusName, sourceName) {
  try {
    const origin = new URL(startUrl).origin;
    const jobs = [];
    const seen = new Set();
    const limit = 50;
    const searches = ["", "professor", "faculty", "lecturer", "instructor", "postdoc", "fellow"];

    for (const term of searches) {
      let page = 1;
      let totalCount = Infinity;
      while (page <= 25) {
        const apiUrl = `${origin}/api/jobs?search=${encodeURIComponent(term)}&page=${page}&limit=${limit}`;
        const resp = await fetch(apiUrl, {
          headers: { "User-Agent": "Mozilla/5.0 FacultyJobs/1.0" },
          signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) break;
        const data = await resp.json().catch(() => null);
        if (!data || !Array.isArray(data.jobs) || data.jobs.length === 0) break;

        totalCount = Number(data.totalCount || data.count || totalCount);
        for (const row of data.jobs) {
          const d = row?.data || {};
          const title = clean(d.title || "");
          const slug = clean(d.slug || "");
          if (!title || !slug) continue;
          const url = `${origin}/jobs/${slug}`;
          if (seen.has(url)) continue;
          seen.add(url);
          jobs.push({
            title,
            url,
            source: sourceName,
            category: "Faculty",
            college: campusName,
            location: [d.city, d.state].filter(Boolean).join(", ") || null,
            description: d.description ? String(d.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000) : null,
          });
        }

        if (page * limit >= totalCount) break;
        page += 1;
      }
    }

    const filtered = jobs
      .filter((j) => looksFacultyish(j.title) || /\bpost[\s-]?doc(?:toral)?\b|\bfellow\b/i.test(j.title || ""))
      .filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length} (Jibe API)`);
    return filtered;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} Jibe API scrape failed:`, e?.message || e);
    return [];
  }
}

async function scrapeJobviteAs(startUrl, campusName, sourceName) {
  try {
    const resp = await fetch(startUrl, {
      headers: { "User-Agent": "Mozilla/5.0 FacultyJobs/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    const origin = new URL(startUrl).origin;
    const companyMatch = startUrl.match(/jobvite\.com\/([^/]+)\/jobs/i);
    const company = companyMatch ? companyMatch[1] : null;
    const out = [];
    const seen = new Set();
    const re = /<a[^>]+href="([^"]*\/job\/[A-Za-z0-9]+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

    let m;
    while ((m = re.exec(html)) !== null) {
      const href = m[1];
      const raw = m[2] || "";
      const title = clean(raw.replace(/<[^>]+>/g, " "));
      if (!title || title.length < 5) continue;

      let url = href;
      if (!/^https?:\/\//i.test(url)) {
        if (url.startsWith("/")) url = origin + url;
        else if (company) url = `${origin}/${company}/${url}`;
        else url = new URL(url, startUrl).toString();
      }
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({
        title,
        url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      });
    }

    const filtered = out.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length} (Jobvite)`);
    return filtered;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} Jobvite scrape failed:`, e?.message || e);
    return [];
  }
}

async function scrapeSmithInterfolioPage(startUrl, campusName, sourceName) {
  try {
    const resp = await fetch(startUrl, {
      headers: { "User-Agent": "Mozilla/5.0 FacultyJobs/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    const out = [];
    const seen = new Set();
    const re = /<a[^>]+href="([^"]*apply\.interfolio\.com\/\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

    let m;
    while ((m = re.exec(html)) !== null) {
      const rawUrl = m[1] || "";
      const title = clean((m[2] || "").replace(/<[^>]+>/g, " "));
      if (!rawUrl || !title || title.length < 6) continue;

      let url = rawUrl;
      if (!/^https?:\/\//i.test(url)) {
        try {
          url = new URL(url, startUrl).toString();
        } catch {
          continue;
        }
      }

      if (seen.has(url)) continue;
      seen.add(url);

      const inferred = inferAcademicFieldsFromTitle(title);
      out.push({
        title,
        url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
        department: inferred.department,
        specialization: inferred.specialization,
      });
    }

    const filtered = out
      .filter((j) => looksFacultyish(j.title) || /\bpost[\s-]?doc(?:toral)?\b/i.test(j.title || ""))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length} (Smith Interfolio page)`);
    return filtered;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} Smith Interfolio scrape failed:`, e?.message || e);
    return [];
  }
}

async function scrapeInterfolioLinksFromPageAs(startUrl, campusName, sourceName) {
  try {
    const resp = await fetch(startUrl, {
      headers: { "User-Agent": "Mozilla/5.0 FacultyJobs/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    const out = [];
    const seen = new Set();
    const re = /<a[^>]+href="([^"]*apply\.interfolio\.com\/\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

    let m;
    while ((m = re.exec(html)) !== null) {
      const rawUrl = m[1] || "";
      const title = clean((m[2] || "").replace(/<[^>]+>/g, " "));
      if (!rawUrl || !title || title.length < 6) continue;

      let url = rawUrl;
      if (!/^https?:\/\//i.test(url)) {
        try {
          url = new URL(url, startUrl).toString();
        } catch {
          continue;
        }
      }

      if (seen.has(url)) continue;
      seen.add(url);

      const inferred = inferAcademicFieldsFromTitle(title);
      out.push({
        title,
        url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
        department: inferred.department,
        specialization: inferred.specialization,
      });
    }

    const filtered = out
      .filter((j) => looksFacultyish(j.title) || /\bpost[\s-]?doc(?:toral)?\b/i.test(j.title || ""))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length} (Interfolio links page)`);
    return filtered;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} Interfolio-links scrape failed:`, e?.message || e);
    return [];
  }
}

async function scrapeMaPrivate(context) {
  const results = await mapWithConcurrency(
    MA_PRIVATE_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "MA");
        if (type === "icims") return await scrapeIcimsAs(context, url, campus, "MA");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "MA");
        if (type === "peopleadmin-dept") return await scrapePeopleAdminWithDept(context, url, campus, "MA");
        if (type === "jibe-api") return await scrapeJibeApiAs(url, campus, "MA");
        if (type === "jobvite") return await scrapeJobviteAs(url, campus, "MA");
        if (type === "smith-interfolio") return await scrapeSmithInterfolioPage(url, campus, "MA");
        if (type === "academicjobsonline") return await scrapeAcademicJobsOnlineAs(context, url, campus, "MA");
        if (type === "peopleclick") return await scrapePeopleClickAs(context, url, campus, "MA");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "MA");
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "MA");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "MA");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} MA private scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

async function scrapeUscJobsAs(startUrl, campusName, sourceName) {
  try {
    const jobs = [];
    const seen = new Set();

    for (let page = 1; page <= 15; page++) {
      const urlObj = new URL(startUrl);
      urlObj.searchParams.set("category", "Faculty");
      urlObj.searchParams.set("p", String(page));
      const pageUrl = urlObj.toString();

      const resp = await fetch(pageUrl, {
        headers: { "User-Agent": "Mozilla/5.0 FacultyJobs/1.0" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) break;
      const html = await resp.text();

      const re = /<a[^>]+href="([^"]*\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let added = 0;
      let m;
      while ((m = re.exec(html)) !== null) {
        const rawHref = m[1] || "";
        const title = clean((m[2] || "").replace(/<[^>]+>/g, " "));
        if (!rawHref || !title || title.length < 6) continue;

        let jobUrl = rawHref;
        if (!/^https?:\/\//i.test(jobUrl)) {
          try {
            jobUrl = new URL(jobUrl, startUrl).toString();
          } catch {
            continue;
          }
        }

        if (seen.has(jobUrl)) continue;
        seen.add(jobUrl);
        jobs.push({
          title,
          url: jobUrl,
          source: sourceName,
          category: "Faculty",
          college: campusName,
          location: null,
          description: null,
        });
        added++;
      }

      if (added === 0) break;
    }

    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length} (USC listing)`);
    return filtered;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} USC scrape failed:`, e?.message || e);
    return [];
  }
}

async function scrapeWorkdaySearchApiAs(startUrl, campusName, sourceName, searchTerms = ["professor", "faculty", "lecturer", "instructor", "postdoc", "fellow"]) {
  try {
    let apiUrl = null;
    const jobsMatch = startUrl.match(/https:\/\/([^.]+)\.wd\d+\.myworkdayjobs\.com(?:\/en-US)?\/([^?/]+)/);
    if (jobsMatch) {
      const host = jobsMatch[0].split("/")[2];
      const company = jobsMatch[1];
      const site = jobsMatch[2];
      apiUrl = `https://${host}/wday/cxs/${company}/${site}/jobs`;
    } else {
      const u = new URL(startUrl);
      if (/^wd\d+\.myworkdaysite\.com$/i.test(u.host)) {
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts[0] === "recruiting" && parts[1] && parts[2]) {
          apiUrl = `https://${u.host}/wday/cxs/${parts[1]}/${parts[2]}/jobs`;
        }
      }
    }

    if (!apiUrl) return [];

    const out = [];
    const seen = new Set();
    const limit = 20;

    for (const term of searchTerms) {
      let offset = 0;
      let total = Infinity;
      for (let page = 0; page < 25; page++) {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appliedFacets: {},
            limit,
            offset,
            searchText: term,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) break;

        const data = await response.json();
        total = Number(data?.total || 0);
        const rows = Array.isArray(data?.jobPostings) ? data.jobPostings : [];
        if (rows.length === 0) break;

        const baseUrl = startUrl.split("?")[0].replace(/\/en-US/, "");
        for (const row of rows) {
          const url = baseUrl + (row.externalPath || "");
          if (!url || seen.has(url)) continue;
          seen.add(url);
          out.push({
            title: clean(row.title || ""),
            url,
            source: sourceName,
            category: "Faculty",
            college: campusName,
            location: row.locationsText || null,
            description: null,
          });
        }

        offset += limit;
        if (offset >= total) break;
      }
    }

    const filtered = out
      .filter((j) => looksFacultyish(j.title) || /\bpost[\s-]?doc(?:toral)?\b|\bfellow\b/i.test(j.title || ""))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length} (Workday search API)`);
    return filtered;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} Workday search API failed:`, e?.message || e);
    return [];
  }
}

async function scrapeLafayetteFacultyPageAs(startUrl, campusName, sourceName) {
  try {
    const resp = await fetch(startUrl, {
      headers: { "User-Agent": "Mozilla/5.0 FacultyJobs/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    const out = [];
    const seen = new Set();
    const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    let m;
    while ((m = re.exec(html)) !== null) {
      const href = m[1] || "";
      let title = clean((m[2] || "").replace(/<[^>]+>/g, " "));
      if (!href || !title || title.length < 8) continue;

      const lower = title.toLowerCase();
      // Keep only concrete faculty openings on this page.
      const looksOpening =
        /assistant professor|associate professor|visiting assistant professor|visiting professor|openings?|positions? available/i.test(title);
      if (!looksOpening) continue;
      if (/faculty handbook|our faculty|students,\s*faculty|search lafayette/i.test(lower)) continue;

      let url = href;
      if (!/^https?:\/\//i.test(url)) {
        try {
          url = new URL(url, startUrl).toString();
        } catch {
          continue;
        }
      }
      if (seen.has(url)) continue;
      seen.add(url);

      // Skip the page self-link banner title.
      if (url.replace(/\/+$/, "") === startUrl.replace(/\/+$/, "") && /positions? available/i.test(title)) continue;

      out.push({
        title,
        url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      });
    }

    const filtered = out.filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length} (Lafayette faculty page)`);
    return filtered;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} Lafayette scrape failed:`, e?.message || e);
    return [];
  }
}

async function scrapeCaPrivate(context) {
  const results = await mapWithConcurrency(
    CA_PRIVATE_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url, locationFilter }) => {
      try {
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "CA Private");
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "CA Private");
        if (type === "usc-jobs") return await scrapeUscJobsAs(url, campus, "CA Private");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "CA Private");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "CA Private");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "CA Private", locationFilter || null);
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "CA Private");
        if (type === "csod") return await scrapeCsodAs(context, url, campus, "CA Private");
        // No existing CA Private dispatch case for "adp" or "oracle-cx" (both
        // functions already existed, used elsewhere) -- added while wiring
        // Fielding Graduate University (adp) and Loma Linda University
        // (oracle-cx) during the generic-scraper long tail investigation.
        if (type === "adp") return await scrapeAdpAs(context, url, campus, "CA Private", locationFilter || null);
        if (type === "oracle-cx") return await scrapeOracleCxAs(context, url, campus, "CA Private");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "CA Private");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} CA private scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

/* ===== Generic "en-us/filter" site scraper (CSU/UMass style) ===== */

async function scrapeEnUsFilterSite(page, { source, campus, category }) {
  const jobs = [];
  const seen = new Set();

  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(900);

  async function collectBatch() {
    return safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return null;
        }
      };

      const out = [];
      const anchors = Array.from(
        document.querySelectorAll('a[href*="/job/"], a[href*="/jobs/"], a[href*="job="]')
      );

      for (const a of anchors) {
        const href = a.getAttribute("href");
        const url = abs(href);
        if (!url) continue;

        const u = new URL(url);
        const p = u.pathname || "";
        const isJob =
          /\/job\//i.test(p) || /\/jobs\//i.test(p) || /\/job\/[A-Za-z0-9_-]+/i.test(p) || /job=\d+/i.test(u.search);

        if (!isJob) continue;

        let title = clean(a.textContent);

        if (!title || title.length < 4 || /view job|apply/i.test(title)) {
          const container = a.closest("li, article, div, tr") || a.parentElement;
          const h = container?.querySelector?.("h1,h2,h3,h4,.job-title,.title,strong");
          const ht = clean(h?.textContent);
          if (ht && ht.length > 4) title = ht;
        }

        if (!title || title.length < 4) continue;
        out.push({ title, url });
      }

      const uniq = [];
      const s = new Set();
      for (const j of out) {
        if (!j.url || s.has(j.url)) continue;
        s.add(j.url);
        uniq.push(j);
      }
      return uniq;
    });
  }

  async function findNextUrl() {
    const more = page.locator('a.more-link.button[title="More Jobs"], a[title*="More Jobs" i]').first();
    if ((await more.count().catch(() => 0)) > 0 && (await more.isVisible().catch(() => false))) {
      const href = await more.getAttribute("href").catch(() => null);
      if (href) return new URL(href, page.url()).toString();
    }

    const relNext = page.locator('a[rel="next"]').first();
    if ((await relNext.count().catch(() => 0)) > 0 && (await relNext.isVisible().catch(() => false))) {
      const href = await relNext.getAttribute("href").catch(() => null);
      if (href) return new URL(href, page.url()).toString();
    }

    const guess = await safeEvaluate(page, () => {
      const a =
        document.querySelector('a[aria-label*="Next" i]') ||
        Array.from(document.querySelectorAll("a")).find((x) => (/^\s*next\s*$/i).test((x.textContent || "").trim()));
      return a ? a.getAttribute("href") : null;
    }).catch(() => null);

    if (guess) return new URL(guess, page.url()).toString();
    return null;
  }

  let currentUrl = page.url();
  for (let safety = 0; safety < 200; safety++) {
    const batch = await collectBatch();
    for (const it of batch) {
      if (!it?.url || seen.has(it.url)) continue;
      seen.add(it.url);
      jobs.push(it);
    }

    const nextUrl = await findNextUrl();
    if (!nextUrl || nextUrl === currentUrl) break;
    currentUrl = nextUrl;

    await gotoWithRetry(page, currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);
  }

  return jobs
    .map((j) => ({
      title: clean(j.title),
      url: j.url,
      source,
      category,
      college: campus,
      location: null,
      description: null,
    }))
    .filter((j) => !omitAdjunct(j.title));
}

/* ============================== UC (AP Recruit) ============================== */

async function scrapeUcAll(context) {
  const out = [];

  await Promise.all(
    UC_CAMPUSES.map(async ({ campus, url }) => {
      try {
        const page = await context.newPage();
        await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(900);

        const jobs = await scrapeApRecruitCampus(page, campus);
        console.log(`${campus} UC listings scraped: ${jobs.length}`);
        out.push(...jobs);

        await page.close().catch(() => {});
      } catch (e) {
        console.error(`❌ ${campus} UC scrape failed:`, e?.message || e);
      }
    })
  );

  return uniqByUrl(out).filter((j) => !omitUcFellowships(j.title));
}

async function scrapeApRecruitCampus(page, campusName) {
  const jobs = [];
  const seen = new Set();

  for (let safety = 0; safety < 120; safety++) {
    const batch = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return null;
        }
      };

      const out = [];
      const anchors = Array.from(document.querySelectorAll('a[href*="/apply/"], a[href*="JPF"], a[href*="/JPF"]'));

      for (const a of anchors) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;
        if (!/JPF\d+/i.test(url)) continue;

        const container = a.closest("tr, li, article, div") || a.parentElement;

        let title = clean(a.textContent);
        const ariaTitleRaw = clean(a.getAttribute("aria-label"));
        const ariaTitle = ariaTitleRaw.replace(/^more information about\s*JPF\d+\s*:\s*/i, "").trim();
        const ds = clean(container?.getAttribute?.("data-search"));
        const dsTitle = ds ? clean(ds.split("|")[0]) : "";

        const h =
          container?.querySelector?.(
            "h1,h2,h3,h4,.title,.job-title,strong,td.name,.name,[class*='job-title' i]"
          ) || null;
        const ht = clean(h?.textContent);

        const isBadTitle = (t) =>
          !t ||
          t.length < 4 ||
          /^JPF\d+$/i.test(t) ||
          /^apply by\b/i.test(t) ||
          /open\s+\w{3}\s+\d{1,2},\s+\d{4}/i.test(t);

        if (isBadTitle(title) && ht && !isBadTitle(ht)) title = ht;
        if (isBadTitle(title) && ariaTitle && !isBadTitle(ariaTitle)) title = ariaTitle;
        if (isBadTitle(title) && dsTitle && !isBadTitle(dsTitle)) title = dsTitle;

        if (isBadTitle(title) && container) {
          const candEls = Array.from(container.querySelectorAll("h1,h2,h3,h4,strong,a"));
          for (const el of candEls) {
            const t = clean(el.textContent);
            if (!isBadTitle(t) && t.length <= 220) {
              title = t;
              break;
            }
          }
        }

        if (isBadTitle(title)) continue;
        out.push({ title, url });
      }

      const uniq = [];
      const s = new Set();
      for (const x of out) {
        if (!x.url || s.has(x.url)) continue;
        s.add(x.url);
        uniq.push(x);
      }
      return uniq;
    });

    for (const it of batch) {
      if (!it?.url || seen.has(it.url)) continue;
      seen.add(it.url);
      jobs.push(it);
    }

    const next = page.locator('a[rel="next"], a:has-text("Next"), button:has-text("Next")').first();
    if ((await next.count().catch(() => 0)) > 0 && (await next.isVisible().catch(() => false))) {
      const tag = await next.evaluate((el) => el.tagName).catch(() => "BUTTON");
      if (tag === "A") {
        const href = await next.getAttribute("href").catch(() => null);
        if (href) {
          const nextUrl = new URL(href, page.url()).toString();
          if (nextUrl !== page.url()) {
            await gotoWithRetry(page, nextUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await page.waitForTimeout(800);
            continue;
          }
        }
      } else {
        const before = jobs.length;
        await next.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1200);
        if (jobs.length === before) break;
        continue;
      }
    }
    break;
  }

  return jobs.map((j) => ({
    title: clean(j.title),
    url: j.url,
    source: "UC",
    category: "Faculty",
    college: campusName,
    location: null,
    description: null,
  }));
}

/* ============================== NJ ============================== */

async function scrapeNjPublic(context) {
  const tasks = NJ_CAMPUSES.map(({ campus, type, url }) =>
    (async () => {
      try {
        if (type === "taleo") return await scrapeNjTaleo(context, url, campus, "NJ");
        if (type === "workday") return await scrapeNjWorkday(context, url, campus);
        if (type === "rutgers") return await scrapeNjRutgers(context, url, campus);
        if (type === "csod") return await scrapeNjCsod(context, url, campus);
        if (type === "schooljobs") return await scrapeNjSchoolJobs(context, url, campus);
        if (type === "stockton") return await scrapeNjStockton(context, url, campus);
        return [];
      } catch (e) {
        console.error(`❌ ${campus} NJ scrape failed:`, e?.message || e);
        return [];
      }
    })()
  );

  const settled = await Promise.allSettled(tasks);
  const jobs = settled.flatMap((r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));
  return uniqByUrl(jobs);
}

async function scrapePrincetonFaculty(context, campusName, sourceName) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();
    const baseUrl = "https://puwebp.princeton.edu/AcadHire/apply/";

    // Load the page once — Princeton AHIRE is a JSF app, session-based pagination
    await gotoWithRetry(page, baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);

    // Select "Faculty" category filter if available to reduce noise
    await page.evaluate(() => {
      const selects = document.querySelectorAll("select");
      for (const sel of selects) {
        const opts = [...sel.options];
        const facultyOpt = opts.find((o) => /faculty/i.test(o.text));
        if (facultyOpt) {
          sel.value = facultyOpt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });
    await page.waitForTimeout(1500);

    for (let pageNo = 1; pageNo <= 15; pageNo++) {
      const batch = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try { return new URL(href, location.href).toString(); } catch { return null; }
        };

        const out = [];

        // Princeton AHIRE lists jobs with links containing "listingId", but the
        // anchor's own text is always just the generic "Apply" button label —
        // the real title lives in a sibling "span.jobTitle" within the same
        // row/container, which the old anchor-text-only check couldn't see
        // (every row matched, ".textContent === 'Apply'" got filtered, and
        // *every* row came up empty, silently falling through two levels of
        // fallback to a much looser generic-link scan that grabbed unrelated
        // nav chrome instead).
        const links = document.querySelectorAll('a[href*="listingId"]');
        for (const a of links) {
          const href = abs(a.getAttribute("href"));
          const container = a.closest("tr, div, li, article") || a.parentElement;
          const titleEl = container?.querySelector(".jobTitle");
          const title = clean(titleEl?.textContent) || clean(a.textContent);
          if (!href || !title || title.length < 6) continue;
          if (/^(apply|more|details|view)$/i.test(title)) continue;
          out.push({ title, url: href });
        }

        // Fallback: look for job-like links with application.xhtml
        if (out.length === 0) {
          const allLinks = document.querySelectorAll('a[href*="application.xhtml"]');
          for (const a of allLinks) {
            const href = abs(a.getAttribute("href"));
            const row = a.closest("tr, div, li, article");
            const titleEl = row?.querySelector("h2, h3, h4, strong, b, .title, td:first-child");
            const title = clean(titleEl?.textContent || a.textContent);
            if (!href || !title || title.length < 6) continue;
            out.push({ title, url: href });
          }
        }

        // Broader fallback: any link that looks like a job posting
        if (out.length === 0) {
          const allA = document.querySelectorAll("a[href]");
          for (const a of allA) {
            const href = abs(a.getAttribute("href"));
            if (!href) continue;
            const title = clean(a.textContent);
            if (!title || title.length < 10) continue;
            if (/professor|lecturer|instructor|faculty|postdoc|researcher/i.test(title)) {
              if (/^(search|home|back|login|logout|help|privacy)$/i.test(title)) continue;
              out.push({ title, url: href });
            }
          }
        }

        const s = new Set();
        return out.filter((x) => (x.url && !s.has(x.url) ? (s.add(x.url), true) : false));
      });

      let newCount = 0;
      for (const j of batch) {
        if (!seen.has(j.url)) {
          seen.add(j.url);
          if (looksFacultyish(j.title) && !omitAdjunct(j.title)) {
            jobs.push({
              title: clean(j.title),
              url: j.url,
              source: sourceName,
              category: "Faculty",
              college: campusName,
              location: null,
              description: null,
            });
          }
          newCount++;
        }
      }

      if (newCount === 0 && pageNo > 1) break;

      // Click "Next" (labeled "N") to go to the next page within the JSF session
      const hasNext = await page.evaluate(() => {
        const links = [...document.querySelectorAll("a, span, button")];
        const next = links.find((el) => el.textContent.trim() === "N");
        if (next) {
          next.click();
          return true;
        }
        return false;
      });

      if (!hasNext) break;
      await page.waitForTimeout(2000);
    }

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeNjPrivate(context) {
  const results = await mapWithConcurrency(
    NJ_PRIVATE_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "princeton") return await scrapePrincetonFaculty(context, campus, "NJ");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "NJ");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "NJ");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "NJ");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "NJ");
        if (type === "paycom") return await scrapePaycomAs(context, url, campus, "NJ");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "NJ");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} NJ private scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

async function scrapeNjAll(context) {
  const [publicJobs, privateJobs] = await Promise.all([
    scrapeNjPublic(context),
    scrapeNjPrivate(context),
  ]);
  return uniqByUrl([...publicJobs, ...privateJobs]);
}

function toNjJob(title, url, campusName, category = "Faculty") {
  const normalizedTitle = normalizeJobTitle(title);
  const inferred = inferAcademicFieldsFromTitle(normalizedTitle);
  return {
    title: normalizedTitle,
    url,
    source: "NJ",
    category,
    college: campusName,
    location: null,
    description: null,
    department: cleanDepartmentField(inferred.department),
    specialization: cleanDepartmentField(inferred.specialization),
  };
}

async function scrapeNjTaleo(context, startUrl, campusName, sourceLabel = "NJ") {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Taleo's job list renders via AJAX well after domcontentloaded (observed
    // ~1.5-2.5s, more under load) — a fixed 900ms sleep reliably read the page
    // before any rows existed. Poll instead of guessing a fixed delay.
    const hasJobLinks = () =>
      safeEvaluate(page, () => {
        for (const a of document.querySelectorAll("a[href]")) {
          if (/jobdetail\.ftl\?.*job=/i.test(a.getAttribute("href") || "")) return true;
        }
        return false;
      }).catch(() => false);
    const pollStart = Date.now();
    while (Date.now() - pollStart < 10_000) {
      if (await hasJobLinks()) break;
      await page.waitForTimeout(400);
    }

        const jobs = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return null;
        }
      };

      const pickTitleFromContainer = (a) => {
        const c = a.closest("li, article, div, tr") || a.parentElement;
        if (!c) return null;

        const candidates = [
          c.querySelector("[data-testid*='jobTitle' i]"),
          c.querySelector("[data-automation-id*='jobTitle' i]"),
          c.querySelector("h1,h2,h3"),
          c.querySelector("[role='heading']"),
          c.querySelector(".job-title, .jobTitle, .title"),
        ];

        for (const el of candidates) {
          const t = clean(el?.textContent);
          if (t && t.length >= 6 && t.length <= 220) return t;
        }

        const aria = clean(a.getAttribute("aria-label"));
        if (aria && aria.length >= 6 && aria.length <= 220) return aria;

        return null;
      };

      const isBadTitle = (t) => {
        const s = (t || "").toLowerCase();
        return (
          !t ||
          t.length < 4 ||
          s === "view job" ||
          s === "apply" ||
          s === "learn more" ||
          s === "details" ||
          s.includes("search") ||
          s.includes("back to") ||
          s.includes("home")
        );
      };

      const out = [];
      const seen = new Set();

      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;

        const ok =
          /\/job\//i.test(url) ||
          /ats\/job/i.test(url) ||
          /\/requisition\//i.test(url) ||
          /requisitionId=/i.test(url) ||
          // Classic CU-format Taleo job-detail links (e.g. tcnj.taleo.net):
          // careersection/<section>/jobdetail.ftl?job=<id> — no "/job/" segment,
          // so the patterns above miss it entirely.
          /jobdetail\.ftl\?.*\bjob=/i.test(url) ||
          (/careersite/i.test(url) && (/requisition/i.test(url) || /job/i.test(url)));

        if (!ok) continue;

        let title = clean(a.textContent);
        if (isBadTitle(title)) {
          const t2 = pickTitleFromContainer(a);
          if (t2) title = t2;
        }

        if (isBadTitle(title)) continue;

        if (seen.has(url)) continue;
        seen.add(url);

        out.push({ title, url });
      }

      return out;
    });
    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceLabel} listings scraped: ${filtered.length}`);
    return filtered.map((j) => toNjJob(clean(j.title), j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

// Fast API-based Workday scraper (replaces slow browser scraping)
async function scrapeWorkdayApi(context, startUrl, campusName, sourceLabel = "NJ") {
  try {
    let apiUrl = null;
    // Parse Workday URLs to extract company+site:
    // 1) https://company.wdN.myworkdayjobs.com/site or /en-US/site
    // 2) https://wdN.myworkdaysite.com/recruiting/company/site
    const jobsMatch = startUrl.match(/https:\/\/([^.]+)\.wd\d+\.myworkdayjobs\.com(?:\/en-US)?\/([^?/]+)/);
    if (jobsMatch) {
      const [, company, site] = jobsMatch;
      const host = jobsMatch[0].split("/")[2];
      apiUrl = `https://${host}/wday/cxs/${company}/${site}/jobs`;
    } else {
      try {
        const u = new URL(startUrl);
        if (/^wd\d+\.myworkdaysite\.com$/i.test(u.host)) {
          const parts = u.pathname.split("/").filter(Boolean);
          // Some myworkdaysite.com URLs carry a locale segment before "recruiting"
          // (e.g. Penn's "/en-US/recruiting/upenn/careers-at-penn") — search for it
          // instead of assuming it's parts[0], or the locale-prefixed form silently
          // fails to parse and falls through to the much less reliable browser scrape.
          const recruitingIdx = parts.indexOf("recruiting");
          if (recruitingIdx !== -1 && parts[recruitingIdx + 1] && parts[recruitingIdx + 2]) {
            apiUrl = `https://${u.host}/wday/cxs/${parts[recruitingIdx + 1]}/${parts[recruitingIdx + 2]}/jobs`;
          }
        }
      } catch {}
    }

    if (!apiUrl) {
      console.log(`${campusName} ${sourceLabel}: Could not parse Workday URL, falling back to browser`);
      return await scrapeNjWorkdayBrowser(context, startUrl, campusName, sourceLabel);
    }

    // Parse facets from URL query parameters (e.g. ?jobFamilyGroup=abc&timeType=xyz).
    // Workday's `q` (and `searchText`) is the keyword search, NOT a facet — routing
    // it into appliedFacets makes the API reject the request, so map it to searchText.
    const appliedFacets = {};
    let searchText = "";
    try {
      const qs = new URL(startUrl).searchParams;
      for (const [key, val] of qs.entries()) {
        if (key === "q" || key === "searchText") { searchText = val; continue; }
        if (!appliedFacets[key]) appliedFacets[key] = [];
        appliedFacets[key].push(val);
      }
    } catch {}

    const allJobs = [];
    let offset = 0;
    const limit = 20;
    // Some Workday tenants (observed: Minnesota State) only report a correct
    // `total` on the first page — every subsequent page reports total: 0 even
    // though jobPostings keeps coming back non-empty. Using data.total fresh
    // each iteration made the loop quit after page 2 (40 of 185 jobs). Capture
    // total once from the first response and page against that instead.
    let knownTotal = null;

    for (let page = 0; page < 50; page++) {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appliedFacets,
          limit,
          offset,
          searchText
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        if (page === 0) {
          console.log(`${campusName} ${sourceLabel}: API failed, falling back to browser`);
          return await scrapeNjWorkdayBrowser(context, startUrl, campusName, sourceLabel);
        }
        break;
      }

      const data = await response.json();
      if (!data.jobPostings || data.jobPostings.length === 0) break;
      if (knownTotal === null && typeof data.total === "number" && data.total > 0) {
        knownTotal = data.total;
      }

      for (const job of data.jobPostings) {
        const baseUrl = startUrl.split('?')[0].replace(/\/en-US/, '');
        allJobs.push({
          title: job.title,
          url: baseUrl + job.externalPath,
          source: sourceLabel,
          category: "Faculty",
          college: campusName,
          location: job.locationsText || null,
          description: null,
        });
      }

      offset += limit;
      if (knownTotal !== null && offset >= knownTotal) break;
    }

    const filtered = allJobs
      .filter((j) => looksFacultyish(j.title) || /\bpost[\s-]?doc(?:toral)?\b|\bfellow\b/i.test(j.title || ""))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceLabel} listings scraped: ${filtered.length} (API)`);
    return filtered;
  } catch (e) {
    console.log(`${campusName} ${sourceLabel}: API error, falling back to browser - ${e.message}`);
    return await scrapeNjWorkdayBrowser(context, startUrl, campusName, sourceLabel);
  }
}

// Main Workday scraper - try API first, fall back to browser
async function scrapeNjWorkday(context, startUrl, campusName, sourceLabel = "NJ") {
  return await scrapeWorkdayApi(context, startUrl, campusName, sourceLabel);
}

// Browser-based Workday scraper (fallback when API fails)
async function scrapeNjWorkdayBrowser(context, startUrl, campusName, sourceLabel = "NJ") {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForSelector(
      '[data-automation-id="jobTitle"], [data-automation-id*="jobTitle" i], a[href*="/job/"], a[href*="/jobs/"]',
      { timeout: 20_000 }
    ).catch(() => {});

    const jobs = [];
    const seen = new Set();
    const visitedPages = new Set();

    for (let safety = 0; safety < 120; safety++) {
      await page.waitForTimeout(450);

      const batch = await page.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const out = [];

        const titleNodes = Array.from(
          document.querySelectorAll(
            '[data-automation-id="jobTitle"], [data-automation-id*="jobTitle" i], [data-testid*="jobTitle" i], a[href*="/job/"], a[href*="/jobs/"]'
          )
        );

        for (const n of titleNodes) {
          let title = clean(n.textContent);
          if (!title || title.length < 3) continue;

          const a = n.closest("a[href]") || n.querySelector?.("a[href]") || (n.tagName === "A" ? n : null);
          const href = a?.getAttribute?.("href") || a?.href || "";
          const url = abs(href);
          if (!url) continue;
          if (!/\/job\/|\/jobs\//i.test(url)) continue;

          out.push({ title, url });
        }
        return out;
      });

      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        jobs.push(j);
      }

      const current = await getWorkdayCurrentPageLabel(page);
      if (current) visitedPages.add(current);

      const moved = await goToNextWorkdayPage(page, visitedPages);
      if (!moved) break;

      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForSelector(
        '[data-automation-id="jobTitle"], [data-automation-id*="jobTitle" i], a[href*="/job/"], a[href*="/jobs/"]',
        { timeout: 15_000 }
      ).catch(() => {});
    }

    const filtered = jobs
      .filter((j) => looksFacultyish(j.title) || /\bpost[\s-]?doc(?:toral)?\b|\bfellow\b/i.test(j.title || ""))
      .filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceLabel} listings scraped: ${filtered.length}`);
    return filtered.map((j) => toNjJob(clean(j.title), j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

// Rutgers: title includes department; omit adjunct
async function scrapeNjRutgers(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();
    let currentUrl = startUrl;

    for (let safety = 0; safety < 80; safety++) {
      await gotoWithRetry(page, currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(700);

      const batch = await page.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const deptFromContainer = (container) => {
          if (!container) return null;

          const sels = [
            '[data-label*="Department" i]',
            '[aria-label*="Department" i]',
            ".department",
            ".dept",
            ".org",
            ".organization",
          ];
          for (const sel of sels) {
            const el = container.querySelector(sel);
            const t = clean(el?.textContent);
            if (t && t.length > 2 && t.length < 140) return t;
          }

          const txt = clean(container.innerText || "");
          let m = txt.match(/Department\s*:\s*([^\n•|]{3,140})/i);
          if (m) return clean(m[1]);
          m = txt.match(/Organization\s*:\s*([^\n•|]{3,140})/i);
          if (m) return clean(m[1]);
          m = txt.match(/Unit\s*:\s*([^\n•|]{3,140})/i);
          if (m) return clean(m[1]);
          return null;
        };

        const out = [];
        for (const a of Array.from(document.querySelectorAll('a[href*="/postings/"]'))) {
          const url = abs(a.getAttribute("href"));
          if (!url) continue;
          if (!/\/postings\/\d+/i.test(url)) continue;

          let title = clean(a.textContent);
          if (!title || title.length < 4) continue;

          const container = a.closest("tr") || a.closest("li") || a.closest("div") || null;
          const dept = deptFromContainer(container);

          if (dept && !title.toLowerCase().includes(dept.toLowerCase())) {
            title = `${title} — ${dept}`;
          }

          out.push({ title, url });
        }
        return out;
      });

      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        jobs.push(j);
      }

      const next = page.locator('a[rel="next"], a:has-text("Next")').first();
      if ((await next.count().catch(() => 0)) === 0) break;
      if (!(await next.isVisible().catch(() => false))) break;

      const href = await next.getAttribute("href").catch(() => null);
      if (!href) break;

      const nextUrl = new URL(href, page.url()).toString();
      if (nextUrl === currentUrl) break;
      currentUrl = nextUrl;
    }

    console.log(`${campusName} NJ listings scraped: ${jobs.length}`);
    return jobs.map((j) => toNjJob(clean(j.title), j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeNjCsod(context, startUrl, campusName, sourceLabel = "NJ") {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);

    // Try clicking on Faculty filter/category if present (UNM style)
    const facultyFilter = page.locator('a:has-text("Faculty"), button:has-text("Faculty"), [role="button"]:has-text("Faculty"), label:has-text("Faculty")').first();
    if ((await facultyFilter.count().catch(() => 0)) > 0 && (await facultyFilter.isVisible().catch(() => false))) {
      await facultyFilter.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Scroll to trigger lazy loading (multiple scroll passes)
    for (let scrollPass = 0; scrollPass < 5; scrollPass++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    // CSOD often lazy-loads results behind a "Load more" button.
    // Click it a few times to surface more job cards/links.
    for (let i = 0; i < 40; i++) {
      const btn = page.locator('button:has-text("Load more"), button:has-text("Show more"), button[aria-label*="Load" i], button[aria-label*="More" i], a:has-text("Load more"), a:has-text("Show more")').first();
      if ((await btn.count().catch(() => 0)) === 0) break;
      if (!(await btn.isVisible().catch(() => false))) break;
      const before = await page.evaluate(() => document.querySelectorAll("a[href]").length).catch(() => 0);
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1200);
      // Scroll down after loading more
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(800);
      const after = await page.evaluate(() => document.querySelectorAll("a[href]").length).catch(() => 0);
      if (after <= before) break;
    }

    // Helper to extract jobs from current page
    const extractJobs = async () => {
      return await page.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const out = [];
        const seen = new Set();

        const extractDept = (container) => {
          const txt = clean(container?.innerText || "");
          const m =
            txt.match(/\b(?:Department|College|School|Division|Program|Unit)\s*:?\s*([^\n•|]{3,90})/i) ||
            txt.match(/\b(?:Academic\s+Unit)\s*:?\s*([^\n•|]{3,90})/i);
          return m ? clean(m[1]) : null;
        };

        for (const a of Array.from(document.querySelectorAll("a[href]"))) {
          const url = abs(a.getAttribute("href"));
          const title = clean(a.textContent);
          if (!url || !title || title.length < 4) continue;

          const ok =
            /\/job\//i.test(url) ||
            /ats\/job/i.test(url) ||
            (/career/i.test(url) && /job/i.test(url)) ||
            /\/requisition\/\d+/i.test(url) ||
            (/ux\/ats\/careersite/i.test(url) && /requisition/i.test(url));
          if (!ok) continue;

          if (seen.has(url)) continue;
          seen.add(url);
          const container = a.closest("li, article, tr, div") || a.parentElement;
          out.push({ title, url, dept: extractDept(container) });
        }
        return out;
      });
    };

    // Collect all jobs including pagination (UNM style page numbers)
    const allJobs = [];
    const seenUrls = new Set();

    // Get jobs from first page
    const firstPageJobs = await extractJobs();
    for (const j of firstPageJobs) {
      if (!seenUrls.has(j.url)) {
        seenUrls.add(j.url);
        allJobs.push(j);
      }
    }

    // Handle pagination - click through page numbers
    let currentPage = 1;
    for (let safety = 0; safety < 50; safety++) {
      currentPage++;
      // Look for next page number button
      const nextPageBtn = page.locator(`button.page-number:has-text("${currentPage}")`).first();
      if ((await nextPageBtn.count().catch(() => 0)) === 0) break;
      if (!(await nextPageBtn.isVisible().catch(() => false))) break;

      await nextPageBtn.scrollIntoViewIfNeeded().catch(() => {});
      await nextPageBtn.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Scroll to load any lazy content
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);

      const pageJobs = await extractJobs();
      let newCount = 0;
      for (const j of pageJobs) {
        if (!seenUrls.has(j.url)) {
          seenUrls.add(j.url);
          allJobs.push(j);
          newCount++;
        }
      }
      if (newCount === 0) break;
    }

const jobs = allJobs.length > 0 ? allJobs : await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return null;
        }
      };

      const out = [];
      const seen = new Set();

      const extractDept = (container) => {
        const txt = clean(container?.innerText || "");
        const m =
          txt.match(/\b(?:Department|College|School|Division|Program|Unit)\s*:?\s*([^\n•|]{3,90})/i) ||
          txt.match(/\b(?:Academic\s+Unit)\s*:?\s*([^\n•|]{3,90})/i);
        return m ? clean(m[1]) : null;
      };

      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        const title = clean(a.textContent);
        if (!url || !title || title.length < 4) continue;

        const ok =
        /\/job\//i.test(url) ||
        /ats\/job/i.test(url) ||
        (/career/i.test(url) && /job/i.test(url)) ||
        /\/requisition\/\d+/i.test(url) ||
        (/ux\/ats\/careersite/i.test(url) && /requisition/i.test(url));if (!ok) continue;

        if (seen.has(url)) continue;
        seen.add(url);
        const container = a.closest("li, article, tr, div") || a.parentElement;
        out.push({ title, url, dept: extractDept(container) });
      }
      return out;
    });

    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceLabel} listings scraped: ${filtered.length}`);
    return filtered.map((j) => {
      const title = clean(j.title);
      const dept = cleanDepartmentField(j.dept);
      const withDept = dept && !title.toLowerCase().includes(dept.toLowerCase()) ? `${title} — ${dept}` : title;
      return toNjJob(withDept, j.url, campusName);
    });
  } finally {
    await page.close().catch(() => {});
  }
}

// SchoolJobs pagination sometimes uses javascript:void(0) for Next.
// We click and wait for results signature to change.
async function scrapeNjSchoolJobs(context, startUrl, campusName, sourceLabel = "NJ", locationFilter = null) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();

    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);

    for (let safety = 0; safety < 120; safety++) {
      const batch = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const out = [];
        for (const a of Array.from(document.querySelectorAll('a[href*="/jobs/"]'))) {
          const url = abs(a.getAttribute("href"));
          const title = clean(a.textContent);
          if (!url || !title || title.length < 4) continue;
          if (!/\/jobs\/\d+/i.test(url)) continue;
          // NEOGOV/schooljobs list items render the campus location as the
          // first <li> inside the card's <ul class="list-meta"> (e.g.
          // "Coalinga College, CA") -- captured so a shared multi-campus
          // district board (one schooljobs tenant covering every campus,
          // no native URL-facet for location on this platform unlike
          // PeopleAdmin) can be scoped to a single campus by the caller
          // instead of misattributing the whole district's job count to one
          // campus record (established Bemidji State misattribution lesson).
          const card = a.closest("li.list-item, li");
          const metaLi = card ? card.querySelector("ul.list-meta li") : null;
          const location_ = metaLi ? clean(metaLi.textContent) : "";
          out.push({ title, url, location: location_ });
        }
        return out;
      });

      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        jobs.push(j);
      }

      const moved = await schoolJobsGoNext(page);
      if (!moved) break;

      await page.waitForTimeout(900);
    }

    // Scope down to one campus's postings when this schooljobs tenant is
    // shared district-wide. No-op (unfiltered, same as before) for every
    // existing caller that doesn't pass locationFilter.
    const scoped = locationFilter
      ? jobs.filter((j) => (j.location || "").toLowerCase().includes(locationFilter.toLowerCase()))
      : jobs;

    const filtered = scoped.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceLabel} listings scraped: ${filtered.length}`);
    return filtered.map((j) => toNjJob(clean(j.title), j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeNjStockton(context, startUrl, campusName, sourceLabel = "NJ") {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();
    let currentUrl = startUrl;

    for (let safety = 0; safety < 80; safety++) {
      await gotoWithRetry(page, currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(800);

      const batch = await page.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const out = [];
        for (const a of Array.from(document.querySelectorAll("a[href]"))) {
          const url = abs(a.getAttribute("href"));
          const title = clean(a.textContent);
          if (!url || !title || title.length < 4) continue;
          if (!/\/jobs\//i.test(url)) continue;
          out.push({ title, url });
        }
        return out;
      });

      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        jobs.push(j);
      }

      const next = page.locator('a[rel="next"], a:has-text("Next"), a[aria-label*="Next" i]').first();
      if ((await next.count().catch(() => 0)) === 0) break;
      if (!(await next.isVisible().catch(() => false))) break;

      const href = await next.getAttribute("href").catch(() => null);
      if (!href) break;

      const nextUrl = new URL(href, page.url()).toString();
      if (nextUrl === currentUrl) break;
      currentUrl = nextUrl;
    }

    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceLabel} listings scraped: ${filtered.length}`);
    return filtered.map((j) => toNjJob(clean(j.title), j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}



/* ============================== NC ============================== */


async function scrapeNcAll(context) {
  const results = await mapWithConcurrency(
    NC_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {

if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "NC");
if (type === "peopleadmin-dept") return await scrapePeopleAdminWithDept(context, url, campus, "NC");
if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "NC");
if (type === "workday-search") return await scrapeWorkdaySearchApiAs(url, campus, "NC");
if (type === "duke-search") return await scrapeKeywordSearchJobsAs(context, url, campus, "NC", { queryParam: "q", pathPattern: "/job/" });
if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "NC");
if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "NC");

        return [];
      } catch (e) {
        console.error(`❌ ${campus} Nc scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

async function scrapeVaAll(context) {
  const results = await mapWithConcurrency(
    VA_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "VA");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "VA");
        if (type === "workday-search") return await scrapeWorkdaySearchApiAs(url, campus, "VA");
        if (type === "vt-search") return await scrapeKeywordSearchJobsAs(context, url, campus, "VA", { queryParam: "query", pathPattern: "/jobs/" });
        if (type === "csod") return await scrapeCsodAs(context, url, campus, "VA");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "VA");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "VA");
        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await page.waitForTimeout(900);
            return await scrapeEnUsFilterSite(page, { source: "VA", campus, category: "Faculty" });
          } finally {
            await page.close().catch(() => {});
          }
        }
        return [];
      } catch (e) {
        console.error(`❌ ${campus} VA scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

async function scrapeScAll(context) {
  const results = await mapWithConcurrency(
    SC_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "SC");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "SC");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "SC");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "SC");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} SC scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}



async function scrapeDeAll(context) {
  const results = await mapWithConcurrency(
    DE_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {

if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "DE");
if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "DE");
if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "DE");
if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "DE");
if (type === "enusfilter") {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);
    return await scrapeEnUsFilterSite(page, { source: "DE", campus, category: "Faculty" });
  } finally {
    await page.close().catch(() => {});
  }
}

        return [];
      } catch (e) {
        console.error(`❌ ${campus} De scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

async function scrapeMdAll(context) {
  const results = await mapWithConcurrency(
    MD_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "MD");
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "MD");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "MD");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "MD");
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "MD");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "MD");
        // No existing MD dispatch case for "adp" (function scrapeAdpAs
        // already exists and is dispatched by several other states) --
        // added for Capitol Technology University.
        if (type === "adp") return await scrapeAdpAs(context, url, campus, "MD");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "MD");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} MD scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}


async function scrapeRiAll(context) {
  const results = await mapWithConcurrency(
    [...RI_CAMPUSES, ...RI_PRIVATE_CAMPUSES],
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "RI");
        if (type === "peopleadmin-dept") return await scrapePeopleAdminWithDept(context, url, campus, "RI");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "RI");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "RI");
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "RI");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "RI");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} RI scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}


async function scrapeNhAll(context) {
  const results = await mapWithConcurrency(
    NH_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        // Handle any explicit platform types if added later
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "NH");
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "NH");
        if (type === "workday") return await scrapeWorkdayApi(context, url, campus, "NH");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "NH");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "NH");

        // Fallback: try en-us/filter-style extractor
        const page = await context.newPage();
        try {
          await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
          await page.waitForTimeout(900);
          return await scrapeEnUsFilterSite(page, { source: "NH", campus, category: "Faculty" });
        } finally {
          await page.close().catch(() => {});
        }
      } catch (e) {
        console.error(`❌ ${campus} NH scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}




/* ============================== PA ============================== */


async function scrapePaAll(context) {
  const campuses = [...PA_CAMPUSES, ...PA_PRIVATE_CAMPUSES];
  const results = await mapWithConcurrency(
    campuses,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "PA");
        if (type === "csod") return await scrapeCsodAs(context, url, campus, "PA");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "PA");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "PA");
        if (type === "workday-search") return await scrapeWorkdaySearchApiAs(url, campus, "PA");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "PA");
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "PA");
        if (type === "interfolio-links") return await scrapeInterfolioLinksFromPageAs(url, campus, "PA");
        if (type === "lafayette-faculty") return await scrapeLafayetteFacultyPageAs(url, campus, "PA");
        if (type === "static") return await scrapeStaticLinksAs(context, url, campus, "PA");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "PA");
        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await page.waitForTimeout(900);
            return await scrapeEnUsFilterSite(page, { source: "PA", campus, category: "Faculty" });
          } finally {
            await page.close().catch(() => {});
          }
        }

        return [];
      } catch (e) {
        console.error(`❌ ${campus} Pa scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

/* ============================== MI ============================== */

async function scrapeMiAll(context) {
  const results = await mapWithConcurrency(
    MI_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "MI");
        if (type === "csod") return await scrapeCsodAs(context, url, campus, "MI");
        if (type === "static") return await scrapeStaticLinksAs(context, url, campus, "MI");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "MI");
        if (type === "kzoo-faculty") return await scrapeKzooFacultyJobs(context, url, campus, "MI");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "MI");
        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await page.waitForTimeout(900);
            return await scrapeEnUsFilterSite(page, { source: "MI", campus, category: "Faculty" });
          } finally {
            await page.close().catch(() => {});
          }
        }
        if (type === "nau-search") {
          // MSU's listing cards can surface short/variant titles (e.g., "Assistant Professor-FixedTerm").
          // Enrich from the job detail page to recover the canonical title and college/department.
          if (/michigan state university/i.test(campus) || /careers\.msu\.edu/i.test(url)) {
            const base = await scrapeNauSearch(context, url, campus, "MI");
            return await enrichEnUsJobCardsFromDetails(context, base, {
              titleDeptSeparator: " - ",
              preferDeptKeys: ["college", "department", "organization", "unit", "school"],
            });
          }
          return await scrapeNauSearch(context, url, campus, "MI");
        }
        if (type === "umich") return await scrapeUmichCareers(context, url, campus, "MI");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} MI scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

async function scrapeSchoolJobsAs(context, startUrl, campusName, sourceName, locationFilter = null) {
  const items = await scrapeNjSchoolJobs(context, startUrl, campusName, sourceName, locationFilter);
  return items.map((j) => ({ ...j, source: sourceName, college: campusName }));
}

// ExactHire ATS (a React/MUI SPA): job cards render the title in an <h6> next to a
// bare arrow-icon <a href="/job/ID"> with no link text of its own, so a plain
// anchor-text scrape finds nothing. Walk up from each jobDetailsLink anchor to its
// card and pull the <h6> sibling instead. Clicks "Load More" to reveal the full list.
async function scrapeExactHireAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);

    for (let i = 0; i < 20; i++) {
      const btn = page.locator('button:has-text("Load More"), button:has-text("LOAD MORE JOBS")').first();
      if ((await btn.count().catch(() => 0)) === 0) break;
      if (!(await btn.isVisible().catch(() => false))) break;
      await btn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const out = [];
      const seen = new Set();
      for (const a of document.querySelectorAll('a[data-testid^="jobDetailsLink"]')) {
        const href = a.getAttribute("href");
        if (!href) continue;
        let url;
        try { url = new URL(href, location.href).toString(); } catch { continue; }
        if (seen.has(url)) continue;
        const h = a.parentElement ? a.parentElement.querySelector("h6, h2, h3") : null;
        const title = clean(h ? h.textContent : "");
        if (!title) continue;
        seen.add(url);
        out.push({ title, url });
      }
      return out;
    }).catch(() => []);

    return items
      .map((x) => ({
        title: clean(x.title),
        url: x.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      }))
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title));
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} ExactHire scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeCsodAs(context, startUrl, campusName, sourceName) {
  const items = await scrapeNjCsod(context, startUrl, campusName, sourceName);
  return items.map((j) => ({ ...j, source: sourceName, college: campusName }));
}

async function scrapeWorkdayAs(context, startUrl, campusName, sourceName) {
  const items = await scrapeNjWorkday(context, startUrl, campusName, sourceName);
  return items.map((j) => ({ ...j, source: sourceName, college: campusName }));
}

function inferSdborCampusFromDetail(html, title = "") {
  const text = clean(`${stripHtmlToText(html || "")} ${title || ""}`).toLowerCase();

  if (
    /south dakota state university|\bsdsu\b|brookings/.test(text)
  ) return "South Dakota State University";

  if (
    /university of south dakota|\busd\b|vermillion|school of law|knudson/.test(text)
  ) return "University of South Dakota";

  if (
    /south dakota school of mines|south dakota mines|\bsdsmt\b|rapid city/.test(text)
  ) return "South Dakota School of Mines and Technology";

  if (
    /black hills state university|\bbhsu\b|spearfish/.test(text)
  ) return "Black Hills State University";

  if (
    /northern state university|\bnsu\b|aberdeen/.test(text)
  ) return "Northern State University";

  if (
    /dakota state university|\bdsu\b|madison,\s*south dakota|madison,\s*sd/.test(text)
  ) return "Dakota State University";

  return null;
}

async function scrapePeopleAdminAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();
    let currentUrl = startUrl;

    for (let safety = 0; safety < 120; safety++) {
      await gotoWithRetry(page, currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(700);

      const batch = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const out = [];
        for (const a of Array.from(document.querySelectorAll('a[href*="/postings/"]'))) {
          const url = abs(a.getAttribute("href"));
          if (!url) continue;
          if (!/\/postings\/\d+/i.test(url)) continue;

          const title = clean(a.textContent);
          if (!title || title.length < 4) continue;
          if (/search|home|back|return|login|logout|help|privacy|accessibility/i.test(title)) continue;

          out.push({ title, url });
        }

        const uniq = [];
        const s = new Set();
        for (const x of out) {
          if (!x.url || s.has(x.url)) continue;
          s.add(x.url);
          uniq.push(x);
        }
        return uniq;
      });

      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        jobs.push(j);
      }

      const next = page.locator('a[rel="next"], a:has-text("Next")').first();
      if ((await next.count().catch(() => 0)) === 0) break;
      if (!(await next.isVisible().catch(() => false))) break;

      const href = await next.getAttribute("href").catch(() => null);
      if (!href) break;

      const nextUrl = new URL(href, page.url()).toString();
      if (nextUrl === currentUrl) break;
      currentUrl = nextUrl;
    }

    let sdborByUrl = new Map();
    if (campusName === "South Dakota Board of Regents" && jobs.length > 0) {
      const inferred = await mapWithConcurrency(jobs, 4, async (j) => {
        try {
          const res = await context.request.get(j.url, { timeout: 45_000 });
          if (!res.ok()) return { url: j.url, college: null };
          const html = await res.text();
          return { url: j.url, college: inferSdborCampusFromDetail(html, j.title) };
        } catch {
          return { url: j.url, college: null };
        }
      });
      for (const row of inferred) {
        if (row?.url && row.college) sdborByUrl.set(row.url, row.college);
      }
    }

    const out = jobs
      .map((j) => {
        const title = normalizeJobTitle(j.title);
        const inferred = inferAcademicFieldsFromTitle(title);
        const inferredCollege = sdborByUrl.get(j.url) || null;
        return {
          title,
          url: j.url,
          source: sourceName,
          category: "Faculty",
          college: inferredCollege || campusName,
          location: null,
          description: null,
          department: inferred.department,
          specialization: inferred.specialization,
        };
      })
      .filter((j) => !omitAdjunct(j.title));

    // Some PeopleAdmin instances intermittently challenge headless browsers.
    // If browser extraction yields nothing, fall back to direct HTML parsing.
    if (out.length === 0) {
      const fallback = await scrapePeopleAdminHttpFallback(startUrl, campusName, sourceName);
      if (fallback.length > 0) {
        console.log(`${campusName} ${sourceName} listings scraped: ${fallback.length} (HTTP fallback)`);
        return fallback;
      }
    }

    console.log(`${campusName} ${sourceName} listings scraped: ${out.length}`);
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapePeopleAdminHttpFallback(startUrl, campusName, sourceName) {
  try {
    const response = await fetch(startUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return [];
    const html = await response.text();
    if (!html) return [];

    const seen = new Set();
    const out = [];
    const linkRe = /<a[^>]+href=["']([^"'#?]*\/postings\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRe.exec(html)) !== null) {
      const rawHref = match[1];
      const title = clean(String(match[2] || "").replace(/<[^>]+>/g, " "));
      const normalizedTitle = normalizeJobTitle(title);
      if (!normalizedTitle || normalizedTitle.length < 4) continue;
      if (/^view details$/i.test(normalizedTitle)) continue;
      if (!looksFacultyish(normalizedTitle)) continue;
      let url = null;
      try {
        url = new URL(rawHref, startUrl).toString();
      } catch {
        continue;
      }
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const inferred = inferAcademicFieldsFromTitle(normalizedTitle);
      out.push({
        title: normalizedTitle,
        url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
        department: inferred.department,
        specialization: inferred.specialization,
      });
    }
    return out.filter((j) => !omitAdjunct(j.title));
  } catch {
    return [];
  }
}


async function scrapePeopleSoftAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);

    // PeopleSoft pages vary; pull plausible job links.
    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };

      const out = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;

        const title = clean(a.textContent);
        if (!title || title.length < 6) continue;

        // Heuristics: PeopleSoft often uses these parameters/pages
        const okUrl =
          /HRS_CG_SEARCH_FL|HRS_APP_SCHJOB|JobOpening|jobopening|postings|recruit/i.test(url) ||
          /openings|job/i.test(url);

        if (!okUrl) continue;

        // Exclude obvious navigation
        if (/sign in|log in|home|help|privacy|accessibility/i.test(title)) continue;

        out.push({ title, url });
      }

      const seen = new Set();
      return out.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
    });

    return items.map((x) => ({
      title: normalizeUwTitle(x.title),
      url: x.url,
      source: sourceName,
      category: "Faculty",
      college: campusName,
      location: null,
      description: null,
    }));
  } finally {
    await page.close().catch(() => {});
  }
}

// PeopleSoft "Fluid" Candidate Gateway (Oracle's modern responsive recruiting
// UI, e.g. Northwestern). Unlike the classic layout scrapePeopleSoftAs targets,
// this one needs real interaction, not just a DOM scrape of the landing page:
//   1. The landing/search URL's first load is often gated behind a cookie
//      check; a second visit in the same session succeeds.
//   2. That page then shows a "recent searches" shortcut list, not real
//      postings — every item is internally labeled "Search Results" regardless
//      of what it actually searched for, so it's meaningless as scraped text.
//      The real results grid only appears after clicking through
//      "Explore Jobs"/"View All Jobs".
//   3. The grid itself only renders ~50 rows at a time and lazy-loads more as
//      its own internal scrollable container (not the window) is scrolled.
//   4. Rows have no real per-job href at all — clicking one fires a postback
//      that doesn't change the URL. Field ids are Oracle's standard Candidate
//      Gateway names (SCH_JOB_TITLE$N, HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$N,
//      etc.), stable enough across tenants to read directly; a working,
//      publicly-indexed direct-link format was confirmed by finding a real
//      Northwestern posting URL via web search and reverse-engineering it:
//      the same .GBL component the search page lives on, with
//      Page=HRS_APP_JBPST_FL and JobOpeningId swapped in.
async function scrapePeopleSoftFluidAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);

    // "Explore Jobs" (a header button) often exists alongside "View All Jobs"
    // (a nav item) but only expands the nav menu rather than submitting a
    // search — "View All Jobs" is the one that actually lands on the results
    // grid, so try it first and only fall back to the others if it's absent.
    // The click must be a real Playwright action (not a raw DOM el.click()
    // inside page.evaluate()) with waitForNavigation armed BEFORE it fires, or
    // the postback's navigation can complete before anything is listening.
    let target = page.getByText("View All Jobs", { exact: true }).first();
    if ((await target.count().catch(() => 0)) === 0) {
      target = page
        .locator("a, button")
        .filter({ hasText: /^(explore jobs|search jobs|browse jobs)$/i })
        .first();
    }
    if ((await target.count().catch(() => 0)) === 0) return [];

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {}),
      target.click({ timeout: 10_000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(2500);

    let lastCount = -1;
    for (let i = 0; i < 40; i++) {
      const count = await page
        .evaluate(() => {
          let grid = document.getElementById("SCH_JOB_TITLE$0");
          while (grid && !(/ps_box-grid/.test(grid.className || "") && /scrollable/.test(grid.className || ""))) {
            grid = grid.parentElement;
          }
          if (grid) grid.scrollTop = grid.scrollHeight;
          return document.querySelectorAll('[id^="SCH_JOB_TITLE$"]').length;
        })
        .catch(() => 0);
      if (count === lastCount) break;
      lastCount = count;
      await page.waitForTimeout(1200);
    }

    const rows = await page
      .evaluate(() => {
        const val = (id) => {
          const el = document.getElementById(id);
          return el ? el.textContent.trim() : null;
        };
        const out = [];
        const total = document.querySelectorAll('[id^="SCH_JOB_TITLE$"]').length;
        for (let i = 0; i < total; i++) {
          const title = val(`SCH_JOB_TITLE$${i}`);
          const jobId = val(`HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$${i}`);
          if (!title || !jobId) continue;
          out.push({
            title,
            jobId,
            location: val(`LOCATION$${i}`),
            department: val(`HRS_APP_JBSCH_I_HRS_DEPT_DESCR$${i}`),
          });
        }
        return out;
      })
      .catch(() => []);

    let base;
    try {
      const u = new URL(page.url());
      base = `${u.origin}${u.pathname}`;
    } catch {
      return [];
    }
    const siteIdMatch = /[?&]SiteId=([^&]+)/i.exec(startUrl);
    const siteId = siteIdMatch ? siteIdMatch[1] : "1";

    return rows
      .map((r) => ({
        title: normalizeJobTitle(r.title),
        url: `${base}?Page=HRS_APP_JBPST_FL&Action=U&FOCUS=Applicant&SiteId=${siteId}&JobOpeningId=${r.jobId}&PostingSeq=1`,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: r.location,
        description: null,
        department: r.department,
        specialization: r.department,
      }))
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title));
  } finally {
    await page.close().catch(() => {});
  }
}

// PeopleAdmin variant: append department/organization to title when available (used for NCCU)
async function scrapePeopleAdminWithDept(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();
    let currentUrl = startUrl;

    const deptFromContainer = (containerText) => {
      const t = clean(containerText || "");
      const m =
        t.match(/Department\s*:\s*([^\n•|]{3,140})/i) ||
        t.match(/Organization\s*:\s*([^\n•|]{3,140})/i) ||
        t.match(/Unit\s*:\s*([^\n•|]{3,140})/i);
      return m ? clean(m[1]) : null;
    };
    const extractDeptFromPeopleAdminDetailHtml = (html) => {
      const normalizeDeptLabel = (value) => {
        let v = stripHtmlToText(value || "");
        v = clean(v.replace(/\s+/g, " "));
        if (!v) return null;
        v = v.replace(/^\s*the\s+/i, "");
        v = v.replace(/\bplease\s+visit\b.*$/i, "");
        v = v.replace(/\s+at\s+PSU\b.*$/i, "");
        v = v.replace(/\s+at\s+Portland\s+State\b.*$/i, "");
        v = v.replace(/\s+at\s+North\s+Carolina\s+Central\b.*$/i, "");
        v = v.replace(/\s+at\s+UNC\b.*$/i, "");
        v = v.replace(/\s+is\s+to\b.*$/i, "");
        v = v.replace(/\s+is\s+an?\b.*$/i, "");
        v = v.replace(/\s*[.;,:]\s*$/g, "").trim();
        // Keep concise department/school labels.
        const m =
          v.match(/\b(School of [A-Za-z0-9&'()./ -]{2,90})\b/i) ||
          v.match(/\b(Department of [A-Za-z0-9&'()./ -]{2,90})\b/i) ||
          v.match(/\b(College of [A-Za-z0-9&'()./ -]{2,90})\b/i);
        if (m?.[1]) {
          let short = clean(m[1]).replace(/\s*(at|which|that|serves|has|offers|provides|is)\b.*$/i, "").trim();
          short = short.replace(/^department of\b/i, "Department of");
          short = short.replace(/^school of\b/i, "School of");
          short = short.replace(/^college of\b/i, "College of");
          return short;
        }
        // Keep short labeled values; drop sentence-like blocks.
        if (v.length > 100) return null;
        return v;
      };
      const rowVal = (label) => {
        const rx = new RegExp(`<th[^>]*>\\s*${label}\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i");
        const m = String(html || "").match(rx);
        if (!m || !m[1]) return null;
        return normalizeDeptLabel(m[1]);
      };

      const direct =
        rowVal("Department") ||
        rowVal("Academic Department") ||
        rowVal("Division") ||
        rowVal("Program") ||
        rowVal("College") ||
        rowVal("School") ||
        rowVal("Organizational Unit") ||
        rowVal("Unit");
      if (direct && direct.length >= 3 && direct.length <= 140) return direct;

      const brief = rowVal("Brief Description of PSU\\/School\\/Dept");
      if (!brief) return null;
      const school = brief.match(/\b(School of [A-Za-z0-9&,'()./ -]{3,90})\b/i);
      if (school?.[1]) return clean(school[1]);
      const dept = brief.match(/\b(Department of [A-Za-z0-9&,'()./ -]{3,90})\b/i);
      if (dept?.[1]) return clean(dept[1]);
      const college = brief.match(/\b(College of [A-Za-z0-9&,'()./ -]{3,90})\b/i);
      if (college?.[1]) return clean(college[1]);

      const plain = clean(stripHtmlToText(html || "").replace(/\s+/g, " "));
      const fromSentence =
        plain.match(/\bThe\s+Department\s+of\s+([A-Za-z0-9&,'()./ -]{3,90})\b/i) ||
        plain.match(/\bDepartment\s+of\s+([A-Za-z0-9&,'()./ -]{3,90})\b/i) ||
        plain.match(/\bSchool\s+of\s+([A-Za-z0-9&,'()./ -]{3,90})\b/i) ||
        plain.match(/\bCollege\s+of\s+([A-Za-z0-9&,'()./ -]{3,90})\b/i);
      if (fromSentence?.[1]) return normalizeDeptLabel(fromSentence[1]);
      return null;
    };

    for (let safety = 0; safety < 120; safety++) {
      await gotoWithRetry(page, currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(700);

      const batch = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const out = [];
        for (const a of Array.from(document.querySelectorAll('a[href*="/postings/"]'))) {
          const url = abs(a.getAttribute("href"));
          if (!url) continue;
          if (!/\/postings\/\d+/i.test(url)) continue;

          const title = clean(a.textContent);
          if (!title || title.length < 4) continue;
          if (/search|home|back|return|login|logout|help|privacy|accessibility/i.test(title)) continue;

          const container = a.closest("tr") || a.closest("li") || a.closest("div") || null;
          const containerText = container ? clean(container.innerText || "") : "";

          out.push({ title, url, containerText });
        }

        const uniq = [];
        const s = new Set();
        for (const x of out) {
          if (!x.url || s.has(x.url)) continue;
          s.add(x.url);
          uniq.push(x);
        }
        return uniq;
      });

      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        let dept = deptFromContainer(j.containerText || "");
        if (!dept) {
          try {
            const res = await context.request.get(j.url, { timeout: 45_000 });
            if (res.ok()) {
              const html = await res.text();
              dept = extractDeptFromPeopleAdminDetailHtml(html) || null;
            }
          } catch {}
        }
        if (!dept) {
          try {
            const res = await fetch(j.url, { signal: AbortSignal.timeout(30_000) });
            if (res.ok) {
              const html = await res.text();
              dept = extractDeptFromPeopleAdminDetailHtml(html) || null;
            }
          } catch {}
        }
        let title = clean(j.title);
        if (dept && !title.toLowerCase().includes(dept.toLowerCase())) {
          title = `${title} — ${dept}`;
        }

        jobs.push({ title, url: j.url, dept: dept || null });
      }

      const next = page.locator('a[rel="next"], a:has-text("Next"), a[aria-label*="Next" i]').first();
      if ((await next.count().catch(() => 0)) === 0) break;
      if (!(await next.isVisible().catch(() => false))) break;

      const href = await next.getAttribute("href").catch(() => null);
      if (!href) break;

      const nextUrl = new URL(href, page.url()).toString();
      if (nextUrl === currentUrl) break;
      currentUrl = nextUrl;
    }

    const out = jobs
      .map((j) => {
        const title = normalizeJobTitle(j.title);
        const inferred = inferAcademicFieldsFromTitle(title);
        return {
          title,
          url: j.url,
          source: sourceName,
          category: "Faculty",
          college: campusName,
          location: null,
          description: null,
          department: j.dept || inferred.department,
          specialization: j.dept || inferred.specialization,
        };
      })
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${out.length}`);
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}



/* ============================== IL ============================== */

async function scrapeIlAll(context) {
  const results = await mapWithConcurrency(
    IL_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url, locationFilter }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "IL");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "IL");
        if (type === "csod") return await scrapeCsodAs(context, url, campus, "IL");
        // No existing IL dispatch case for "adp" (function scrapeAdpAs already
        // exists and is dispatched by several other states) -- added for
        // Bradley University.
        if (type === "adp") return await scrapeAdpAs(context, url, campus, "IL");

        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await page.waitForTimeout(900);
            return await scrapeEnUsFilterSite(page, { source: "IL", campus, category: "Faculty" });
          } finally {
            await page.close().catch(() => {});
          }
        }

        if (type === "eiu-static") return await scrapeEiuJobs(context, url, campus);
        if (type === "static") return await scrapeStaticLinksAs(context, url, campus, "IL");
        if (type === "knox-faculty") return await scrapeKnoxFacultyJobs(context, url, campus, "IL");
        if (type === "interfolio") return await scrapeInterfolioPositionsAs(context, url, campus, "IL");
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "IL");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "IL");
        if (type === "peoplesoft-fluid") return await scrapePeopleSoftFluidAs(context, url, campus, "IL");
        // No existing IL dispatch case for "workday" (function scrapeWorkdayAs
        // already exists and is dispatched elsewhere, e.g. CA) -- added for
        // St. John's College-Department of Nursing (shared HSHS Workday tenant).
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "IL");
        // No existing IL dispatch case for "iecc-campus" (new dedicated
        // scraper this round) -- added for Lincoln Trail College and Wabash
        // Valley College, both sharing the same district-wide IECC listings
        // page.
        if (type === "iecc-campus") return await scrapeIeccCampusJobs(context, url, campus, "IL", locationFilter);

        return [];
      } catch (e) {
        console.error(`❌ ${campus} IL scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

// Eastern Illinois: only links under "Faculty & Academic Support Professionals" section (fallback to generic static)
async function scrapeEiuJobs(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };

      const h = Array.from(document.querySelectorAll("h1,h2,h3,h4"))
        .find((n) => /Faculty\s*&\s*Academic\s*Support\s*Professionals/i.test(clean(n.textContent)));
      const container = h ? (h.closest("section, article, div") || h.parentElement) : null;

      const root = container || document.body;
      const anchors = Array.from(root.querySelectorAll("a[href]"));

      const out = [];
      const seen = new Set();

      for (const a of anchors) {
        const url = abs(a.getAttribute("href"));
        const title = clean(a.textContent);
        if (!url || !title || title.length < 6) continue;

        const bad = /privacy|accessibility|contact|directory|apply now|student|staff/i.test(title);
        if (bad) continue;

        const ok =
          /job|posting|position|faculty|academic|career|requisition/i.test(url) ||
          /professor|lecturer|instructor|\bfaculty\b/i.test(title);
        if (!ok) continue;

        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title, url });
      }

      return out;
    }).catch(() => []);

    if (!items || items.length < 2) {
      return await scrapeStaticLinksAs(context, startUrl, campusName, "IL");
    }

    return items.map((x) => ({
      title: (x.title || "").replace(/\s+/g, " ").trim(),
      url: x.url,
      source: "IL",
      category: "Faculty",
      college: campusName,
      location: null,
      description: null,
    }));
  } finally {
    await page.close().catch(() => {});
  }
}

// Interfolio positions listing (e.g., SIUE)
async function scrapeInterfolioPositionsAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // This Interfolio "positions" list is a SPA that renders its rows via AJAX
    // well after domcontentloaded (observed ~2-3s) — a fixed 900ms sleep reliably
    // read the page before any job links existed. Poll instead of guessing.
    // Job rows use Angular's ng-href, which renders as a relative "/171421"
    // attribute — a CSS attribute selector like a[href*="interfolio.com/"] never
    // matches, and testing getAttribute("href") directly against a domain regex
    // never matches either. Resolve each href to absolute first, every time.
    const hasJobLinks = () =>
      safeEvaluate(page, () => {
        for (const a of document.querySelectorAll("a[href]")) {
          let url;
          try { url = new URL(a.getAttribute("href"), location.href).toString(); } catch { continue; }
          if (/interfolio\.com\/\d+(?:$|\?|#)/i.test(url)) return true;
        }
        return false;
      }).catch(() => false);
    const pollStart = Date.now();
    while (Date.now() - pollStart < 10_000) {
      if (await hasJobLinks()) break;
      await page.waitForTimeout(400);
    }

    const jobs = [];
    const seen = new Set();

    for (let safety = 0; safety < 40; safety++) {
      const batch = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try { return new URL(href, location.href).toString(); } catch { return null; }
        };

        const out = [];
        // Some Interfolio "positions" list pages link straight to a bare job ID
        // (apply.interfolio.com/<id>, often as a relative ng-href) rather than
        // nesting under /positions/ or /position/ — resolve every href to
        // absolute before filtering, since a raw CSS attribute selector can't
        // see through a relative "/171421"-style href.
        const links = Array.from(document.querySelectorAll("a[href]"));
        for (const a of links) {
          const url = abs(a.getAttribute("href"));
          if (!url) continue;
          if (!/interfolio\.com\/\d+(?:$|\?|#)/i.test(url) && !/\/positions?\//i.test(url)) continue;

          const title = clean(a.textContent);
          if (!title || title.length < 6) continue;

          if (/sign in|log in|privacy|accessibility|equal opportunity|nondiscrimination/i.test(title)) continue;
          out.push({ title, url });
        }

        const seen = new Set();
        return out.filter((x) => (x.url && !seen.has(x.url) && (seen.add(x.url), true)));
      }).catch(() => []);

      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        jobs.push(j);
      }

      const next = page.locator('a[rel="next"], a:has-text("Next"), button:has-text("Next")').first();
      if ((await next.count().catch(() => 0)) === 0) break;
      if (!(await next.isVisible().catch(() => false))) break;

      const tag = await next.evaluate((el) => el.tagName).catch(() => "A");
      if (tag === "A") {
        const href = await next.getAttribute("href").catch(() => null);
        if (!href) break;
        const nextUrl = new URL(href, page.url()).toString();
        if (nextUrl === page.url()) break;
        await gotoWithRetry(page, nextUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(800);
      } else {
        await next.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length}`);
    return filtered.map((j) => ({
      title: (j.title || "").replace(/\s+/g, " ").trim(),
      url: j.url,
      source: sourceName,
      category: "Faculty",
      college: campusName,
      location: null,
      description: null,
    }));
  } finally {
    await page.close().catch(() => {});
  }
}

// InterviewExchange (e.g., WIU) – best-effort link scrape
// Extracts faculty-titled position links from whatever InterviewExchange page
// is currently loaded. Shared by scrapeInterviewExchangeAs's landing-page pass
// and its per-category fan-out (see below).
async function extractInterviewExchangeJobs(page) {
  return await safeEvaluate(page, () => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const abs = (href) => { try { return new URL(href, location.href).toString(); } catch { return null; } };

    const out = [];
    const seen = new Set();

    const anchors = Array.from(document.querySelectorAll("a[href]"));
    for (const a of anchors) {
      const url = abs(a.getAttribute("href"));
      if (!url) continue;

      const title = clean(a.textContent);
      if (!title || title.length < 6) continue;

      const okUrl = /position|posting|requisition|job|opportunity|posting\.jsp/i.test(url);
      const okTitle = /professor|lecturer|instructor|\bfaculty\b/i.test(title);

      if (!okUrl && !okTitle) continue;

      if (/privacy|accessibility|login|sign in|home|contact/i.test(title)) continue;

      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ title, url });
    }

    return out;
  }).catch(() => []);
}

async function scrapeInterviewExchangeAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);

    let items = await extractInterviewExchangeJobs(page);
    const hasRealFacultyJob = (list) => list.some((x) => looksFacultyish(x.title) && !omitAdjunct(x.title));

    // Some IX sites (e.g. UTEP) only ever show postings once a department
    // category is selected — the landing page lists bare category links
    // (?catid=NNN) plus a handful of unrelated nav links that happen to match
    // the URL/title heuristics (hence checking for a real faculty match, not
    // just a non-empty list). Fan out into each category and merge, rather
    // than reporting an empty result for a page that's really just an index.
    if (!hasRealFacultyJob(items)) {
      const categoryUrls = await safeEvaluate(page, () => {
        const abs = (href) => { try { return new URL(href, location.href).toString(); } catch { return null; } };
        const out = new Set();
        for (const a of document.querySelectorAll('a[href*="catid="]')) {
          const url = abs(a.getAttribute("href"));
          if (url) out.add(url);
        }
        return [...out];
      }).catch(() => []);

      if (categoryUrls.length > 0) {
        const seen = new Set();
        const merged = [];
        for (const catUrl of categoryUrls.slice(0, 40)) {
          await gotoWithRetry(page, catUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
          await page.waitForTimeout(800);
          const batch = await extractInterviewExchangeJobs(page);
          for (const j of batch) {
            if (seen.has(j.url)) continue;
            seen.add(j.url);
            merged.push(j);
          }
        }
        items = merged;
      }
    }

    const filtered = items.filter((x) => looksFacultyish(x.title)).filter((x) => !omitAdjunct(x.title));
    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length}`);
    return filtered.map((x) => ({
      title: (x.title || "").replace(/\s+/g, " ").trim(),
      url: x.url,
      source: sourceName,
      category: "Faculty",
      college: campusName,
      location: null,
      description: null,
    }));
  } finally {
    await page.close().catch(() => {});
  }
}


/* ============================== CLAREMONT COLLEGES ============================== */

async function scrapeClaremontAll(context) {
  const tasks = CLAREMONT_CAMPUSES.map(({ campus, type, url }) =>
    (async () => {
      try {
        if (type === "static") return await scrapeStaticLinksAs(context, url, campus, "Claremont");
        if (type === "cmc") return await scrapeClaremontCmc(context, url, campus);
        if (type === "workday") return await scrapeClaremontWorkday(context, url, campus);
        if (type === "pomona") return await scrapePomonaFacultyJobs(context, url, campus);
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "Claremont");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} Claremont scrape failed:`, e?.message || e);
        return [];
      }
    })()
  );

  const settled = await Promise.allSettled(tasks);
  const jobs = settled.flatMap((r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));
  const out = uniqByUrl(jobs);
  console.log(`Claremont Colleges listings scraped: ${out.length}`);
  return out;
}


function toStaticJob(title, url, campusName, sourceName) {
  return {
    title: normalizeJobTitle(title),
    url,
    source: sourceName,
    category: "Faculty",
    college: campusName,
    location: null,
    description: null,
  };
}

async function scrapeStaticLinksAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(800);

    const items = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return null;
        }
      };

      const out = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;

        const title = clean(a.textContent);
        if (!title || title.length < 6) continue;

        // Avoid obvious nav/footer links
        const bad =
          /skip to/i.test(title) ||
          /privacy|accessibility|equal opportunity|nondiscrimination/i.test(title) ||
          /contact|about|directory|apply now/i.test(title);

        if (bad) continue;

        // prefer likely job links
        const ok = /job|posting|position|faculty|academic|career|requisition/i.test(url) || /professor|faculty|lecturer|instructor/i.test(title);
        if (!ok) continue;

        out.push({ title, url });
      }

      // de-dupe by url
      const seen = new Set();
      return out.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
    });

    return items.map((x) => toStaticJob(x.title, x.url, campusName, sourceName));
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeKnoxFacultyJobs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };

      const out = [];
      const seen = new Set();
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;
        const title = clean(a.textContent);
        if (!title || title.length < 4) continue;

        const urlOk =
          /\.pdf(\?|$)/i.test(url) ||
          /faculty[_-]?job[_-]?listings/i.test(url);
        const titleOk = /professor|lecturer|instructor|visiting|tenure/i.test(title);
        if (!urlOk && !titleOk) continue;
        if (/^faculty$/i.test(title) || /^knox college faculty$/i.test(title) || /view faculty openings?/i.test(title)) continue;
        if (/news|directory|our faculty/i.test(title)) continue;

        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title, url });
      }
      return out;
    });

    const jobs = (items || [])
      .map((x) => ({
        title: normalizeJobTitle(x.title),
        url: x.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      }))
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// Illinois Eastern Community Colleges (iecc.edu/jobs): a single district-wide
// listings page shared by 4 campuses (Frontier, Lincoln Trail, Olney
// Central, Wabash Valley) plus the district office, rendered as two
// accordion panels ("Full-time Openings" / "Part-time Openings"), each a
// single <div class="field--name-field-body"> containing a flat sequence of
// <h3> campus-header / <ul> posting-list pairs (verified directly against
// the raw DOM: exactly 2 such divs on the page, each with headers like
// "Lincoln Trail College Campus, Robinson, IL" immediately followed by a
// <ul> of that campus's own postings, each posting a real <a href> to a PDF).
// A shared "Frontier, Olney Central, Lincoln Trail, Wabash Valley" header
// also exists for postings not scoped to one campus -- deliberately
// excluded here since attributing it to any single campus would be a guess.
// campusHeaderPrefix scopes to one campus's own <ul> only (verified live:
// Lincoln Trail's and Wabash Valley's own sections have zero overlapping
// filenames, confirming clean separation, not shared-district
// misattribution).
async function scrapeIeccCampusJobs(context, startUrl, campusName, sourceName, campusHeaderPrefix) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);

    const items = await safeEvaluate(page, (headerPrefix) => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };
      const prefixLower = headerPrefix.toLowerCase();

      const out = [];
      const seen = new Set();
      for (const container of Array.from(document.querySelectorAll(".field--name-field-body"))) {
        let capturing = false;
        for (const el of Array.from(container.children)) {
          if (el.tagName === "H3") {
            capturing = clean(el.textContent).toLowerCase().startsWith(prefixLower);
            continue;
          }
          if (capturing && el.tagName === "UL") {
            for (const a of Array.from(el.querySelectorAll("a[href]"))) {
              const url = abs(a.getAttribute("href"));
              const title = clean(a.textContent);
              if (!url || !title || title.length < 3) continue;
              if (seen.has(url)) continue;
              seen.add(url);
              out.push({ title, url });
            }
          }
        }
      }
      return out;
    }, campusHeaderPrefix);

    const jobs = (items || [])
      .map((x) => ({
        title: normalizeJobTitle(x.title),
        url: x.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      }))
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeKzooFacultyJobs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };
      const slugToTitle = (url) => {
        try {
          const u = new URL(url);
          const parts = u.pathname.split("/").filter(Boolean);
          const slug = parts[parts.length - 1] || "";
          if (!slug) return "";
          return clean(slug.replace(/[-_]+/g, " "));
        } catch {
          return "";
        }
      };

      const out = [];
      const seen = new Set();
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;
        if (!/provost\.kzoo\.edu\/faculty-information\/facultyjobs\//i.test(url)) continue;
        if (!/\/facultyjobs\/[^/?#]+\/?$/i.test(url)) continue;

        let title = clean(a.textContent);
        if (!title || title.length < 4 || title.length < 10) {
          title = slugToTitle(url);
        }
        if (!title || title.length < 4) continue;
        if (!/professor|lecturer|instructor|visiting|faculty/i.test(title + " " + url)) continue;
        if (/faculty jobs?|faculty positions?|faculty information/i.test(title)) continue;

        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title, url });
      }
      return out;
    });

    const jobs = (items || [])
      .map((x) => ({
        title: titleCaseWords(normalizeJobTitle(x.title)),
        url: x.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      }))
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}


function toClaremontJob(title, url, campusName) {
  return { title, url, source: "Claremont Colleges", category: "Faculty", college: campusName, location: null, description: null };
}

async function scrapeClaremontStatic(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(800);

    const items = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return null;
        }
      };
      const badText = (t) => !t || t.length < 4 || /search|filter|back|home|login|privacy|accessibility|contact/i.test(t);

      const out = [];
      const seen = new Set();

      const links = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({ title: clean(a.textContent), url: abs(a.getAttribute("href")) }))
        .filter((x) => x.url && !badText(x.title));

      for (const x of links) {
        const u = x.url.toLowerCase();
        const t = x.title.toLowerCase();
        const ok =
          u.endsWith(".pdf") ||
          /professor|lecturer|instructor/i.test(t) || /\bfaculty\b/i.test(t) ||
          /job|faculty|opening|position|postings/i.test(u);

        if (!ok) continue;
        if (seen.has(x.url)) continue;
        seen.add(x.url);
        out.push(x);
      }

      if (out.length < 3) {
        const titleish = Array.from(document.querySelectorAll("h2, h3, h4, li, p"))
          .map((n) => clean(n.textContent))
          .filter((t) => t.length >= 8 && t.length <= 180)
          .filter((t) => /professor|lecturer|instructor/i.test(t) || /\bfaculty\b/i.test(t));

        const uniq = [];
        const s2 = new Set();
        for (const t of titleish) {
          const k = t.toLowerCase();
          if (s2.has(k)) continue;
          s2.add(k);
          uniq.push({ title: t, url: location.href });
          if (uniq.length >= 40) break;
        }
        if (uniq.length) out.push(...uniq);
      }

      return out;
    });

    const filtered = items
      .map((x) => ({ title: clean(x.title), url: x.url }))
      .filter((x) => x.title && x.title.length >= 6)
      .filter((x) => !/faculty jobs$/i.test(x.title));

    console.log(`${campusName} Claremont listings scraped: ${filtered.length}`);
    return filtered.map((x) => toClaremontJob(x.title, x.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

// Pomona College's faculty-jobs page renders each opening as an accordion
// tab (role="tab" button + hidden panel). The real title lives on the tab
// header — the <a> links inside the panel are generic "Workday REQ# ..."
// application links (or a bare "Academic Jobs Online #12345" mention with
// no link at all), so scraping <a href> text directly (the old "static"
// scraper) produced titles like "Workday REQ# 7951-1" instead of the real
// job title. See GitHub issue #1.
async function scrapePomonaFacultyJobs(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(800);

    const items = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return null;
        }
      };

      const out = [];
      for (const tab of Array.from(document.querySelectorAll('[role="tab"]'))) {
        const title = clean(tab.textContent);
        if (!title || title.length < 6) continue;

        const panelId = tab.getAttribute("aria-controls");
        const panel = panelId ? document.getElementById(panelId) : null;
        const panelText = clean(panel?.textContent || "");

        // Prefer a real application link (Workday/Interfolio/AJO) inside the panel.
        let url = null;
        if (panel) {
          const links = Array.from(panel.querySelectorAll("a[href]"))
            .map((a) => ({ href: abs(a.getAttribute("href")), text: clean(a.textContent) }))
            .filter((l) => l.href && !/^mailto:/i.test(l.href));
          const appLink = links.find(
            (l) =>
              /workday|interfolio|academicjobsonline|req[#\s-]?\d/i.test(l.text) ||
              /workday|interfolio|academicjobsonline/i.test(l.href)
          );
          if (appLink) url = appLink.href;
        }

        // Fall back to constructing an AcademicJobsOnline URL from a bare
        // "Academic Jobs Online #12345" mention (no hyperlink present).
        if (!url) {
          const m = panelText.match(/Academic Jobs?\s*Online\s*#?\s*(\d+)/i);
          if (m) url = `https://academicjobsonline.org/ajo/jobs/${m[1]}`;
        }

        // Last resort: link back to the faculty-jobs page itself so the
        // posting isn't silently dropped.
        if (!url) url = location.href;

        out.push({ title, url });
      }

      // de-dupe by url
      const seen = new Set();
      return out.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
    });

    console.log(`${campusName} Claremont listings scraped: ${items.length}`);
    return items.map((x) => toClaremontJob(normalizeJobTitle(x.title), x.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeClaremontCmc(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(800);

    const items = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return null;
        }
      };

      const out = [];
      const seen = new Set();

      const rows = Array.from(document.querySelectorAll("table tr, tr"));
      for (const r of rows) {
        const a = r.querySelector("a[href]");
        if (!a) continue;

        // Every row's anchor text is a generic "View" CTA (confirmed live: all
        // 9 of CMC's real open positions were being mistitled "View" and
        // dropped by the length<10 filter downstream) — the real title lives
        // in the row's own <td> instead. `||` only ever reached that fallback
        // when the anchor text was empty, which it never was.
        let title = clean(a.textContent);
        const rowTitle = clean(r.querySelector("td")?.textContent);
        if (!title || title.length < 10 || /^(view|apply|details|more|apply now)$/i.test(title)) {
          title = rowTitle || title;
        }
        const url = abs(a.getAttribute("href"));
        if (!title || !url) continue;

        if (/home|back|search|apply now$/i.test(title)) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title, url });
      }

      if (!out.length) {
        for (const a of Array.from(document.querySelectorAll('a[href*="faculty"]'))) {
          const title = clean(a.textContent);
          const url = abs(a.getAttribute("href"));
          if (!title || !url) continue;
          if (seen.has(url)) continue;
          seen.add(url);
          out.push({ title, url });
        }
      }

      return out;
    });

    const filtered = items.filter((x) => x.title && x.url);
    console.log(`${campusName} Claremont listings scraped: ${filtered.length}`);
    return filtered.map((x) => toClaremontJob(clean(x.title), x.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeClaremontWorkday(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForSelector('[data-automation-id="jobTitle"]', { timeout: 20_000 });

    const jobs = [];
    const seen = new Set();
    const visitedPages = new Set();

    for (let safety = 0; safety < 120; safety++) {
      await page.waitForTimeout(450);

      const batch = await page.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const out = [];
        const titleNodes = Array.from(document.querySelectorAll('[data-automation-id="jobTitle"]'));
        for (const n of titleNodes) {
          const title = clean(n.textContent);
          if (!title || title.length < 3) continue;

          const a = n.closest("a[href]") || n.querySelector("a[href]");
          const href = a?.getAttribute?.("href") || a?.href;
          const url = abs(href);
          if (!url) continue;
          if (!/\/job\/|\/jobs\//i.test(url)) continue;

          out.push({ title, url });
        }
        return out;
      });

      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        jobs.push(j);
      }

      const current = await getWorkdayCurrentPageLabel(page);
      if (current) visitedPages.add(current);

      const moved = await goToNextWorkdayPage(page, visitedPages);
      if (!moved) break;

      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForSelector('[data-automation-id="jobTitle"]', { timeout: 15_000 }).catch(() => {});
    }

    console.log(`${campusName} Claremont listings scraped: ${jobs.length}`);
    return jobs.map((j) => toClaremontJob(clean(j.title), j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

/* ======================= WORKDAY PAGINATION HELPERS ======================= */

async function getWorkdayCurrentPageLabel(page) {
  const btn = page
    .locator(
      'button[data-uxi-widget-type="paginationPageButton"][aria-current="page"], ' +
        'button[data-uxi-widget-type="paginationPageButton"][aria-selected="true"]'
    )
    .first();

  if ((await btn.count().catch(() => 0)) > 0) {
    const label = (await btn.getAttribute("aria-label").catch(() => "")) || "";
    const m = label.match(/page\s+(\d+)/i);
    if (m) return m[1];
    const txt = ((await btn.textContent().catch(() => "")) || "").trim();
    if (/^\d+$/.test(txt)) return txt;
  }
  return null;
}

async function goToNextWorkdayPage(page, visitedPages) {
  const nextBtn = page
    .locator('button[data-uxi-widget-type="paginationNextButton"], button[aria-label*="next" i]')
    .first();

  if ((await nextBtn.count().catch(() => 0)) > 0) {
    const disabled =
      (await nextBtn.getAttribute("disabled").catch(() => null)) !== null ||
      (await nextBtn.getAttribute("aria-disabled").catch(() => null)) === "true";
    if (!disabled && (await nextBtn.isVisible().catch(() => false))) {
      await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
      await nextBtn.click({ timeout: 8000 }).catch(() => {});
      return true;
    }
  }

  const buttons = page.locator('button[data-uxi-widget-type="paginationPageButton"]');
  const n = await buttons.count().catch(() => 0);
  if (n === 0) return false;

  const pages = [];
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    const label = (await b.getAttribute("aria-label").catch(() => "")) || "";
    const txt = ((await b.textContent().catch(() => "")) || "").trim();
    const m = label.match(/page\s+(\d+)/i) || txt.match(/^(\d+)$/);
    if (!m) continue;
    const num = m[1];
    if (!(await b.isVisible().catch(() => false))) continue;
    pages.push({ num, locator: b });
  }
  if (!pages.length) return false;

  let current = await getWorkdayCurrentPageLabel(page);
  if (!current) current = "1";
  const curN = Number(current);

  let target = null;
  for (const p of pages) {
    const pn = Number(p.num);
    if (!Number.isFinite(pn)) continue;
    if (pn > curN && !visitedPages.has(p.num)) {
      if (!target || pn < Number(target.num)) target = p;
    }
  }
  if (!target) return false;

  await target.locator.scrollIntoViewIfNeeded().catch(() => {});
  await target.locator.click({ timeout: 8000 }).catch(() => {});
  visitedPages.add(target.num);
  return true;
}

/* ======================= SchoolJobs Pagination Helpers ======================= */

async function schoolJobsSignature(page) {
  return safeEvaluate(page, () => {
    const urls = Array.from(document.querySelectorAll('a[href*="/jobs/"]'))
      .map((a) => a.getAttribute("href") || "")
      .filter((h) => /\/jobs\/\d+/i.test(h))
      .slice(0, 20)
      .join("|");
    return `${(document.title || "").slice(0, 120)}::${urls}`;
  }).catch(() => "");
}

async function schoolJobsGoNext(page) {
  const before = await schoolJobsSignature(page);

  const locators = [
    page.locator('a[rel="next"]').first(),
    page.locator('a[aria-label*="Next" i]').first(),
    page.locator('a:has-text("Next")').first(),
    page.locator('button:has-text("Next")').first(),
  ];

  for (const loc of locators) {
    if (!(await loc.count().catch(() => 0))) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;

    // Always click rather than resolving+navigating the href directly: on
    // schooljobs.com the "next" link's href can point at the wrong tenant
    // slug (e.g. "/careers/Home?page=2" instead of "/careers/<slug>?page=2"),
    // silently dumping the crawl onto governmentjobs.com's homepage after
    // page 1. The site's own client-side router rewrites the URL correctly
    // when the link is actually clicked.
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);

    const start = Date.now();
    while (Date.now() - start < 12_000) {
      const after = await schoolJobsSignature(page);
      if (after && after !== before) return true;
      await page.waitForTimeout(300);
    }
    return false;
  }

  return false;
}

/* =================== SHARED: job detail fetch for CUNY =================== */

async function fetchAllJobDetails(context, links, source, concurrency = 6) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < links.length) {
      const url = links[idx++];
      try {
        const job = await scrapeJobDetail(context, url);
        if (job?.title) results.push({ ...job, source });
      } catch {
        // skip
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function scrapeJobDetail(context, url) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(900);

    const job = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const text = (sel) => clean(document.querySelector(sel)?.textContent);
      const meta = (sel, attr) => clean(document.querySelector(sel)?.getAttribute(attr));

      let title = text("h1") || meta("meta[property='og:title']", "content") || null;

      const nodes = [];
      for (const s of Array.from(document.querySelectorAll("script[type='application/ld+json']"))) {
        try {
          const j = JSON.parse(s.textContent);
          if (Array.isArray(j)) nodes.push(...j);
          else if (j && typeof j === "object" && Array.isArray(j["@graph"])) nodes.push(...j["@graph"]);
          else if (j) nodes.push(j);
        } catch {}
      }

      const isJobPosting = (n) => {
        const t = n?.["@type"];
        return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
      };

      const jp = nodes.find((n) => n && typeof n === "object" && isJobPosting(n));
      if (!title && jp && typeof jp.title === "string") title = clean(jp.title);

      let college = null;
      const org = jp?.hiringOrganization;
      if (typeof org === "string") college = clean(org);
      else if (org && typeof org === "object" && typeof org.name === "string") college = clean(org.name);
      else if (Array.isArray(org)) {
        const first = org.find((o) => o && typeof o.name === "string")?.name;
        if (first) college = clean(first);
      }

      if (!college) {
        const dts = Array.from(document.querySelectorAll("dt"));
        const hit = dts.find((dt) => {
          const t = clean(dt.textContent).toLowerCase();
          return ["college", "campus", "organization", "agency", "department", "company"].some((k) => t.includes(k));
        });
        if (hit) {
          const dd = hit.nextElementSibling;
          if (dd) college = clean(dd.textContent);
        }
      }

      const paras = Array.from(document.querySelectorAll("p"))
        .map((p) => clean(p.textContent))
        .filter((t) => t.length > 40);

      const description =
        meta("meta[property='og:description']", "content") ||
        paras.find((t) => !t.toLowerCase().includes("reasonable accommodation")) ||
        null;

      if (college) {
        const low = college.toLowerCase();
        if (low === "cuny" || low === "the city university of new york") college = null;
      }

      return { title: normalizeUwTitle(title || "(No title found)"), description, college };
    });

    return { title: job.title, description: job.description, college: job.college, url };
  } finally {
    await page.close().catch(() => {});
  }
}




async function scrapeAzAll(context) {
  const tasks = AZ_CAMPUSES.map(({ campus, type, url, locationFilter }) =>
    (async () => {
      try {
        if (type === "asu-table") return await scrapeAsuFacultyPositionsTable(context, campus, url);
        if (type === "paycom") return await scrapePaycomAs(context, url, campus, "AZ", locationFilter || null);
        if (type === "nau-search") {
          const base = await scrapeNauSearch(context, url, campus, "AZ");
          return await enrichEnUsJobCardsFromDetails(context, base, {
            titleDeptSeparator: " - ",
            preferDeptKeys: ["college", "department", "organization", "unit", "school"],
          });
        }
        if (type === "csod") return await scrapeCsodAs(context, url, campus, "AZ");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "AZ");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "AZ");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "AZ");
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "AZ");
        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await page.waitForTimeout(900);
            return await scrapeEnUsFilterSite(page, { source: "AZ", campus, category: "Faculty" });
          } finally {
            await page.close().catch(() => {});
          }
        }
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "AZ");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} AZ scrape failed:`, e?.message || e);
        return [];
      }
    })()
  );

  const settled = await Promise.allSettled(tasks);
  const jobs = settled.flatMap((r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

// ASU (Interfolio) via JSON endpoint; append department in title when present
async function scrapeAsuInterfolio(context, campusName, apiUrl) {
  try {
    const res = await context.request.get(apiUrl, { timeout: 60_000 });
    const json = await res.json().catch(() => null);

    const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    const out = [];

    const pickDept = (p) => {
      const keys = [
        "department",
        "position_department",
        "department_name",
        "org_name",
        "organization",
        "unit_name",
        "school",
        "college",
        "discipline",
      ];
      for (const k of keys) {
        const v = (p && typeof p === "object") ? p[k] : null;
        if (typeof v === "string" && v.trim().length >= 2) return v.trim();
      }
      return null;
    };

    for (const p of rows) {
      const rawTitle =
        (p && (p.position_title || p.title || p.positionTitle || p.position)) || "";
      const title0 = clean(rawTitle);
      if (!title0) continue;

      const dept = pickDept(p);
      const title = dept && !title0.toLowerCase().includes(dept.toLowerCase())
        ? `${title0} — ${dept}`
        : title0;

      const link =
        (p && (p.position_url || p.apply_url || p.url || p.permalink)) || null;

      const url = link ? String(link) : null;
      if (!url) continue;

      out.push({
        title,
        url,
        source: "AZ",
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      });
    }

    console.log(`ASU Interfolio listings scraped: ${out.length}`);
    return uniqByUrl(out);
  } catch (e) {
    console.error(`❌ ${campusName} ASU Interfolio scrape failed:`, e?.message || e);
    return [];
  }
}


async function scrapeNySunyMain(context) {
  // Scrape main SUNY careers page (Cloudflare protected, needs browser)
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, NY_SUNY_MAIN.url, { waitUntil: "networkidle", timeout: 60_000 });
    // Wait for Cloudflare challenge to complete
    await page.waitForTimeout(5000);

    const jobs = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };

      const out = [];
      const seen = new Set();

      // Look for job links on the SUNY careers page
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;

        const title = clean(a.textContent);
        if (!title || title.length < 6) continue;

        // Only include true faculty positions - be strict for SUNY main page
        // Must have professor, lecturer, instructor, or faculty in title
        if (!/professor|lecturer|instructor|\bfaculty\b/i.test(title)) continue;

        // Skip navigation and placeholder links
        if (/search|home|back|return|login|logout|help|privacy|contact/i.test(title)) continue;
        if (/positions?\s+available\s+(on\s+)?campus|available\s+on\s+campus\s+web/i.test(title)) continue;
        // Same category-tile problem as the generic scraper (fixed there
        // separately): a per-campus link on this SUNY-system landing page
        // reading e.g. "Faculty Vacancy Announcements" points at that campus's
        // own job *board*, not a specific posting, but passes the bare
        // faculty-keyword check above just like a real title would.
        if (/^(faculty|staff)\s+(vacancy\s+announcements?|positions?|openings?|jobs?|opportunities|vacancies)$/i.test(title)) continue;

        if (seen.has(url)) continue;
        seen.add(url);

        out.push({ title, url });
      }
      return out;
    });

    const filtered = jobs
      .filter((j) => !omitAdjunct(j.title))
      .map((j) => ({
        title: j.title,
        url: j.url,
        source: "NY",
        category: "Faculty",
        college: inferSunyCampusFromText(j.title, j.url),
        location: null,
        description: null,
      }));

    console.log(`SUNY System main page listings scraped: ${filtered.length}`);
    return filtered;
  } catch (e) {
    console.error(`❌ SUNY main page scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeNySuny(context) {
  // Scrape main SUNY page + individual campuses in parallel
  const [mainJobs, ...campusResults] = await Promise.all([
    scrapeNySunyMain(context),
    ...NY_SUNY_CAMPUSES.map(async ({ campus, type, url }) => {
      try {
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "NY");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "NY");
        if (type === "interfolio") return await scrapeInterfolioAs(context, url, campus, "NY");
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "NY");
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "NY");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} SUNY scrape failed:`, e?.message || e);
        return [];
      }
    }),
  ]);

  const allJobs = [...mainJobs, ...campusResults.flat()];
  const remappedJobs = allJobs.map((j) => {
    if (j?.college && j.college !== "SUNY System") return j;
    return { ...j, college: inferSunyCampusFromText(j?.title, j?.url) };
  });
  console.log(`SUNY total listings scraped: ${remappedJobs.length}`);
  return remappedJobs;
}

// Scrape private NY universities
async function scrapeNyPrivate(context) {
  const results = await mapWithConcurrency(
    NY_PRIVATE_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "NY");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "NY");
        if (type === "icims") return await scrapeIcimsAs(context, url, campus, "NY");
        if (type === "interfolio") return await scrapeInterfolioAs(context, url, campus, "NY");
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "NY");
        if (type === "nyu") return await scrapeNyuFaculty(context, url);
        if (type === "stjohns") return await scrapeStJohnsDirectoryAs(context, url, campus, "NY");
        if (type === "jobvite") return await scrapeJobviteAs(url, campus, "NY");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "NY");
        if (type === "paycom") return await scrapePaycomAs(context, url, campus, "NY");
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "NY");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "NY");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "NY");
        if (type === "saashr") return await scrapeSaasHrApi(url, campus, "NY");
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "NY");
        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            return await scrapeEnUsFilterSite(page, { source: "NY", campus, category: "Faculty" });
          } finally {
            await page.close().catch(() => {});
          }
        }
        return [];
      } catch (e) {
        console.error(`❌ ${campus} NY scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

// Paycom scraper (JS-rendered career portal)
async function scrapePaycomAs(context, startUrl, campusName, sourceName, locationFilter = null) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Paycom portals are SPAs - wait for job cards to render
    await page.waitForTimeout(5000);
    // Try waiting for any job listing element
    await page.waitForSelector('a[href*="job"], .job-listing, .career-page-job, [class*="position"]', { timeout: 15_000 }).catch(() => {});

    const jobs = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };

      const out = [];
      const seen = new Set();

      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;
        if (/login|logout|search|home|about|contact|privacy|terms/i.test(url) && !/job/i.test(url)) continue;

        // Try heading/title element inside the anchor first
        const heading = a.querySelector("h1, h2, h3, h4, h5, strong, .title, .job-title, [class*='title']");
        let title = heading ? clean(heading.textContent) : "";

        // Fall back to first meaningful line of anchor text
        if (!title || title.length < 10) {
          const full = clean(a.textContent);
          // Split on employment-type markers or newlines to get just the title portion
          const firstLine = full.split(/\s*(?:Full[ -]?Time|Part[ -]?Time|Per Diem|[\n\r])/i)[0]?.trim();
          title = firstLine || full;
        }

        if (!title || title.length < 10) continue;
        if (title.length > 200) title = title.substring(0, 200).trim();
        if (/^(menu|search|login|home|back|next|previous|submit|apply|click|more|view)$/i.test(title)) continue;

        // Accept links that look like job postings (Paycom uses /job/ paths)
        const isJobLink = /job/i.test(url) || /position/i.test(url) || /career.*detail/i.test(url);
        if (!isJobLink) continue;

        if (seen.has(url)) continue;
        seen.add(url);

        // Paycom job cards render THREE <p> descendants in a fixed order:
        // [0] position type (e.g. "Full Time" / "Adjunct Instructor
        // (Seasonal as needed)"), [1] location (e.g. "Ottawa University -
        // Surprise, Arizona - Surprise, AZ 85374"), [2] description excerpt.
        // a.querySelector("p") returns [0], NOT the location -- verified
        // live against 10 real cards on Ottawa University's board
        // (2026-08-07) that [0] is always the type line and [1] is always
        // the location line, so index into querySelectorAll explicitly.
        // Captured so a shared multi-campus Paycom tenant (one clientkey
        // covering every campus system-wide) can be scoped to a single
        // campus's postings by the caller instead of misattributing the
        // whole system's job count to one campus record (same principle as
        // the district-wide PeopleAdmin scoping done elsewhere -- established
        // Bemidji State misattribution lesson).
        const locationP = a.querySelectorAll("p")[1];
        const location_ = locationP ? clean(locationP.textContent) : "";

        out.push({ title, url, location: location_ });
      }

      return out;
    });

    // Scope down to one campus's postings when this Paycom tenant is shared
    // system-wide across multiple campuses (see the capture comment above).
    // Left as-is (no filtering) for every existing caller that doesn't pass
    // locationFilter, so this is purely additive.
    const scoped = locationFilter
      ? jobs.filter((j) => (j.location || "").toLowerCase().includes(locationFilter.toLowerCase()))
      : jobs;

    const filtered = scoped.filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length}`);

    return filtered.map((j) => ({
      title: j.title,
      url: j.url,
      source: sourceName,
      category: "Faculty",
      college: campusName,
      location: null,
      description: null,
    }));
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// St. John's University directory scraper — visits sub-pages and extracts SilkRoad job links
async function scrapeStJohnsDirectoryAs(context, directoryUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, directoryUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);

    // Step 1: Collect sub-page links from the directory
    const subPages = await safeEvaluate(page, () => {
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };
      const links = [];
      const seen = new Set();
      for (const a of Array.from(document.querySelectorAll('a[href*="/recruitment/faculty-positions/"]'))) {
        const url = abs(a.getAttribute("href"));
        if (!url || seen.has(url)) continue;
        // Skip the directory page itself
        if (url.replace(/\/$/, "") === location.href.replace(/\/$/, "")) continue;
        seen.add(url);
        links.push(url);
      }
      return links;
    });

    console.log(`St. John's directory sub-pages found: ${subPages.length}`);
    await page.close().catch(() => {});

    // Step 2: Visit each sub-page and extract SilkRoad job links
    const allJobs = [];
    const seen = new Set();

    for (const subUrl of subPages) {
      const subPage = await context.newPage();
      try {
        await subPage.goto(subUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await subPage.waitForTimeout(2000);

        const jobs = await safeEvaluate(subPage, () => {
          const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
          const abs = (href) => {
            try { return new URL(href, location.href).toString(); } catch { return null; }
          };
          const out = [];
          for (const a of Array.from(document.querySelectorAll('a[href*="silkroad.com"]'))) {
            const url = abs(a.getAttribute("href"));
            if (!url) continue;
            const title = clean(a.textContent);
            if (!title || title.length < 5) continue;
            out.push({ title, url });
          }
          return out;
        });

        for (const j of jobs) {
          if (seen.has(j.url)) continue;
          seen.add(j.url);
          allJobs.push(j);
        }
      } catch (e) {
        console.error(`  St. John's sub-page failed: ${subUrl}`, e?.message || e);
      } finally {
        await subPage.close().catch(() => {});
      }
    }

    const filtered = allJobs
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} SilkRoad listings scraped: ${filtered.length}`);

    return filtered.map((j) => ({
      title: j.title,
      url: j.url,
      source: sourceName,
      category: "Faculty",
      college: campusName,
      location: null,
      description: null,
    }));
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// Generic job page scraper (for simple listing pages)
// Institutional career landing pages frequently just link or iframe out to an
// Applicant Tracking System (ATS) where the jobs actually live. Detect that and
// hand off to the existing platform-specific scraper. Order = most common first.
const ATS_HANDOFF_PATTERNS = [
  { platform: "workday", re: /myworkdayjobs\.com|myworkdaysite\.com/i },
  { platform: "pageup", re: /pageuppeople\.com/i },
  { platform: "taleo", re: /taleo\.net/i },
  { platform: "peopleadmin", re: /peopleadmin\.com/i },
  { platform: "schooljobs", re: /schooljobs\.com/i },
  { platform: "csod", re: /csod\.com/i },
  { platform: "paycom", re: /paycomonline\.net/i },
  { platform: "icims", re: /icims\.com/i },
  { platform: "interfolio", re: /interfolio\.com/i },
  { platform: "adp", re: /workforcenow\.adp\.com/i },
];

// Maps a detected platform to its scraper. Function declarations are hoisted, so
// referencing scrapers defined later in this file is safe.
const ATS_HANDOFF_SCRAPERS = {
  workday: scrapeWorkdayAs,
  pageup: scrapePageUpAs,
  taleo: scrapeTaleoAs,
  peopleadmin: scrapePeopleAdminAs,
  schooljobs: scrapeSchoolJobsAs,
  csod: scrapeCsodAs,
  paycom: scrapePaycomAs,
  icims: scrapeIcimsAs,
  interfolio: scrapeInterfolioAs,
  adp: scrapeAdpAs,
};

// Normalize a Workday URL down to its listing root (tenant + site) so the Workday
// scraper gets the job board, not a single deep job-detail link.
function normalizeAtsUrl(platform, url) {
  if (platform === "workday") {
    // An optional locale segment ("en-US", "en-GB", ...) can sit between the
    // tenant host and the site name — without accounting for it, the tenant
    // root gets truncated at the locale segment itself (treating "en-US" as
    // if it were the site), producing a URL that 404s / returns no postings.
    const m = /^(https?:\/\/[^/]+\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?[^/]+)(?:\/|$)/i.exec(url);
    if (m) return m[1];
  }
  return url;
}

// A link whose target is itself the root of a known ATS board (tenant/site with
// no specific job id in the path) is a category tile even when its anchor text
// reads like a real title ("Law Faculty Openings", "Faculty Positions") — the
// generic inline scraper has no way to know that without checking the URL shape.
// Used to drop such links from the inline results so the ATS API-probe/hand-off
// (which fetches the real listings behind the board) still runs.
function isBareAtsBoardRoot(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const segs = u.pathname.split("/").filter(Boolean);
  if (/\.myworkdayjobs\.com$|\.myworkdaysite\.com$/i.test(u.hostname)) return segs.length <= 1;
  if (/(^|\.)schooljobs\.com$/i.test(u.hostname)) return !/\/jobs\//i.test(u.pathname);
  if (/(^|\.)interfolio\.com$/i.test(u.hostname)) return /^positions\/?$/i.test(segs.join("/"));
  return false;
}

// Inspect the loaded page for an ATS hand-off link/iframe. Returns {platform, url} or null.
async function detectAtsHandoff(page) {
  const urls =
    (await safeEvaluate(page, () => {
      const abs = (h) => {
        try { return new URL(h, location.href).toString(); } catch { return null; }
      };
      const out = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const u = abs(a.getAttribute("href"));
        if (u) out.push(u);
      }
      for (const f of Array.from(document.querySelectorAll("iframe[src]"))) {
        const u = abs(f.getAttribute("src"));
        if (u) out.push(u);
      }
      return out;
    })) || [];

  for (const { platform, re } of ATS_HANDOFF_PATTERNS) {
    const hit = urls.find((u) => re.test(u));
    if (hit) return { platform, url: normalizeAtsUrl(platform, hit) };
  }
  return null;
}

// Modern iCIMS / Jibe "career-home" portals (app.jibecdn.com) render listings
// client-side but expose a JSON feed at {origin}/api/jobs. Fetch + paginate that
// directly — far more reliable than scraping the JS-rendered DOM. The careers URL's
// own query params (e.g. tags2=Faculty) are preserved so the server-side filter
// applies. Returns [] for non-Jibe sites so callers can fall through.
async function scrapeJibeApi(careersUrl, campusName, sourceName) {
  let u;
  try { u = new URL(careersUrl); } catch { return []; }
  const origin = u.origin;
  const m = u.pathname.match(/^(.*?)\/jobs(?:\/|$)/i);
  const sitePath = m ? m[1] : "";

  const fetchJson = async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 FacultyAtlasBot", Accept: "application/json" } });
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("json")) return null;
      return await r.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const seen = new Set();
  const collected = [];
  let page = 1;
  let total = Infinity;
  while ((page - 1) * 10 < total && page <= 60) {
    const qp = new URLSearchParams(u.search);
    qp.set("page", String(page));
    qp.set("internal", "f");
    if (!qp.has("sortBy")) qp.set("sortBy", "relevance");
    const json = await fetchJson(`${origin}/api/jobs?${qp.toString()}`);
    if (!json || !Array.isArray(json.jobs)) break; // not a Jibe portal (or done)
    if (typeof json.totalCount === "number") total = json.totalCount;
    if (json.jobs.length === 0) break;
    for (const item of json.jobs) {
      const d = item?.data || {};
      const title = String(d.title || "").replace(/\s+/g, " ").trim();
      const slug = String(d.slug || d.req_id || "").replace(/\s+/g, " ").trim();
      if (!title || !slug) continue;
      const url = `${origin}${sitePath}/jobs/${slug}`;
      if (seen.has(url)) continue;
      seen.add(url);
      collected.push({
        title,
        url,
        location: String(d.short_location || d.full_location || "").trim() || null,
        department: String(d.department || "").trim() || null,
      });
    }
    page++;
  }

  // The careers URL is already faculty-scoped (tags2=Faculty); just drop adjunct pools.
  return collected
    .filter((j) => !omitAdjunct(j.title))
    .map((j) => {
      const inferred = inferAcademicFieldsFromTitle(j.title);
      return {
        title: j.title,
        url: j.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: j.location,
        description: null,
        department: j.department || inferred.department,
        specialization: inferred.specialization,
      };
    });
}

// Shared helper for the API-based career-portal scrapers below.
async function fetchJsonApi(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 FacultyAtlasBot", Accept: "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Normalize a posting date from an API feed to YYYY-MM-DD; reject implausible years.
function normalizePostedDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00Z" : s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 2000 || y > 2100) return null;
  return d.toISOString().slice(0, 10);
}

function mapApiJobs(rows, campusName, sourceName) {
  return rows
    // Shared by every ATS API-probe scrapeGenericJobPage tries (Oracle Cloud,
    // FIU, ADP, CSOD, Paycom) before falling to the DOM/hand-off path — none of
    // these APIs are faculty-scoped by default, so without this a board that
    // lists every open req (facilities, athletics, coaches, ...) comes back
    // as if it were all "Faculty" category (same gap fixed for Oracle CX's
    // dedicated scraper earlier, but that's a separate code path from here).
    .filter((j) => j.title && j.url && looksFacultyish(j.title) && !omitAdjunct(j.title))
    .map((j) => {
      // API feeds (Oracle/ADP/csod/Paycom/Jibe) skip the DOM path, so normalize
      // titles here too — strips leading requisition numbers ("131520-Title"), etc.
      const title = normalizeJobTitle(j.title) || clean(j.title);
      const inferred = inferAcademicFieldsFromTitle(title);
      // Source posting date / application deadline when the feed provides them
      // (e.g. Oracle PostedDate / PostingEndDate). closeDate feeds the card's
      // DEADLINE column.
      const datePosted = normalizePostedDate(j.postedDate);
      const closeDate = normalizePostedDate(j.postingEndDate);
      return {
        title,
        url: j.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: j.location || null,
        description: null,
        department: j.department || inferred.department,
        specialization: inferred.specialization,
        ...(datePosted ? { datePosted } : {}),
        ...(closeDate ? { closeDate } : {}),
      };
    });
}

// Oracle Cloud HCM (Recruiting) "CandidateExperience" sites expose a REST feed at
// /hcmRestApi/.../recruitingCEJobRequisitions. Preserve the CE URL's facet params
// (e.g. selectedCategoriesFacet for a faculty filter). Returns [] for non-Oracle URLs.
async function scrapeOracleCloudApi(ceUrl, campusName, sourceName) {
  let u;
  try { u = new URL(ceUrl); } catch { return []; }
  if (!/\.oraclecloud\.com$/i.test(u.hostname)) return [];
  const siteNumber = (u.pathname.match(/\/sites\/([^/]+)(?:\/|$)/) || [])[1];
  if (!siteNumber) return [];
  const FACETS = "LOCATIONS%3BWORK_LOCATIONS%3BWORKPLACE_TYPES%3BTITLES%3BCATEGORIES%3BORGANIZATIONS%3BPOSTING_DATES%3BFLEX_FIELDS";
  const EXPAND = "requisitionList.workLocation,requisitionList.otherWorkLocations,requisitionList.secondaryLocations,flexFieldsFacet.values,requisitionList.requisitionFlexFields";
  const FACET_KEYS = /^(selected.*Facet|lastSelectedFacet|keyword|location|locationId|radius|radiusUnit|mode|selectedFlexFieldsFacets|selectedPostingDatesFacet)$/i;
  const facetParams = (ceUrl.split("?")[1] || "").split("&").filter((kv) => FACET_KEYS.test(kv.split("=")[0]));

  const rows = [];
  const seen = new Set();
  let offset = 0;
  let total = Infinity;
  while (offset < total && offset < 2000) {
    const finder = `findReqs;siteNumber=${siteNumber},facetsList=${FACETS},limit=25,offset=${offset},sortBy=POSTING_DATES_DESC` +
      (facetParams.length ? "," + facetParams.join(",") : "");
    const api = `${u.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=${EXPAND}&finder=${finder}`;
    const j = await fetchJsonApi(api);
    const item = j?.items?.[0];
    if (!item) break;
    if (typeof item.TotalJobsCount === "number") total = item.TotalJobsCount;
    const reqs = item.requisitionList || [];
    if (!reqs.length) break;
    for (const req of reqs) {
      const id = String(req.Id || "").trim();
      const title = String(req.Title || "").trim();
      if (!id || !title) continue;
      const url = `${u.origin}/hcmUI/CandidateExperience/en/sites/${siteNumber}/job/${id}`;
      if (seen.has(url)) continue;
      seen.add(url);
      rows.push({ title, url, location: req.PrimaryLocation, department: req.Department, postedDate: req.PostedDate, postingEndDate: req.PostingEndDate });
    }
    offset += 25;
  }
  return mapApiJobs(rows, campusName, sourceName);
}

// FIU's PantherSoft (PeopleSoft) career search exposes a public JSON feed at
// search.careers.fiu.edu/api/jobs with a JOB_FAMILY facet ("Faculty",
// "Temporary Faculty", "Adjunct", "Staff", ...). One request returns the full
// catalog (no pagination needed at FIU's current volume).
async function scrapeFiuApi(campusName, sourceName) {
  const j = await fetchJsonApi("https://search.careers.fiu.edu/api/jobs?limit=2000");
  const postings = Array.isArray(j?.JOB_POSTINGS) ? j.JOB_POSTINGS : [];
  const rows = postings
    .filter((p) => /^(Faculty|Temporary Faculty)$/i.test(String(p?.JOB_FAMILY || "").trim()))
    .map((p) => ({
      title: p.POSTING_TITLE,
      url: p.URL,
      location: p.LOCATION || null,
      department: p.BUSINESS_UNIT || p.DEPARTMENT || null,
      postedDate: p.OPEN_DT || null,
    }));
  return mapApiJobs(rows, campusName, sourceName);
}

// ADP WorkforceNow career centers expose a public feed at
// /mascsr/default/careercenter/public/events/staffing/v1/job-requisitions (cid+ccId).
// Returns [] for non-ADP URLs.
// ATS hand-off wrapper: matches the (context, url, campusName, sourceName)
// signature every other ATS_HANDOFF_SCRAPERS entry uses; scrapeAdpApi itself
// needs no browser context since it hits the public ADP feed directly.
async function scrapeAdpAs(context, url, campusName, sourceName, locationFilter = null) {
  return await scrapeAdpApi(url, campusName, sourceName, locationFilter);
}

async function scrapeAdpApi(careersUrl, campusName, sourceName, locationFilter = null) {
  let u;
  try { u = new URL(careersUrl); } catch { return []; }
  if (!/workforcenow\.adp\.com$/i.test(u.hostname)) return [];
  const cid = u.searchParams.get("cid");
  const ccId = u.searchParams.get("ccId");
  const lang = u.searchParams.get("lang") || "en_US";
  if (!cid || !ccId) return [];
  const base = `${u.origin}/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions`;

  const rows = [];
  const seen = new Set();
  let skip = 0;
  let total = Infinity;
  while (skip < total && skip < 2000) {
    const api = `${base}?cid=${cid}&ccId=${ccId}&lang=${lang}&locale=${lang}&$top=50&$skip=${skip}`;
    const j = await fetchJsonApi(api);
    const arr = j?.jobRequisitions;
    if (!Array.isArray(arr)) break;
    if (typeof j?.meta?.totalNumber === "number") total = j.meta.totalNumber;
    if (!arr.length) break;
    for (const req of arr) {
      const id = String(req.itemID || "").trim();
      const title = String(req.requisitionTitle || "").trim();
      if (!id || !title) continue;
      const url = `${u.origin}/mascsr/default/mdf/recruitment/recruitment.html?cid=${cid}&ccId=${ccId}&jobId=${id}&lang=${lang}&source=CC2`;
      if (seen.has(url)) continue;
      seen.add(url);
      const loc = Array.isArray(req.requisitionLocations) && req.requisitionLocations[0]
        ? [req.requisitionLocations[0].nameCode?.shortName, req.requisitionLocations[0].countrySubdivisionLevel1?.codeValue].filter(Boolean).join(", ")
        : null;
      rows.push({ title, url, location: loc, department: null });
    }
    skip += 50;
  }
  // Scope a shared multi-campus ADP tenant to one campus. Unlike the
  // Paycom/schooljobs locationFilter elsewhere in this file, ADP's own
  // requisitionLocations field is inconsistently populated across tenants
  // (confirmed via a raw API dump for Polytechnic University of Puerto
  // Rico's shared Miami/Orlando tenant: most rows return no location at
  // all), but the campus is often baked directly into the title instead
  // (e.g. "PROFESSOR - ORLANDO") -- so match against title+location
  // combined rather than location alone. No-op (unfiltered, same as every
  // existing caller) when locationFilter isn't passed.
  const scoped = locationFilter
    ? rows.filter((r) => `${r.title} ${r.location || ""}`.toLowerCase().includes(locationFilter.toLowerCase()))
    : rows;
  return mapApiJobs(scoped, campusName, sourceName);
}

// Cornerstone (csod) and Paycom modern career sites gate their JSON APIs behind a
// short-lived JWT the page mints. Load the page in the browser context, capture
// the first matching API request (url + auth header + body), then replay it with
// pagination. Returns the captured request or null.
async function captureApiRequest(context, careerUrl, pattern, waitMs = 5000) {
  const page = await context.newPage();
  let captured = null;
  page.on("request", (r) => {
    if (captured || !pattern.test(r.url())) return;
    const auth = r.headers()["authorization"];
    if (auth) captured = { url: r.url(), auth, body: r.postData() };
  });
  try {
    await gotoWithRetry(page, careerUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(waitMs);
  } catch { /* ignore */ } finally {
    await page.close().catch(() => {});
  }
  return captured;
}

function parseBody(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }

// Cornerstone OnDemand modern UX careersite. API: POST us.api.csod.com/rec-job-search/external/jobs.
async function scrapeCsodApi(context, careerUrl, campusName, sourceName) {
  let u;
  try { u = new URL(careerUrl); } catch { return []; }
  if (!/\.csod\.com$/i.test(u.hostname)) return [];
  const corp = u.searchParams.get("c") || u.hostname.split(".")[0];
  const siteId = (u.pathname.match(/careersite\/(\d+)/) || [])[1];
  if (!siteId) return [];
  const cap = await captureApiRequest(context, careerUrl, /rec-job-search\/external\/jobs/);
  if (!cap) return [];
  const baseBody = parseBody(cap.body);
  const rows = [];
  const seen = new Set();
  let pageNumber = 1;
  let total = Infinity;
  while ((pageNumber - 1) * 25 < total && pageNumber <= 80) {
    const resp = await context.request
      .post(cap.url, { headers: { authorization: cap.auth, "content-type": "application/json" }, data: { ...baseBody, pageNumber, pageSize: 25 } })
      .catch(() => null);
    if (!resp || !resp.ok()) break;
    const j = await resp.json().catch(() => null);
    const d = j?.data || {};
    if (typeof d.totalCount === "number") total = d.totalCount;
    const reqs = d.requisitions || [];
    if (!reqs.length) break;
    for (const req of reqs) {
      const id = req.requisitionId;
      const title = String(req.displayJobTitle || "").trim();
      if (!id || !title) continue;
      const url = `${u.origin}/ux/ats/careersite/${siteId}/job/${id}?c=${corp}`;
      if (seen.has(url)) continue;
      seen.add(url);
      const l = Array.isArray(req.locations) && req.locations[0] ? req.locations[0] : null;
      rows.push({ title, url, location: l ? [l.city, l.state, l.country].filter(Boolean).join(", ") : null, department: null });
    }
    pageNumber++;
  }
  return mapApiJobs(rows, campusName, sourceName);
}

// Paycom modern career portal. API: POST .../api/ats/job-posting-previews/search.
async function scrapePaycomApi(context, careerUrl, campusName, sourceName) {
  let u;
  try { u = new URL(careerUrl); } catch { return []; }
  if (!/paycomonline\.net$/i.test(u.hostname)) return [];
  const portalId = (u.pathname.match(/\/portal\/([A-F0-9]+)/i) || [])[1];
  if (!portalId) return [];
  const cap = await captureApiRequest(context, careerUrl, /job-posting-previews\/search/);
  if (!cap) return [];
  const baseBody = parseBody(cap.body);
  const take = baseBody.take || 10;
  const rows = [];
  const seen = new Set();
  let skip = 0;
  while (skip < 2000) {
    const resp = await context.request
      .post(cap.url, { headers: { authorization: cap.auth, "content-type": "application/json" }, data: { ...baseBody, skip, take } })
      .catch(() => null);
    if (!resp || !resp.ok()) break;
    const j = await resp.json().catch(() => null);
    const arr = j?.jobPostingPreviews || [];
    if (!arr.length) break;
    for (const job of arr) {
      const id = job.jobId;
      const title = String(job.jobTitle || "").trim();
      if (!id || !title) continue;
      // Paycom portals list ALL jobs (coaches, staff, etc.) and the URL isn't always
      // faculty-scoped — keep a job only if its positionType is faculty-ish OR the
      // title looks faculty (covers faculty postings with an empty positionType).
      const facultyType = /faculty|professor|instructor|lecturer|academic/i.test(String(job.positionType || ""));
      if (!facultyType && !looksFacultyish(title)) continue;
      const url = `${u.origin}/v4/ats/web.php/portal/${portalId}/jobs/${id}`;
      if (seen.has(url)) continue;
      seen.add(url);
      rows.push({ title, url, location: job.locations || null, department: null });
    }
    skip += take;
  }
  return mapApiJobs(rows, campusName, sourceName);
}

// A career-url override can repoint an institution at a different ATS than its
// static server.js `type` — e.g. American Baptist College, Chatham University, and
// Colby College are all configured "generic" but were later discovered to really
// live on ADP/Workday portals. Those platforms' listings only load via a
// client-side API call the page never renders into static HTML, so generic DOM
// scraping silently returns nothing regardless of what's actually posted.
// Dispatch straight to the matching specialized handler instead.
//
// Taleo is deliberately NOT in this table: Oracle's terms prohibit scraping it at
// all (see data/policy-rules.json), and those jobs get discarded post-hoc by the
// policy-exclusion filter anyway — routing to the real Taleo scraper would mean
// actively querying a site we've committed not to scrape, for a result we'd throw
// away either way.
const OVERRIDE_PLATFORM_DISPATCH = {
  adp: (context, url, campusName, sourceName) => scrapeAdpApi(url, campusName, sourceName),
  workday: (context, url, campusName, sourceName) => scrapeWorkdayAs(context, url, campusName, sourceName),
  schooljobs: (context, url, campusName, sourceName) => scrapeSchoolJobsAs(context, url, campusName, sourceName),
  governmentjobs: (context, url, campusName, sourceName) => scrapeSchoolJobsAs(context, url, campusName, sourceName),
  peopleadmin: (context, url, campusName, sourceName) => scrapePeopleAdminAs(context, url, campusName, sourceName),
  csod: (context, url, campusName, sourceName) => scrapeCsodAs(context, url, campusName, sourceName),
  icims: (context, url, campusName, sourceName) => scrapeIcimsAs(context, url, campusName, sourceName),
  oracle: (context, url, campusName, sourceName) => scrapeOracleCxAs(context, url, campusName, sourceName),
  interviewexchange: (context, url, campusName, sourceName) => scrapeInterviewExchangeAs(context, url, campusName, sourceName),
  // Bastyr University's override entry already had the correct Paycom URL but
  // was tagged platform_type "generic", so it fell through to plain DOM anchor
  // scraping -- which can't handle Paycom's SPA-rendered job cards (confirmed
  // 0 results despite the URL being right). Reuses the existing scrapePaycomAs
  // function (already dispatched elsewhere for CT/NJ/NY/ME/TN) via this same
  // override-platform mechanism instead of inventing a new one.
  paycom: (context, url, campusName, sourceName) => scrapePaycomAs(context, url, campusName, sourceName),
};

export async function scrapeGenericJobPage(context, startUrl, campusName, sourceName) {
  const effectiveUrl = resolveCareerUrlOverride(campusName, startUrl);
  const overridePlatform = resolveCareerUrlOverridePlatform(campusName);
  if (effectiveUrl !== startUrl) {
    console.log(`↪️  ${campusName} override URL applied`);
  }
  const dispatch = overridePlatform && OVERRIDE_PLATFORM_DISPATCH[overridePlatform];
  if (dispatch) {
    return await dispatch(context, effectiveUrl, campusName, sourceName);
  }

  const page = await context.newPage();
  try {
    await gotoWithRetry(page, effectiveUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);
    // Some widgets (JazzHR/ApplicantPool cards) only populate via a client-side
    // AJAX call after mount, and some pages hop through a client-side redirect
    // to a second app on another domain (e.g. an isolvedhire board) that then
    // renders its own content — both can miss the fixed 2000ms wait above on a
    // slow load (observed on George Fox University and Christian Theological
    // Seminary). This only ever adds patience on top of the existing wait and
    // no-ops instantly once a job-like anchor is already present, so pages that
    // were already fast are unaffected.
    await page
      .waitForSelector('a[href*="/job"], a[href*="/jobs"], a[href*="isolvedhire.com"]', { timeout: 6000 })
      .catch(() => {});

    const evalResult = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      // Career pages are often edited by pasting a link copied out of an Outlook
      // (or Google) email, which wraps the real destination in a tracking
      // redirect — unwrap those before any pattern matching sees the URL, or a
      // real ATS link never gets recognized as one.
      const unwrapTrackingRedirect = (u) => {
        try {
          const parsed = new URL(u);
          if (/\.safelinks\.protection\.outlook\.com$/i.test(parsed.hostname)) {
            const inner = parsed.searchParams.get("url");
            if (inner) return decodeURIComponent(inner);
          }
          if (/^(www\.)?google\.com$/i.test(parsed.hostname) && parsed.pathname === "/url") {
            const inner = parsed.searchParams.get("q") || parsed.searchParams.get("url");
            if (inner) return decodeURIComponent(inner);
          }
        } catch {}
        return u;
      };
      const abs = (href) => {
        try { return unwrapTrackingRedirect(new URL(href, location.href).toString()); } catch { return null; }
      };
      const isLikelyJobPath = (u) =>
        /\/(job|jobs|career|careers|employment|positions?|vacanc(y|ies)|opening|openings|requisitions?)\b/i.test(u) ||
        /job(id|_id|openingid|req|requisition|posting)/i.test(u);
      // Duplicates the ATS_HANDOFF_PATTERNS hostnames (that list lives in outer
      // Node scope and isn't reachable from inside this browser-evaluated
      // closure) — used only to rescue a generic "here"/"apply" CTA link whose
      // title carries no faculty signal but whose target obviously is an ATS.
      const looksLikeAtsUrl = (u) =>
        /myworkdayjobs\.com|myworkdaysite\.com|pageuppeople\.com|taleo\.net|peopleadmin\.com|schooljobs\.com|csod\.com|paycomonline\.net|icims\.com|interfolio\.com|workforcenow\.adp\.com/i.test(u);

      const out = [];
      const seen = new Set();
      // URLs behind titles we recognized as job-board/category tiles rather than
      // real postings (e.g. "Faculty Positions") — kept so the caller can use one
      // as the ATS hand-off target instead of blindly re-scanning the DOM, since a
      // page can link to more than one ATS tenant (e.g. staff + faculty) and only
      // the tile's own URL is known to be the faculty-scoped one.
      const tileUrls = [];

      // Look for job links
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;
        if (!/^https?:\/\//i.test(url)) continue;
        if (/^(?:tel|mailto|sms):/i.test(url)) continue;

        // Skip navigation and common non-job links. Matched as a whole path
        // segment (not a bare substring) — "about" must be its own segment
        // ("/about/") so it doesn't kill compound segments like
        // "/about-felician-university/careers-at-felician/psycprof2/". A bare
        // "/about/" segment still isn't itself a job page even so — but some
        // sites host their real listings at "/about/employment-opportunities/"
        // (Baptist University of the Americas), so exempt it when a later
        // segment is clearly job-related.
        if (/\/(login|logout|search|home|about|contact|privacy|terms|faq|help)(?:\/|$|\?|\.)/i.test(url) && !isLikelyJobPath(url)) continue;
        if (/twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|tiktok\.com/i.test(url)) continue;
        if (/\/events?\b|\/news\b|\/newsroom\b|\/stories?\b|\/blog\b|\/calendar\b|\/alumni\b/i.test(url)) continue;
        // Some sites run their news section on its own subdomain instead of a
        // "/news" path (e.g. "whatsnew.fdu.edu"), which the path-based check
        // above can't see.
        if (/^(https?:\/\/)(news|whatsnew|newsroom|magazine)\./i.test(url)) continue;
        // "-directory" as a compound segment (e.g. "/casc-directory/") is just
        // as much a staff directory as a bare "/directory/" segment — the
        // original check required "directory" to be the whole segment.
        if (/\/directory\b|-directory\b|\/faculty-staff\b|\/our-faculty\b|\/faculty-profiles\b|\/people\b/i.test(url)) continue;
        // Bare "/faculty" or "/faculty/" with NOTHING after it is a directory
        // landing page ("meet our faculty"). Anchored to end-of-path so it
        // doesn't also catch a specific posting slug that just happens to live
        // under a "/faculty/" path segment (e.g. some colleges' own career
        // board puts every posting at "/hr/faculty/<slug>").
        if (/\/faculty\/?($|\?)/i.test(url) && !isLikelyJobPath(url)) continue;

        let title = clean(a.textContent) || clean(a.getAttribute("aria-label")) || clean(a.getAttribute("title"));

        // Independent of title quality: if this anchor's (unwrapped) target is
        // itself a known ATS board, stash it as a hand-off candidate even when
        // the visible text is a generic "here"/"apply"/"click here" CTA — common
        // when the career page was authored by pasting a link out of an email.
        if (looksLikeAtsUrl(url)) tileUrls.push({ title: title || "", url });

        // Some listing widgets (JazzHR/ApplicantPool cards, WordPress/Bootstrap
        // accordion toggles) put the real job title in a sibling/ancestor
        // heading or accordion-toggle element and leave the anchor itself as a
        // generic CTA ("+ View details", "Read More...", "More Info", "Apply",
        // "Job Description", "Download the full Job Description") — verified
        // live across Alfred University, Andrew College, University of
        // Jamestown, Eastern Oklahoma State College, Eastern Shore Community
        // College, Emmaus Bible College, Spring Hill College, Columbia-Greene
        // Community College, and Crowder College, each losing a real posting
        // this way. When the anchor's own text looks like that kind of CTA
        // rather than a title, look one card-container up for a heading/toggle
        // before giving up on this anchor entirely.
        if (
          !title ||
          title.length < 10 ||
          /^\+?\s*(menu|search|login|home|back|next|previous|submit|apply(\s+now)?|click(\s+here)?|more|view|view\s+details?|learn\s+more\.*|read\s+more\.*|more\s+info(rmation)?|job\s+(description|sheet|posting)|download(\s+the)?(\s+full)?\s+job(\s+(description|sheet|posting))?)\.*$/i.test(
            title
          ) ||
          /(…|\.\.\.)\s*$/.test(title)
        ) {
          const card = a.closest(
            "li, article, tr, [class*='job' i], [class*='position' i], [class*='listing' i], [class*='card' i], [class*='posting' i], [class*='accordion' i]"
          );
          const headingEl = card?.querySelector(
            "h1, h2, h3, h4, h5, h6, [class*='job-title' i], [class*='jobtitle' i], [class*='accordion-trigger' i], [class*='accordion__toggle' i], [class*='accordion-button' i], [class*='accordion-header' i]"
          );
          const headingText = headingEl ? clean(headingEl.textContent) : "";
          if (headingText && headingText.length >= 10 && !/^[a-z]/.test(headingText)) {
            title = headingText;
          } else {
            continue;
          }
        }

        if (!title || title.length < 10) continue;
        // A real job posting's title is always a proper heading — a title
        // starting with a lowercase letter is a sentence fragment bleeding
        // through from body/policy text (e.g. a definitions page describing
        // "department chair, program director, or academic coordinator"
        // duties), not an actual posting.
        if (/^[a-z]/.test(title)) continue;

        // Skip navigation elements
        if (/^(menu|search|login|home|back|next|previous|submit|apply|click|more|view)$/i.test(title)) continue;
        if (/faculty\s+(and|&)\s+staff\s+directory|faculty\s+directory|our\s+faculty|meet\s+the\s+faculty|faculty\s+profiles?/i.test(title)) continue;
        if (/^faculty\s*&\s*staff$/i.test(title)) continue;
        if (/faculty\s+association|faculty\s+senate|faculty\s+development|info\s+for\s+faculty\s+and\s+staff/i.test(title)) continue;
        // "Faculty Resources"/"Faculty Resource Center" is a standing info hub
        // (handbooks, forms, IT help), not a posting or even a job-board tile —
        // same family as the directory/profile exclusions above.
        if (/^faculty\s+resources?(\s+center)?$/i.test(title)) continue;
        // A generic file-download widget (WordPress/Elementor "download this
        // file" block) that hasn't been given a friendly label renders its raw
        // target as the link text — e.g. "Download File:
        // https://.../2026-Faculty-Video.mp4?_=1" (Eastern Wyoming College).
        // The word "faculty" living inside that filename was enough to pass
        // isFacultyRelated below and get published as a fake job titled after a
        // URL. A real job title is never a literal URL or a bare attachment
        // filename, regardless of what page it was found on.
        if (/^download(\s+(this\s+)?file)?\s*:?\s*https?:\/\//i.test(title)) continue;
        if (/https?:\/\//i.test(title)) continue;
        if (/\.(mp4|mov|avi|wmv|pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|gif)(\?\S*)?$/i.test(title)) continue;
        if (/^["'“].+["'”]$/.test(title)) continue;
        if (/thank\s+a\s+professor|faculty\s+spotlight|student\s+spotlight|alumni\s+spotlight|testimonial/i.test(title)) continue;
        if (/^(faculty|staff|faculty jobs|employment|careers?)$/i.test(title)) { tileUrls.push({ title, url }); continue; }
        // Category tiles like "Faculty Positions" / "Faculty Openings" link to a job
        // board, not a specific posting — they pass isFacultyRelated above (contain
        // "faculty" + "position"/"opening") but aren't real jobs. Skip them so the
        // ATS API-probe/hand-off fallback below (gated on filtered.length === 0) can
        // still run and pull the real postings instead of stopping at this one tile.
        // Their URL is stashed in tileUrls in case it's itself the ATS hand-off link.
        // Generalized after repeatedly finding new wordings of the same tile
        // ("Faculty Job Listings", "Search Faculty Jobs", "Current Faculty Job
        // Postings", "Faculty & Staff Jobs at ACC", "Full-Time Faculty and Staff
        // Positions", ...) — verified against a corpus of every real title
        // currently sourced through this scraper with zero false positives,
        // including real titles that carry a trailing department tag mentioning
        // "faculty"/"staff" (e.g. "... — COEDU Dean's Office").
        if (
          /^(view|see|search|browse|explore|find)?\s*(all\s+|our\s+|current\s+|available\s+|open\s+|full-time\s+)*(faculty|staff)(\s*(&|and)\s*(faculty|staff|teaching))?\s+(and\s+staff\s+|and\s+teaching\s+)?(job\s+)?(job|jobs|position|positions|opening|openings|opportunit(?:y|ies)|vacanc(?:y|ies)(\s+announcements?)?|posting|postings|listing|listings|announcements?)(\s+(at|for)\s+[a-z0-9.&' ]+)?(\s*[–-]\s*(full-time|part-time))?\s*$/i.test(
            title
          )
        ) {
          tileUrls.push({ title, url });
          continue;
        }
        if (/^(faculty\s+search|instructor\s+application|staff\s*(&|and)\s*instructor\s+directory|faculty\s+professor\s+opportunities)$/i.test(title)) { tileUrls.push({ title, url }); continue; }
        if (/^(view|see|search|browse|explore|find)\s+(all\s+|our\s+)*(open\s+)?(instructor|faculty|staff)\s+position\s+opportunities$/i.test(title)) { tileUrls.push({ title, url }); continue; }
        if (/^(career|employment)\s+opportunities$/i.test(title)) { tileUrls.push({ title, url }); continue; }
        // Board-index tiles worded as a page title/banner rather than a plain
        // category label, e.g. "Faculty & Research Jobs @ Lehigh" (the board's
        // own homepage) or "Other Faculty Openings including Interdisciplinary
        // ... Positions (current)" (a sub-index of the same board).
        if (/^faculty\s*(&|and)\s*research\s+jobs\b/i.test(title)) { tileUrls.push({ title, url }); continue; }
        if (/faculty\s+openings?\s+including\b/i.test(title)) { tileUrls.push({ title, url }); continue; }
        if (/^(view details|learn more|read more|click here)$/i.test(title)) continue;
        // A trailing ellipsis means the extracted text was truncated body/news
        // copy, not a title (real job titles are never cut off this way).
        if (/(…|\.\.\.)\s*$/.test(title)) continue;
        // "dean" alone is in the faculty-keyword list below (a real "Dean of X"
        // opening is a legitimate job), but nav chrome referencing the dean's
        // office/newsletter/welcome-message as a person/unit — not a posting —
        // also contains the word. Anchored to the whole title (optionally with
        // a trailing " – Department" tag) so it can't also catch a real title
        // that happens to carry a "Dean's Office" department attribution
        // elsewhere (verified against the same corpus as above).
        if (
          /^dean('?s)?\s+(office|message|corner|update|welcome|newsletter)(\s*[–-]\s*[a-z0-9 &']+)?$|^office\s+of\s+the\s+dean\b|^(message|welcome)\s+from\s+the\s+dean$|^dean\s+of\s+[a-z'’ ]{0,30}(office|affairs)$/i.test(
            title
          )
        ) {
          continue;
        }
        // A bare "Dean of the Faculty" / "Dean of Students" (etc.) with nothing
        // else is almost always the standing administrative office's own landing
        // page (bio, org chart, "meet the dean"), not a job posting — a real
        // posting for that role is virtually always titled with more than just
        // the office name (a college/department, "Search", a date, a rank).
        if (/^dean\s+of\s+(the\s+)?(faculty|students|admission|admissions|enrollment|academic\s+affairs)$/i.test(title)) continue;
        // Reference/PR material that happens to mention "faculty search" or
        // "postdoc" without being a posting itself.
        if (/\b(search|hiring)\s+(guide|handbook|toolkit|resources?)\b/i.test(title)) continue;
        if (/appreciation\s+week|training\s+program\b/i.test(title)) continue;
        // Administrative forms/pages that reference "instructor"/"faculty" as a
        // role being reviewed, not hired for (e.g. a course-evaluation form).
        if (/\b(instructor|faculty|course)\s+evaluations?\b/i.test(title)) continue;

        // Look for faculty-related keywords in title.
        // "faculty" alone is too noisy on generic pages, so require hiring context.
        // Likewise a bare "dean"/"postdoc" matches page chrome ("Dean's List",
        // "Dean's Office", "Postdoctoral Training", news blurbs about postdocs)
        // far more often than it matches a real posting — real dean openings are
        // almost always phrased "Dean of ___", and real postdoc openings pair the
        // word with a role noun (fellow/scholar/associate/researcher/scientist) or
        // "position"/"opening"/"opportunity", so require that context instead of
        // matching the bare word.
        const isFacultyRelated =
          /\b(professors?|lecturers?|instructors?|department\s+chairs?|chairpersons?)\b/i.test(title) ||
          /\bdean\s+of\b/i.test(title) ||
          /\bpost[\s-]?doc(?:toral)?\b/i.test(title) && /\b(fellow|scholar|associate|research(?:er)?|scientist|position|positions|opening|openings|opportunit(?:y|ies))\b/i.test(title) ||
          // Was requiring "faculty" to co-occur with a hiring-context word
          // (position/opening/job/...), but by this point every noisy bare-
          // "faculty" case (senate, directory, dean's office, category tiles,
          // spotlights) has already been filtered out by the specific checks
          // above — so a bare "faculty" surviving to here is almost always a
          // real title with a department tag and no hiring-context word at all
          // ("Faculty | Philosophy", "FT Faculty Department of Nursing",
          // "Science Faculty (Biotech)"). Matches looksFacultyish's own bare
          // \bfaculty\b bar, which the rest of this codebase already trusts.
          /\bfaculty\b/i.test(title) ||
          // Bare "adjunct" (e.g. "Adjunct: Biology", "Adjunct Faculty,
          // Anatomy & Physiology") with no professor/instructor/lecturer/
          // faculty word alongside it. This is a separate copy of the same
          // gap already fixed in looksFacultyish() (round 6, Adrian College/
          // Belmont Abbey) -- this function runs inside page.evaluate()'s
          // browser context, so it can't call that outer Node function and
          // needed its own copy of the fix. Found via DeSales University
          // while investigating the generic-scraper long tail (2026-08-06).
          /\badjunct\b/i.test(title) ||
          // "Teaching Fellow" (e.g. "Visiting Teaching Fellow, 2026-27") --
          // same addition as looksFacultyish(), same "separate copy needed
          // inside page.evaluate()" reason. Found via Dharma Realm Buddhist
          // University while investigating the generic-scraper long tail
          // (2026-08-07).
          /\bteaching\s+fellows?\b/i.test(title);

        if (!isFacultyRelated) continue;

        // If the title is a bare rank (e.g. "Assistant Professor"), look for department info in parent card
        if (/^(assistant|associate|full)\s+professor(-ntta)?$/i.test(title)) {
          const card = a.closest("li, article, tr, div.job, [class*='job'], [class*='position']") || a.parentElement;
          if (card) {
            const deptEl = card.querySelector("[class*='department'], [class*='dept'], [class*='location'], [class*='category']");
            const dept = deptEl ? clean(deptEl.textContent) : "";
            if (dept && dept.length >= 3 && dept.length <= 80 && dept.toLowerCase() !== title.toLowerCase()) {
              title = `${title} — ${dept}`;
            }
          }
        }

        if (seen.has(url)) continue;
        seen.add(url);

        out.push({ title, url });
      }

      // Some pages have no <a href> anywhere near the title at all — a Bootstrap/
      // WordPress accordion toggle is a plain <button>, not a link (Colorado
      // Northwestern Community College, Baker University, Allen County Community
      // College all do this), or a schema.org JobPosting row's only <a> has no
      // href attribute (Garrett College). The anchor-based scan above can never
      // find these since it only iterates `a[href]`. Only runs when that scan
      // found nothing, so a page that already works via inline anchors is never
      // affected by this — same "gate on empty results" pattern as the ATS
      // hand-off fallback below.
      if (out.length === 0) {
        const candidates = document.querySelectorAll(
          "[class*='accordion-trigger' i], [class*='accordion__toggle' i], [class*='accordion-button' i], [class*='accordion-header' i], button[class*='accordion' i], [itemprop='title']"
        );
        for (const el of candidates) {
          const title = clean(el.textContent);
          if (!title || title.length < 10 || title.length > 120) continue;
          if (/^[a-z]/.test(title)) continue;
          if (
            !(
              /\b(professors?|lecturers?|instructors?|department\s+chairs?|chairpersons?)\b/i.test(title) ||
              /\bfaculty\b/i.test(title)
            )
          ) {
            continue;
          }
          const container =
            el.closest("li, article, tr, [class*='job' i], [class*='position' i], [class*='listing' i], [class*='accordion' i]") ||
            el;
          // No per-job URL exists in this markup shape — link to whatever real
          // document/anchor is nearest (a PDF "job sheet", an ATS apply link),
          // falling back to the listing page itself rather than dropping the
          // posting entirely.
          const nearbyLink = container.querySelector('a[href$=".pdf" i], a[href*="job" i], a[href*="apply" i], a[href]');
          const jobUrl = (nearbyLink && abs(nearbyLink.getAttribute("href"))) || location.href;
          const dedupeKey = `${jobUrl}::${title}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          out.push({ title, url: jobUrl });
        }
      }

      return { jobs: out, tileUrls };
    });

    const jobs = evalResult.jobs;
    const tileUrls = evalResult.tileUrls;

    // A nav/logo link whose text is just the institution's own name (e.g. "Dean
    // College") slips past the isFacultyRelated word-list whenever that name
    // happens to contain one of its keywords ("dean", "professor", etc.) — drop
    // any title that's an exact match for the campus name itself.
    const campusNameKey = clean(campusName).toLowerCase();
    const filtered = jobs
      .filter((j) => !omitAdjunct(j.title))
      .filter((j) => clean(j.title).toLowerCase() !== campusNameKey)
      .filter((j) => !isBareAtsBoardRoot(j.url));

    // Fallback only: if no inline jobs were found, the page likely hands off to an
    // ATS — detect and scrape that. Gated on empty results so pages that already
    // work via inline anchors are never affected (no regression).
    if (filtered.length === 0) {
      // JS-rendered career portals (Oracle Cloud, ADP, iCIMS/Jibe) expose JSON feeds.
      // Try those first — before the anchor/iframe ATS hand-off, which would grab the
      // wrong apply-login link. Each probe returns [] for URLs that aren't its platform.
      for (const probe of [scrapeOracleCloudApi, scrapeAdpApi, scrapeJibeApi]) {
        try {
          const apiJobs = await probe(effectiveUrl, campusName, sourceName);
          if (apiJobs.length > 0) {
            console.log(`↪️  ${campusName}: scraped ${apiJobs.length} listings via ${probe.name}`);
            return apiJobs; // finally{} closes page
          }
        } catch (e) {
          console.warn(`   ↪️  ${campusName} ${probe.name} probe failed: ${e?.message || e}`);
        }
      }
      // Token-replay probes (csod/Paycom) need the browser context to mint the JWT.
      for (const probe of [scrapeCsodApi, scrapePaycomApi]) {
        try {
          const apiJobs = await probe(context, effectiveUrl, campusName, sourceName);
          if (apiJobs.length > 0) {
            console.log(`↪️  ${campusName}: scraped ${apiJobs.length} listings via ${probe.name}`);
            return apiJobs; // finally{} closes page
          }
        } catch (e) {
          console.warn(`   ↪️  ${campusName} ${probe.name} probe failed: ${e?.message || e}`);
        }
      }

      // Prefer the ATS URL from an anchor we recognized by its title (even one we
      // just excluded as a category tile) over detectAtsHandoff's blind first-match
      // DOM scan — a career page can expose more than one ATS tenant/board (e.g. a
      // separate staff vs. faculty Workday site), and detectAtsHandoff has no idea
      // which is which since it only looks at raw hrefs. Among our own candidates,
      // prefer whichever anchor's text reads as faculty-specific.
      const atsCandidates = [...jobs, ...tileUrls]
        .map(({ title, url }) => {
          const hit = ATS_HANDOFF_PATTERNS.find(({ re }) => re.test(url));
          return hit ? { platform: hit.platform, url: normalizeAtsUrl(hit.platform, url), title } : null;
        })
        .filter(Boolean);
      const preferredHandoff =
        atsCandidates.find((c) => /faculty/i.test(c.title) && !/staff/i.test(c.title)) ||
        atsCandidates[0] ||
        null;

      const handoff = preferredHandoff || (await detectAtsHandoff(page));
      if (handoff && ATS_HANDOFF_SCRAPERS[handoff.platform]) {
        console.log(`↪️  ${campusName}: generic page hands off to ${handoff.platform}`);
        try {
          const atsJobs = await ATS_HANDOFF_SCRAPERS[handoff.platform](context, handoff.url, campusName, sourceName);
          if (Array.isArray(atsJobs) && atsJobs.length > 0) return atsJobs; // finally{} closes page
        } catch (e) {
          console.warn(`   ↪️  ${campusName} ${handoff.platform} hand-off failed: ${e?.message || e}`);
        }
      }
    }

    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length}`);

    return filtered.map((j) => {
      const title = j.title.replace(/\s*\(\d{4,}\)\s*[A-Z]{1,4}\s*$/, "").trim();
      const inferred = inferAcademicFieldsFromTitle(title);
      return {
        title,
        url: j.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
        department: inferred.department,
        specialization: inferred.specialization,
      };
    });
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// AcademicJobsOnline (AJO) scraper: uses aria-labelledby/adjacent span text
// because listing link text is often an internal code (e.g., "APO").
async function scrapeAcademicJobsOnlineAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);

    const jobs = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return null;
        }
      };

      const out = [];
      const seen = new Set();

      for (const a of Array.from(document.querySelectorAll("a[href*='/ajo/jobs/']"))) {
        const href = a.getAttribute("href") || "";
        if (/\/apply(?:$|[/?#])/i.test(href)) continue;
        const url = abs(href);
        if (!url || seen.has(url)) continue;

        let title = "";
        const labels = String(a.getAttribute("aria-labelledby") || "")
          .split(/\s+/)
          .filter(Boolean)
          .filter((id) => id !== a.id);
        for (const id of labels) {
          const el = document.getElementById(id);
          const text = clean(el?.textContent || "");
          if (text && text.length >= 4) {
            title = text;
            break;
          }
        }

        if (!title) {
          const m = href.match(/\/ajo\/jobs\/(\d+)/i);
          if (m) {
            const alt = clean(document.getElementById(`j${m[1]}`)?.textContent || "");
            if (alt && alt.length >= 4) title = alt;
          }
        }

        if (!title) title = clean(a.textContent);
        if (!title || title.length < 4) continue;

        seen.add(url);
        out.push({ title, url });
      }
      return out;
    });

    const filtered = jobs
      .map((j) => ({ ...j, title: normalizeJobTitle(j.title) }))
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length} (AcademicJobsOnline)`);

    return filtered.map((j) => {
      const inferred = inferAcademicFieldsFromTitle(j.title);
      return {
        title: j.title,
        url: j.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
        department: inferred.department,
        specialization: inferred.specialization,
      };
    });
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} AcademicJobsOnline scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapePeopleClickAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(3000);

    // A plain GET on this URL renders the search *criteria form*, not results —
    // PeopleClick only shows results after the Search button is submitted (POST
    // back to the same path). Without this, the anchor scan below always saw an
    // empty form (confirmed live on MIT's client_mit board, id "sp-searchButton").
    // Gated with .catch so boards that already land on results (button absent)
    // are unaffected.
    await page.click("#sp-searchButton, button[value='Search'][type='submit']", { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    let jobs = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return null;
        }
      };

      const out = [];
      const seen = new Set();
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        const url = abs(href);
        if (!url) continue;
        if (!/(jobPostId=|jobdetail|jobdetails|viewfromlink|jobid=|\/job\/)/i.test(url)) continue;
        if (/savedjobs|jobcart|login|logout|privacy|terms|help/i.test(url)) continue;

        let title = clean(a.textContent) || clean(a.getAttribute("title")) || clean(a.getAttribute("aria-label"));
        if (!title || title.length < 4) {
          const container = a.closest("li, tr, article, .row, .result, [class*='job'], [class*='posting']");
          if (container) {
            const h = container.querySelector("h1,h2,h3,h4,strong,b,[class*='title'],[class*='jobTitle']");
            title = clean(h?.textContent || "");
          }
        }
        if (!title || title.length < 4) continue;
        if (/^(apply|details?|view|learn more|more)$/i.test(title)) continue;

        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title, url });
      }
      return out;
    });

    if (!Array.isArray(jobs) || jobs.length === 0) {
      const html = await page.content();
      const cleanText = (s) => clean(String(s || "").replace(/<[^>]+>/g, " "));
      const re = /<a[^>]+href=["']([^"']*(?:jobPostId=|jobdetail|jobdetails|viewFromLink|jobId=)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      const seen = new Set();
      const fallback = [];
      let m;
      while ((m = re.exec(html)) !== null) {
        let url = null;
        try {
          url = new URL(m[1], startUrl).toString();
        } catch {
          continue;
        }
        if (/savedjobs|jobcart|login|logout|privacy|terms|help/i.test(url)) continue;
        if (seen.has(url)) continue;
        const title = cleanText(m[2]);
        if (!title || title.length < 4) continue;
        seen.add(url);
        fallback.push({ title, url });
      }
      jobs = fallback;
    }

    const filtered = (jobs || [])
      .map((j) => ({ ...j, title: normalizeJobTitle(j.title) }))
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length} (PeopleClick)`);
    return filtered.map((j) => {
      const inferred = inferAcademicFieldsFromTitle(j.title);
      return {
        title: j.title,
        url: j.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
        department: inferred.department,
        specialization: inferred.specialization,
      };
    });
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} PeopleClick scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeWvsuFacultyPdfAs(startUrl, campusName, sourceName) {
  try {
    const res = await fetch(startUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const cleanText = (s) => clean(String(s || "").replace(/<[^>]+>/g, " "));

    const out = [];
    const seen = new Set();
    const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const hrefRaw = m[1] || "";
      if (!/getattachment\/About\/Administration\/Human-Resources\/Faculty-Positions\/.+\.pdf\.aspx/i.test(hrefRaw)) {
        continue;
      }

      let url = null;
      try {
        url = new URL(hrefRaw, startUrl).toString();
      } catch {
        continue;
      }

      let title = cleanText(m[2]);
      if (!title || title.length < 4) {
        const decoded = decodeURIComponent(hrefRaw);
        const fn = decoded.split("/").pop() || "";
        title = clean(
          fn
            .replace(/\.pdf\.aspx.*$/i, "")
            .replace(/[-_]+/g, " ")
            .replace(/\b\d{1,2}\s+\d{1,2}\s+\d{2,4}\b/g, "")
        );
      }

      title = normalizeJobTitle(title);
      if (!title || !looksFacultyish(title) || omitAdjunct(title)) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      out.push({
        title,
        url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      });
    }

    console.log(`${campusName} ${sourceName} listings scraped: ${out.length}`);
    return out;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  }
}

async function scrapeKeywordSearchJobsAs(
  context,
  startUrl,
  campusName,
  sourceName,
  { queryParam = "q", pathPattern = "/job/" } = {}
) {
  const page = await context.newPage();
  try {
    const terms = ["professor", "faculty", "lecturer", "instructor", "postdoctoral", "fellow"];
    const seen = new Set();
    const jobs = [];

    for (const term of terms) {
      const sep = startUrl.includes("?") ? "&" : "?";
      const url = `${startUrl}${sep}${queryParam}=${encodeURIComponent(term)}`;
      await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForTimeout(1800);

      const batch = await page.evaluate((pathPattern) => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const out = [];
        for (const a of Array.from(document.querySelectorAll("a[href]"))) {
          const href = a.getAttribute("href") || "";
          const fullUrl = abs(href);
          if (!fullUrl) continue;
          if (!fullUrl.includes(pathPattern)) continue;
          const title = clean(a.textContent);
          if (!title || /^read more$/i.test(title) || /^search jobs$/i.test(title)) continue;
          out.push({ title, url: fullUrl });
        }
        return out;
      }, pathPattern);

      for (const j of batch || []) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        const title = normalizeJobTitle(j.title);
        if (!title) continue;
        const lower = title.toLowerCase();
        if (!looksFacultyish(lower) && !/\bpost[\s-]?doc(?:toral)?\b|\bfellow\b/.test(lower)) continue;
        const inferred = inferAcademicFieldsFromTitle(title);
        jobs.push({
          title,
          url: j.url,
          source: sourceName,
          category: "Faculty",
          college: campusName,
          location: null,
          description: null,
          department: cleanDepartmentField(inferred.department),
          specialization: cleanDepartmentField(inferred.specialization),
        });
      }
    }

    const filtered = jobs.filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length} (keyword search)`);
    return filtered;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} keyword-search scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// St. John's College (Santa Fe): scrape concrete ADP job links from the Santa Fe job openings page
async function scrapeSjcSantaFeJobs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return null;
        }
      };

      const out = [];
      const seen = new Set();
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const href = abs(a.getAttribute("href"));
        if (!href) continue;
        if (!/workforcenow\.adp\.com/i.test(href)) continue;
        if (!/jobId=|recruitment\.html/i.test(href)) continue;

        const title = clean(a.textContent);
        if (!title || title.length < 5) continue;
        if (/^(read more|learn more|apply|career center page)$/i.test(title)) continue;

        if (seen.has(href)) continue;
        seen.add(href);
        out.push({ title, url: href });
      }
      return out;
    });

    const jobs = (items || [])
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title))
      .map((j) => ({
        title: clean(j.title),
        url: j.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      }));

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// PageUp scraper (used by Yeshiva University)
async function scrapePageUpAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();
    let currentUrl = startUrl;

    for (let safety = 0; safety < 80; safety++) {
      await gotoWithRetry(page, currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(1200);
      // PageUp's bot-challenge/cookie-banner can delay the real listing past the
      // fixed 1200ms wait on some tenants (observed on Rowan University) — this
      // only ever adds patience (never shortens the existing wait) and no-ops
      // instantly once the selector is already present, so tenants that were
      // already fast are unaffected.
      await page.waitForSelector('a[href*="/job/"], a[href*="/jobs/"]', { timeout: 8000 }).catch(() => {});

      const batch = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const inferLocationFromCard = (cardText) => {
          const t = clean(cardText || "");
          if (!t) return null;
          const m =
            t.match(/\b([A-Za-z .'-]+,\s*[A-Z]{2})\b/) ||
            t.match(/\b([A-Za-z .'-]+,\s*(?:New Mexico|Colorado|Nevada),\s*United States)\b/i) ||
            t.match(/\b(On Campus,\s*Colorado,\s*United States)\b/i) ||
            t.match(/\b(Remote(?: Locations)?)\b/i);
          return m ? clean(m[1]) : null;
        };


        const out = [];
        const anchors = Array.from(document.querySelectorAll("a[href]"));
        for (const a of anchors) {
          const href = a.getAttribute("href") || "";
          const url = abs(href);
          if (!url) continue;

          // Support both PageUp patterns:
          // - /en-us/job/123...
          // - /jobs/some-title...
          if (!/\/job\/|\/jobs\//i.test(url)) continue;
          if (/\/jobs\/search\b|\/listing\b/i.test(url)) continue;

          const title = clean(a.textContent);
          if (!title || title.length < 4) continue;
          if (/^(read more|apply|search|home|back|login|filter|next|more jobs)$/i.test(title)) continue;

          const card = a.closest("article, li, tr, div, section") || a.parentElement;
          const cardText = clean(card?.innerText || "");
          const location = inferLocationFromCard(cardText);
          out.push({ title, url, location });
        }

        const unique = [];
        const pageSeen = new Set();
        for (const x of out) {
          if (!x.url || pageSeen.has(x.url)) continue;
          pageSeen.add(x.url);
          unique.push(x);
        }
        return unique;
      });

      let added = 0;
      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        jobs.push(j);
        added++;
      }

      // Continue pagination while "More Jobs"/"Next" exists.
      const nextHref = await page.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const candidates = Array.from(document.querySelectorAll("a[href]"));
        for (const a of candidates) {
          const txt = clean(a.textContent).toLowerCase();
          const href = a.getAttribute("href") || "";
          if (!href) continue;
          if (txt.includes("more jobs") || txt === "next" || /\bpage\s*\d+\b/i.test(txt)) {
            return href;
          }
        }
        return null;
      });

      if (!nextHref) break;
      const nextUrl = new URL(nextHref, page.url()).toString();
      if (!nextUrl || nextUrl === currentUrl || added === 0) break;
      currentUrl = nextUrl;
    }

    const filtered = jobs
      .filter((j) => looksFacultyish(j.title) || /\bpost[\s-]?doc(?:toral)?\b|\bfellow\b/i.test(j.title || ""))
      .filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length}`);

    return filtered.map((j) => ({
      title: j.title,
      url: j.url,
      source: sourceName,
      category: "Faculty",
      college: campusName,
      location: j.location || null,
      description: null,
    }));
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// iCIMS scraper (used by NYU and others)
// iCIMS uses various selectors for job listings; shared closure so both the
// top-level page and any nested iframes (see below) are scanned identically.
function extractIcimsJobsInPage() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const abs = (href) => {
    try { return new URL(href, location.href).toString(); } catch { return null; }
  };

  const out = [];
  const seen = new Set();

  const selectors = [
    'a[href*="/jobs/"]',
    '.iCIMS_JobsTable a',
    '.job-title a',
    '[class*="JobTitle"] a',
    'a[title]'
  ];

  for (const sel of selectors) {
    for (const a of Array.from(document.querySelectorAll(sel))) {
      const url = abs(a.getAttribute("href"));
      if (!url) continue;
      if (!/\/jobs\/\d+/i.test(url) && !/job-/i.test(url)) continue;

      const title = clean(a.textContent) || clean(a.getAttribute("title"));
      if (!title || title.length < 4) continue;
      if (/search|home|back|return|login|logout|help/i.test(title)) continue;

      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ title, url });
    }
  }
  return out;
}

async function scrapeIcimsAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);
    // Purely additive: waits for the iframe itself to exist before extracting,
    // on top of (never instead of) the fixed 2000ms wait above. Verified live
    // against Utah State's tenant that the iframe's own content can still be
    // mid-render at the 2000ms mark under slower/CI network conditions even
    // though the frame element itself already exists by then — this fixes
    // that race without slowing down tenants that were already fast.
    await page.waitForSelector('iframe', { timeout: 8000 }).catch(() => {});

    // Some iCIMS tenants (confirmed: Utah State) render the job list inside a
    // nested <iframe>, not the top-level document — querySelectorAll against
    // just `page` always saw 0 results for those, even though the real list
    // was one frame down the whole time. Scan the main frame AND every nested
    // iframe, merging results (deduped by url) rather than assuming one or
    // the other is where the content lives.
    const seenUrls = new Set();
    const jobs = [];
    const framesToScan = [page, ...page.frames().filter((f) => f !== page.mainFrame())];
    for (const frame of framesToScan) {
      let batch;
      try {
        batch = await safeEvaluate(frame, extractIcimsJobsInPage);
      } catch {
        continue; // a cross-origin or detached frame may refuse evaluation
      }
      for (const j of batch || []) {
        if (seenUrls.has(j.url)) continue;
        seenUrls.add(j.url);
        jobs.push(j);
      }
    }

    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length}`);

    return filtered.map((j) => ({
      title: clean(j.title),
      url: j.url,
      source: sourceName,
      category: "Faculty",
      college: campusName,
      location: null,
      description: null,
    }));
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} iCIMS scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// UCF careers site can intermittently present AWS/WAF human verification to browsers.
// Try DOM extraction first, then HTTP fallback; if blocked, return [] with explicit log.
async function scrapeUcfSearchAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  const extractFromHtml = (html, baseUrl) => {
    const out = [];
    const seen = new Set();
    const rx = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = rx.exec(String(html || "")))) {
      let href = m[1] || "";
      let title = String(m[2] || "").replace(/<[^>]+>/g, " ");
      title = clean(title);
      if (!href) continue;
      if (!/^https?:\/\//i.test(href)) {
        try {
          href = new URL(href, baseUrl).toString();
        } catch {
          continue;
        }
      }
      if (!/\/jobs\//i.test(href) || /\/jobs\/search/i.test(href)) continue;
      if (!title || title.length < 5) continue;
      if (/search|home|login|logout|privacy|accessibility/i.test(title)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      out.push({ title, url: href });
    }
    return out;
  };

  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // This is a client-rendered SPA (job cards hydrate after load) — poll for at
    // least one job link instead of a fixed sleep, so a slow render (e.g. under
    // full-scrape concurrency load) doesn't get read before it's populated.
    const hasJobLinks = () =>
      safeEvaluate(page, () => {
        for (const a of document.querySelectorAll('a[href]')) {
          const href = a.getAttribute("href") || "";
          if (/\/jobs\//i.test(href) && !/\/jobs\/search/i.test(href)) return true;
        }
        return false;
      }).catch(() => false);
    const start = Date.now();
    while (Date.now() - start < 15_000) {
      if (await hasJobLinks()) break;
      await page.waitForTimeout(500);
    }

    const blocked = await safeEvaluate(page, () => {
      const txt = (document.body?.innerText || "").toLowerCase();
      const title = (document.title || "").toLowerCase();
      return /human verification|captcha|awswaf|access denied/.test(txt) || /human verification|access denied/.test(title);
    }).catch(() => false);

    let items = [];
    if (!blocked) {
      items = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try { return new URL(href, location.href).toString(); } catch { return null; }
        };
        const out = [];
        const seen = new Set();
        for (const a of Array.from(document.querySelectorAll('a[href]'))) {
          const url = abs(a.getAttribute("href"));
          if (!url) continue;
          if (!/\/jobs\//i.test(url) || /\/jobs\/search/i.test(url)) continue;
          const title = clean(a.textContent);
          if (!title || title.length < 5) continue;
          if (/search|home|login|logout|privacy|accessibility/i.test(title)) continue;
          if (seen.has(url)) continue;
          seen.add(url);
          out.push({ title, url });
        }
        return out;
      }).catch(() => []);
    } else {
      console.warn(`⚠️  ${campusName} ${sourceName}: blocked by human verification in browser context`);
    }

    // HTTP fallback: sometimes this endpoint returns HTML without JS challenge to request client.
    if (!items.length) {
      try {
        const res = await context.request.get(startUrl, { timeout: 45_000 });
        if (res.ok()) {
          const html = await res.text();
          if (html && html.length > 1000 && !/human verification|awswaf|captcha/i.test(html)) {
            items = extractFromHtml(html, startUrl);
          }
        }
      } catch {}
    }

    const jobs = (items || [])
      .map((x) => ({
        title: clean(x.title),
        url: x.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      }))
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return uniqByUrl(jobs);
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// NYU Faculty scraper
async function scrapeNyuFaculty(context, startUrl) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(3000);

    const jobs = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };

      const out = [];
      const seen = new Set();

      // Look for job links on the page
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;

        // NYU job links typically go to interfolio or contain job-related paths
        const isJobLink =
          /interfolio\.com/i.test(url) ||
          (/careers/i.test(url) && /job|position/i.test(url));

        if (!isJobLink) continue;

        // Skip links back to the main NYU careers page itself
        if (/careers-at-nyu\/faculty/i.test(url) || /nyu\.edu.*faculty-and-researchers/i.test(url)) continue;

        const title = clean(a.textContent);
        if (!title || title.length < 5) continue;

        // Skip navigation and UI elements
        const navPatterns = /^(reset|skip|sidebar|menu|navigation|search|filter|clear|close|back|home|next|previous|submit|cancel|login|logout|sign in|sign out|view all|see all|show more|load more|expand|collapse)$/i;
        if (navPatterns.test(title)) continue;
        if (/click here|learn more|apply now|read more|skip to|skip sidebar|reset filters/i.test(title)) continue;

        // Skip very short titles that are likely UI elements
        if (title.length < 10) continue;

        if (seen.has(url)) continue;
        seen.add(url);

        out.push({ title, url });
      }

      return out;
    });

    const filtered = jobs.filter((j) => !omitAdjunct(j.title));
    console.log(`New York University NY listings scraped: ${filtered.length}`);

    return filtered.map((j) => ({
      title: j.title,
      url: j.url,
      source: "NY",
      category: "Faculty",
      college: "New York University",
      location: null,
      description: null,
    }));
  } catch (e) {
    console.error(`❌ New York University NY scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// Combined NY scraper (SUNY + CUNY + Private)
async function scrapeNyAll(context) {
  const [sunyJobs, cunyJobs, privateJobs] = await Promise.all([
    scrapeNySuny(context),
    scrapeCunyFaculty(context),
    scrapeNyPrivate(context),
  ]);
  return uniqByUrl([...sunyJobs, ...cunyJobs, ...privateJobs]);
}

// ASU facultypositions.asu.edu table scraper (includes Unit/Department in title)
async function scrapeAsuFacultyPositionsTable(context, campusName, startUrl) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();
    let url = startUrl;

    for (let safety = 0; safety < 80; safety++) {
      await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(800);

      const batch = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try { return new URL(href, location.href).toString(); } catch { return null; }
        };

        // Try to find the main results table
        const rows = Array.from(document.querySelectorAll("table tr"));
        const out = [];

        for (const r of rows) {
          const a = r.querySelector("a[href]");
          if (!a) continue;
          const href = abs(a.getAttribute("href"));
          if (!href) continue;

          // Title column usually contains Position / Department
          const t = clean(a.textContent);
          if (!t || t.length < 4) continue;

          const cells = Array.from(r.querySelectorAll("td"));
          // From the public page snippet: columns include "Position / Department" then "Unit"
          const unit = clean(cells[1]?.textContent || "");
          const title = unit && !t.toLowerCase().includes(unit.toLowerCase()) ? `${t} — ${unit}` : t;

          out.push({ title, url: href });
        }
        return out;
      });

      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        jobs.push({
          title: j.title,
          url: j.url,
          source: "AZ",
          category: "Faculty",
          college: campusName,
          location: null,
          description: null,
          department: cleanDepartmentField(inferAcademicFieldsFromTitle(j.title).department),
          specialization: cleanDepartmentField(inferAcademicFieldsFromTitle(j.title).specialization),
        });
      }
      // Pagination: navigate/click Next if available (ASU uses different patterns)
      const beforeFirstHref = await safeEvaluate(page, () => {
        const a = document.querySelector("table a[href]");
        return a ? (a.getAttribute("href") || "") : "";
      }).catch(() => "");

      // Try a "real" next URL first
      const nextLink = page.locator('a[rel="next"], a:has-text("Next"), a[aria-label*="Next" i]').first();
      const nextBtn = page.locator('button:has-text("Next"), button[aria-label*="Next" i], [role="button"][aria-label*="Next" i]').first();

      let moved = false;

      if ((await nextLink.count().catch(() => 0)) > 0 && (await nextLink.isVisible().catch(() => false))) {
        const href = await nextLink.getAttribute("href").catch(() => null);
        if (href && href.trim() && !/^javascript:/i.test(href)) {
          const nextUrl = new URL(href, page.url()).toString();
          if (nextUrl && nextUrl !== url) {
            url = nextUrl;
            moved = true;
            continue;
          }
        }

        // If href is missing/JS, click
        await nextLink.click({ timeout: 10_000 }).catch(() => {});
        moved = true;
      } else if ((await nextBtn.count().catch(() => 0)) > 0 && (await nextBtn.isVisible().catch(() => false))) {
        await nextBtn.click({ timeout: 10_000 }).catch(() => {});
        moved = true;
      }

      if (!moved) break;

      // Wait for table to change (best-effort)
      await page.waitForFunction(
        (prev) => {
          const a = document.querySelector("table a[href]");
          const cur = a ? (a.getAttribute("href") || "") : "";
          return cur && cur !== prev;
        },
        beforeFirstHref,
        { timeout: 12_000 }
      ).catch(() => {});

      // If URL changed (common), capture it; if not, stay on current DOM (do NOT re-goto)
      const newUrl = page.url();
      if (newUrl && newUrl !== url) url = newUrl;

      // Continue loop without reloading if we clicked a JS paginator
      // (We keep the current page state; next iteration will collect from DOM as-is.)
      continue;
    }

    console.log(`ASU facultypositions listings scraped: ${jobs.length}`);

    return uniqByUrl(jobs);
  } catch (e) {
    console.error(`❌ ${campusName} AZ scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// NAU careers.nau.edu search scraper (NOT Workday)
async function scrapeNauSearch(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();

    // paginate by ?page=N
    const base = new URL(startUrl);
    for (let pageNo = 1; pageNo <= 80; pageNo++) {
      base.searchParams.set("page", String(pageNo));
      const url = base.toString();

      await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(900);

      const batch = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const extractLocation = (card) => {
          if (!card) return null;
          // Try explicit labels first
          const labeled = Array.from(card.querySelectorAll("*"))
            .map((n) => clean(n.textContent))
            .filter(Boolean)
            .slice(0, 120);

          for (let i = 0; i < labeled.length; i++) {
            const t = labeled[i];
            if (/^location\b/i.test(t) && labeled[i + 1]) return labeled[i + 1];
            if (/^work location\b/i.test(t) && labeled[i + 1]) return labeled[i + 1];
          }

          // Fallback: regex in card text
          const txt = clean(card.innerText || "");
          const m =
            txt.match(/\b(?:Work\s+Location|Location)\s*:?\s*([^\n•|]{2,80})/i) ||
            txt.match(/\b([A-Za-z .'-]+,\s*[A-Z]{2})\b/);
          return m ? clean(m[1]) : null;
        };

        const extractDept = (card) => {
          if (!card) return null;
          const txt = clean(card.innerText || "");
          const m =
            txt.match(/\b(?:Department|College|School|Unit|Division)\s*:?\s*([^\n•|]{3,90})/i) ||
            txt.match(/\b(?:Program|Discipline)\s*:?\s*([^\n•|]{3,90})/i);
          return m ? clean(m[1]) : null;
        };

        const pickBestTitle = (card, url) => {
          if (!card) return null;

          // Prefer a heading if present
          const h = card.querySelector("h1,h2,h3");
          const ht = clean(h?.textContent);
          if (ht && ht.length >= 6 && !/read more/i.test(ht)) return ht;

          // Otherwise, prefer the anchor that points to the job URL (often the job title)
          const anchors = Array.from(card.querySelectorAll('a[href]'))
            .map((a) => ({
              href: abs(a.getAttribute("href")),
              text: clean(a.textContent),
            }))
            .filter((x) => x.href && x.text && x.text.length >= 6);

          // Tight match: exact job URL anchor
          const exact = anchors.find((x) => x.href === url);
          if (exact && !/read more/i.test(exact.text)) return exact.text;

          // Fallback: longest plausible title-like anchor text inside the card
          const plausible = anchors
            .filter((x) => !/apply|view job|read more|share/i.test(x.text))
            .filter((x) => !/\b(full time|part time|fixed\s*term)\b/i.test(x.text));

          plausible.sort((a, b) => b.text.length - a.text.length);
          return plausible[0]?.text || null;
        };

        const out = [];
        // Some sites (e.g. careers.msu.edu) have accordion-toggle <a> tags whose
        // "href" is actually a jQuery CSS selector (e.g.
        // ".job-component-details-<hash> .job-component-list-category .collapse")
        // instead of a real URL/fragment. `new URL(href, location.href)` happily
        // resolves that under /jobs/, so it passes the "looks like a job URL"
        // check and gets scraped as a second, bogus posting per real job —
        // roughly doubling the job count. Real job URLs never contain spaces.
        const jobAnchors = Array.from(document.querySelectorAll('a[href]'))
          .map((a) => a.getAttribute("href"))
          .filter((raw) => raw && !/\s/.test(raw) && !raw.trim().startsWith("."))
          .map((raw) => abs(raw))
          .filter((href) => href && /\/jobs\//i.test(href) && !/\/jobs\/search/i.test(href));

        // De-dupe URLs on the page first to avoid grabbing secondary anchors within the same card.
        const uniqUrls = Array.from(new Set(jobAnchors));

        for (const href of uniqUrls) {
          const a = Array.from(document.querySelectorAll('a[href]')).find((x) => abs(x.getAttribute('href')) === href);
          const card = a ? (a.closest("article,li,div") || null) : null;

          const title = pickBestTitle(card, href) || clean(a?.textContent);
          if (!title || title.length < 6) continue;

          out.push({ title, url: href, location: extractLocation(card), dept: extractDept(card) });
        }

        // de-dupe within page by url
        const seen = new Set();
        return out.filter((x) => (x.url && !seen.has(x.url) ? (seen.add(x.url), true) : false));
      });

      let addedThisPage = 0;
      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);
        jobs.push({
          title: j.title,
          url: j.url,
          source: sourceName,
          category: "Faculty",
          college: campusName,
          location: j.location || null,
          description: null,
          department: cleanDepartmentField(j.dept),
          specialization: cleanDepartmentField(j.dept),
        });
        addedThisPage++;
      }

      // stop if this page produced no new jobs
      if (addedThisPage === 0) break;
    }

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);

    return uniqByUrl(jobs);
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// Enrich "en-us" style job cards (NAU/EMU/MSU-style listings) by visiting job detail pages.
// Used to recover canonical titles (e.g., "Assistant Professor-Tenure System") and to append
// department/college when available.
async function enrichEnUsJobCardsFromDetails(
  context,
  jobs,
  {
    concurrency = 6,
    titleDeptSeparator = " — ",
    preferDeptKeys = ["department", "college", "organization", "unit", "school"],
  } = {}
) {
  const urls = jobs.map((j) => j?.url).filter(Boolean);
  const details = await fetchEnUsJobDetails(context, urls, concurrency);

  return jobs.map((j) => {
    const d = details.get(j.url);
    if (!d) return j;

    let title = d.title || j.title;
    const dept = cleanDepartmentField(d.dept || j.department || null);
    const location = d.location || j.location || null;
    const inferred = inferAcademicFieldsFromTitle(title);
    const finalDept = dept || cleanDepartmentField(inferred.department || inferred.specialization);

    if (dept && title && !title.toLowerCase().includes(dept.toLowerCase())) {
      title = `${title}${titleDeptSeparator}${dept}`;
    }

    // Keep the campus name in `college`, but use dept/college info only for title enrichment.
    return {
      ...j,
      title,
      location,
      department: finalDept || null,
      specialization: cleanDepartmentField(j.specialization) || finalDept || null,
    };
  });
}

async function fetchEnUsJobDetails(context, urls, concurrency = 6) {
  const out = new Map();
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const url = urls[idx++];
      const page = await context.newPage();
      try {
        await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(600);

        const details = await safeEvaluate(page, () => {
          const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

          const fromMeta = (sel, attr) => clean(document.querySelector(sel)?.getAttribute(attr));
          const fromText = (sel) => clean(document.querySelector(sel)?.textContent);

          const getFromDtDd = (wantedKeys) => {
            const dts = Array.from(document.querySelectorAll("dt"));
            for (const dt of dts) {
              const k = clean(dt.textContent).toLowerCase();
              if (!wantedKeys.some((w) => k.includes(w))) continue;
              const dd = dt.nextElementSibling;
              const v = clean(dd?.textContent);
              if (v) return v;
            }
            return null;
          };

          // Canonical title often appears in h1 / og:title / JSON-LD
          let title =
            fromText("h1") ||
            fromMeta("meta[property='og:title']", "content") ||
            fromMeta("meta[name='twitter:title']", "content") ||
            null;

          // Try JSON-LD JobPosting title
          if (!title) {
            const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            for (const s of scripts) {
              try {
                const j = JSON.parse(s.textContent);
                const nodes = Array.isArray(j) ? j : j?.["@graph"] ? j["@graph"] : [j];
                for (const n of nodes) {
                  const t = n?.["@type"];
                  const isJob = t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
                  if (isJob && typeof n.title === "string") {
                    title = clean(n.title);
                    break;
                  }
                }
              } catch {}
              if (title) break;
            }
          }

          const location =
            getFromDtDd(["work location", "location", "city"]) ||
            clean(
              document
                .querySelector('[data-automation-id="locations"], [data-automation-id="jobPostingLocation"]')
                ?.textContent
            ) ||
            null;

          // Department/College/Org labels vary; collect the best available
          // First try dt/dd structure
          let dept =
            getFromDtDd(["college"]) ||
            getFromDtDd(["department"]) ||
            getFromDtDd(["organization"]) ||
            getFromDtDd(["unit"]) ||
            getFromDtDd(["school"]) ||
            getFromDtDd(["agency"]) ||
            null;

          // Try labeled row patterns (MSU-style: label in one element, value in sibling/nearby)
          if (!dept) {
            const labelPatterns = [
              { label: /college/i, selector: '.job-details, .job-info, .posting-details, [class*="detail"], [class*="info"]' },
              { label: /department/i, selector: '.job-details, .job-info, .posting-details, [class*="detail"], [class*="info"]' },
            ];
            for (const { label, selector } of labelPatterns) {
              const containers = Array.from(document.querySelectorAll(selector));
              for (const c of containers) {
                const text = c.innerText || "";
                const match = text.match(new RegExp(`(?:${label.source})\\s*[:\\-]?\\s*([A-Za-z][A-Za-z0-9 &,\\-']{2,60})`, "i"));
                if (match && match[1]) {
                  dept = clean(match[1]);
                  break;
                }
              }
              if (dept) break;
            }
          }

          // Try JSON-LD hiringOrganization.department
          if (!dept) {
            const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            for (const s of scripts) {
              try {
                const j = JSON.parse(s.textContent);
                const nodes = Array.isArray(j) ? j : j?.["@graph"] ? j["@graph"] : [j];
                for (const n of nodes) {
                  const t = n?.["@type"];
                  const isJob = t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
                  if (isJob) {
                    const ho = n.hiringOrganization;
                    if (ho?.department?.name) { dept = clean(ho.department.name); break; }
                    if (typeof ho?.department === "string") { dept = clean(ho.department); break; }
                    // Some sites put dept in employmentUnit or similar
                    if (n.employmentUnit?.name) { dept = clean(n.employmentUnit.name); break; }
                  }
                }
              } catch {}
              if (dept) break;
            }
          }

          // Last resort: look for common row patterns in page text
          if (!dept) {
            const bodyText = document.body?.innerText || "";
            const deptMatch = bodyText.match(/(?:College|Department|School)\s*[:\-]\s*([A-Z][A-Za-z0-9 &,\-']{3,50}?)(?:\n|$|Work Location|Location|Position|Category)/);
            if (deptMatch && deptMatch[1]) {
              dept = clean(deptMatch[1]);
            }
          }

          return {
            title: title ? clean(title) : null,
            dept: dept ? clean(dept) : null,
            location: location ? clean(location) : null,
          };
        }).catch(() => null);

        if (details && (details.title || details.dept || details.location)) {
          out.set(url, details);
        }
      } catch {
        // ignore per-job failures
      } finally {
        await page.close().catch(() => {});
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return out;
}

// University of Michigan (careers.umich.edu) search scraper
// - Appends Department/Organization to title when available
// - Captures campus/location when present in listing cards
async function scrapeUmichCareers(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();

    const base = new URL(startUrl);
    // careers.umich.edu uses 0-indexed pages in the querystring
    for (let pageNo = 0; pageNo <= 80; pageNo++) {
      base.searchParams.set("page", String(pageNo));
      const url = base.toString();

      // A single deep-pagination page occasionally fails at the network
      // layer (careers.umich.edu has thrown ERR_HTTP2_PROTOCOL_ERROR on
      // specific pages). That used to propagate to the outer try/catch and
      // discard every job already collected from earlier pages, making the
      // whole scrape intermittently return 0 jobs. Instead, stop paginating
      // but keep what's been gathered so far.
      let batch;
      try {
        await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(900);

        batch = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const pickField = (txt, keys) => {
          const t = clean(txt || "");
          for (const k of keys) {
            // More restrictive regex: stop at common delimiters and limit to 80 chars
            const re = new RegExp(`\\b${k}\\b\\s*:?\\s*([^\\n•|—–\\-]{3,80})`, "i");
            const m = t.match(re);
            if (m && m[1]) {
              const val = clean(m[1]);
              // Skip if it looks like a list (repeated keywords, too many words, or garbage patterns)
              if (/Nursing-\s*\w+\s+Nursing-/i.test(val)) continue;
              if ((val.match(/\s/g) || []).length > 12) continue; // Too many words
              if (/All Work Locations|Work Location/i.test(val)) continue;
              if (/Graduate Nurse|Home Care|Telemetry|Medical Surgical/i.test(val)) continue;
              return val;
            }
          }
          return null;
        };

        const extractFromCard = (card) => {
          if (!card) return { dept: null, loc: null };
          const txt = clean(card.innerText || "");
          const dept = pickField(txt, ["Department", "Organization", "Unit", "Division", "School", "College"]);
          const loc =
            pickField(txt, ["Work Location", "Location", "Campus"]) ||
            (txt.match(/\b([A-Za-z .'-]+,\s*[A-Z]{2})\b/) ? clean(txt.match(/\b([A-Za-z .'-]+,\s*[A-Z]{2})\b/)[1]) : null);
          return { dept, loc };
        };

        const isJobUrl = (u) => {
          if (!u) return false;
          try {
            const x = new URL(u);
            const p = x.pathname || "";
            return (
              /job_detail|job-detail|job\b|jobs\b/i.test(p) ||
              x.searchParams.has("job_id") ||
              x.searchParams.has("position")
            );
          } catch {
            return false;
          }
        };

        const out = [];

        // Prefer anchors inside common listing containers
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const a of anchors) {
          const href = abs(a.getAttribute("href"));
          if (!href || !isJobUrl(href)) continue;

          const card = a.closest("article,.views-row,li,div") || a.parentElement;

          let title = clean(a.textContent);
          if (!title || title.length < 4 || /view|apply|learn more/i.test(title)) {
            const h = card?.querySelector?.("h1,h2,h3,h4,.title,.job-title,strong");
            const ht = clean(h?.textContent);
            if (ht && ht.length >= 4) title = ht;
          }
          if (!title || title.length < 4) continue;

          const { dept, loc } = extractFromCard(card);
          out.push({ title, url: href, dept, location: loc });
        }

        // De-dupe within page by url
        const seen = new Set();
        return out.filter((x) => (x.url && !seen.has(x.url) ? (seen.add(x.url), true) : false));
        });
      } catch (e) {
        console.error(
          `❌ ${campusName} ${sourceName} page ${pageNo} failed, stopping pagination and keeping ${jobs.length} job(s) already collected:`,
          e?.message || e
        );
        break;
      }

      let added = 0;
      for (const j of batch) {
        if (!j?.url || seen.has(j.url)) continue;
        seen.add(j.url);

        let title = clean(j.title);
        const dept = clean(j.dept || "");
        // Only append dept if it looks like a real department name (not garbage)
        const isValidDept = dept &&
          dept.length >= 3 &&
          dept.length <= 80 &&
          !/Nursing-\s*\w+/i.test(dept) &&
          !/All Work Locations|Graduate Nurse|Home Care|Telemetry/i.test(dept) &&
          !title.toLowerCase().includes(dept.toLowerCase());
        if (isValidDept) {
          title = `${title} — ${dept}`;
        }

        // Clean up location - skip garbage location values
        let location = j.location ? clean(j.location) : null;
        if (location && (location.length > 100 || /All Work Locations/i.test(location))) {
          location = null;
        }

        jobs.push({
          title,
          url: j.url,
          source: sourceName,
          category: "Faculty",
          college: campusName,
          location,
          description: null,
        });
        added++;
      }

      // Stop when a page yields nothing new (best-effort)
      if (added === 0 && pageNo > 0) break;
    }

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}



async function scrapeOrAll(context) {
  const tasks = OR_CAMPUSES.map(({ campus, type, url }) =>
    (async () => {
      try {
        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await page.waitForTimeout(900);
            return await scrapeEnUsFilterSite(page, {
              source: "OR",
              campus,
              category: "Faculty",
            });
          } finally {
            await page.close().catch(() => {});
          }
        }
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "OR");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "OR");
        if (type === "peopleadmin-dept") return await scrapePeopleAdminWithDept(context, url, campus, "OR");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "OR");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} OR scrape failed:`, e?.message || e);
        return [];
      }
    })()
  );

  const settled = await Promise.allSettled(tasks);
  return uniqByUrl(
    settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
  );
}



async function scrapeWaAll(context) {
  const tasks = WA_CAMPUSES.map(({ campus, type, url }) =>
    (async () => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "WA");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "WA");
        if (type === "uw") return await scrapeUwAcademicJobs(context, url, campus, "WA");
        if (type === "wwu") return await scrapeWwuFacultyPage(context, url, campus, "WA");
        if (type === "static") return await scrapeStaticLinksAs(context, url, campus, "WA");
        if (type === "peoplesoft") return await scrapePeopleSoftAs(context, url, campus, "WA");
        if (type === "peoplesoft-hrs") return await scrapePeopleSoftHrsBasic(context, url, campus, "WA");
        if (type === "interfolio-links") return await scrapeInterfolioLinksFromPageAs(url, campus, "WA");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "WA");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "WA");
        // No existing WA dispatch case for "interviewexchange" (function
        // scrapeInterviewExchangeAs already exists and is dispatched by many
        // other states) -- added for City University of Seattle.
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "WA");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "WA");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} WA scrape failed:`, e?.message || e);
        return [];
      }
    })()
  );

  const settled = await Promise.allSettled(tasks);
  return uniqByUrl(
    settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
  );
}






/* ============================== ME ============================== */

async function scrapeMeAll(context) {
  const results = await mapWithConcurrency(
    ME_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "oracle-cx") return await scrapeOracleCxAs(context, url, campus, "ME");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "ME");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "ME");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "ME");
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "ME");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "ME");
        if (type === "paycom") return await scrapePaycomAs(context, url, campus, "ME");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} ME scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  // Keep broader ME set here; global faculty filter will finalize faculty-only output.
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

/* ============================== VT ============================== */

async function scrapeVtAll(context) {
  const results = await mapWithConcurrency(
    VT_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "VT");
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "VT");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "VT");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "VT");
        if (type === "oracle-cx") return await scrapeOracleCxAs(context, url, campus, "VT");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} VT scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

/* ============================== MN ============================== */

async function scrapeMnAll(context) {
  const results = await mapWithConcurrency(
    MN_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "umn") return await scrapePeopleSoftHrsBasic(context, url, campus, "MN");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "MN");
        if (type === "icims") return await scrapeIcimsAs(context, url, campus, "MN");
        if (type === "static") return await scrapeStaticLinksAs(context, url, campus, "MN");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "MN");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} MN scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results
    .flatMap((x) => (Array.isArray(x) ? x : []))
    .map(splitMinnStateSystemCollege);
  return uniqByUrl(jobs).filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
}

/* ============================== ND ============================== */

async function scrapeNdAll(context) {
  const results = await mapWithConcurrency(
    ND_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "ND");
        if (type === "ndsu-joblist") return await scrapeNdsuJoblistAs(url, campus, "ND");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "ND");
        if (type === "workday-search") return await scrapeWorkdaySearchApiAs(url, campus, "ND");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "ND");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} ND scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

/* ============================== SD ============================== */

async function scrapeSdAll(context) {
  const results = await mapWithConcurrency(
    SD_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "SD");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "SD");
        if (type === "workday-search") return await scrapeWorkdaySearchApiAs(url, campus, "SD");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "SD");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} SD scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

/* ============================== NE ============================== */

async function scrapeNeAll(context) {
  const results = await mapWithConcurrency(
    NE_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "NE");
        if (type === "oracle-cx") return await scrapeOracleCxAs(context, url, campus, "NE");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "NE");
        if (type === "workday-search") return await scrapeWorkdaySearchApiAs(url, campus, "NE");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "NE");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} NE scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

/* ============================== IA ============================== */

async function scrapeIaAll(context) {
  const results = await mapWithConcurrency(
    IA_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "IA");
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "IA");
        if (type === "nau-search") return await scrapeNauSearch(context, url, campus, "IA");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "IA");
        if (type === "workday-search") return await scrapeWorkdaySearchApiAs(url, campus, "IA");
        if (type === "adp-career-center") return await scrapeAdpCareerCenterAs(context, url, campus, "IA");
        if (type === "adp") return await scrapeAdpAs(context, url, campus, "IA");
        if (type === "oracle-cx") return await scrapeOracleCxAs(context, url, campus, "IA");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "IA");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} IA scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

/* ============================== WY ============================== */

async function scrapeWyAll(context) {
  const results = await mapWithConcurrency(
    WY_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "WY");
        if (type === "oracle-cx") return await scrapeOracleCxAs(context, url, campus, "WY");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "WY");
        if (type === "workday-search") return await scrapeWorkdaySearchApiAs(url, campus, "WY");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "WY");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "WY");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} WY scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

function splitMinnStateSystemCollege(job) {
  if (!job || job.college !== "Minnesota State System") return job;

  const cityMap = {
    "bemidji": "Bemidji State University",
    "mankato": "Minnesota State University, Mankato",
    "st cloud": "St. Cloud State University",
    "saint cloud": "St. Cloud State University",
    "marshall": "Southwest Minnesota State University",
    "moorhead": "Minnesota State University Moorhead",
    "winona": "Winona State University",
    "duluth": "Lake Superior College",
    "rochester": "Rochester Community and Technical College",
    "minneapolis": "Minneapolis College",
    "st paul": "Saint Paul College",
    "saint paul": "Saint Paul College",
    "north mankato": "South Central College",
    "white bear lake": "Century College",
    "henn eden prairie campus": "Hennepin Technical College",
    "eden prairie": "Hennepin Technical College",
  };

  const normalizeCityKey = (s) => clean(String(s || "").toLowerCase())
    .replace(/\bmn\b/g, "")
    .replace(/\./g, " ")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const locationCity = clean(String(job.location || "").split(",")[0]);
  let key = normalizeCityKey(locationCity);

  if (!key) {
    const m = String(job.url || "").match(/\/job\/([^/]+)\//i);
    if (m?.[1]) {
      try {
        key = normalizeCityKey(decodeURIComponent(m[1]));
      } catch {
        key = normalizeCityKey(m[1]);
      }
    }
  }

  const mappedCollege = cityMap[key] || (key ? `Minnesota State (${titleCaseWords(key)})` : "Minnesota State System");
  return { ...job, college: mappedCollege };
}

// Generic Oracle/PeopleSoft HRS "Explore Jobs" portal (used by University of
// Minnesota's MyU and UT System schools sharing utshare.utsystem.edu) with no
// JOB_FAMILY_LABEL field — filters by title regex instead. See
// scrapeUmsystemHrsJobs for the variant that does expose job family/business
// unit fields (University of Missouri System).
async function scrapePeopleSoftHrsBasic(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);

    // Some of these portals (e.g. UT System's HRS_APP_SCHJOB, without the "_FL"
    // suffix UMN's URL uses) land on a blank "Search Jobs" shell and need an
    // explicit "View All Jobs" postback click before any rows exist.
    await safeEvaluate(page, () => {
      const link = document.querySelector('a[href*="NAV_PB"]');
      if (link) link.click();
    }).catch(() => {});
    await page.waitForTimeout(1500);

    // UMN's PeopleSoft results list has no <a href> job links at all — titles
    // render as plain <span id="SCH_JOB_TITLE$N"> with sibling fields addressed
    // by the same index N (HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$N, LOCATION$N).
    // The old link-pattern scraper could never match anything here. 50 results
    // load at a time; a "div.ps_box-more" postback trigger (labeled just "more",
    // not "show/load more") appends the next 50 in place. Playwright's locator
    // click() reports this element as not "visible" (a PeopleSoft layout quirk)
    // and refuses to click it, so dispatch the click directly in-page instead.
    // Click until the div disappears or a safety cap is hit (the UI itself caps
    // display at 300 of 736+ total jobs at last check).
    for (let i = 0; i < 20; i++) {
      const clicked = await safeEvaluate(page, () => {
        const btn = document.querySelector("div.ps_box-more");
        if (!btn) return false;
        btn.click();
        return true;
      }).catch(() => false);
      if (!clicked) break;
      await page.waitForTimeout(1200);
    }

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const out = [];
      const seen = new Set();

      for (const titleEl of Array.from(document.querySelectorAll('span[id^="SCH_JOB_TITLE$"]'))) {
        const title = clean(titleEl.textContent);
        if (!title || title.length < 4) continue;
        const m = (titleEl.id || "").match(/\$(\d+)$/);
        const idx = m ? m[1] : null;
        const jobIdEl = idx !== null ? document.getElementById(`HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$${idx}`) : null;
        const locationEl = idx !== null ? document.getElementById(`LOCATION$${idx}`) : null;
        const jobId = clean(jobIdEl?.textContent || "");
        const location = clean(locationEl?.textContent || "");

        const dedupe = `${jobId || title}|${title}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({ title, jobId, location });
      }
      return out;
    });

    const jobs = (items || [])
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title))
      .map((j) => ({
        title: clean(j.title),
        url: `${startUrl}#${encodeURIComponent(j.jobId || j.title)}`,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: j.location || null,
        description: null,
      }));

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// University of Missouri System campuses (same PeopleSoft HRS product as UMN,
// under erecruit.umsystem.edu, one job board per campus keyed by a "SiteId").
// Unlike UMN, this instance exposes a JOB_FAMILY_LABEL field directly (e.g.
// "Teaching & Research Faculty"), so filter on that instead of title regexes
// — far more precise, and it happens to catch clinical/physician-faculty
// titles that don't contain "professor/lecturer/instructor".
async function scrapeUmsystemHrsJobs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);

    for (let i = 0; i < 20; i++) {
      const clicked = await safeEvaluate(page, () => {
        const btn = document.querySelector("div.ps_box-more");
        if (!btn) return false;
        btn.click();
        return true;
      }).catch(() => false);
      if (!clicked) break;
      await page.waitForTimeout(1200);
    }

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const out = [];
      const seen = new Set();

      for (const titleEl of Array.from(document.querySelectorAll('span[id^="SCH_JOB_TITLE$"]'))) {
        const title = clean(titleEl.textContent);
        if (!title || title.length < 4) continue;
        const m = (titleEl.id || "").match(/\$(\d+)$/);
        const idx = m ? m[1] : null;
        const jobIdEl = idx !== null ? document.getElementById(`HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$${idx}`) : null;
        const locationEl = idx !== null ? document.getElementById(`LOCATION$${idx}`) : null;
        const familyEl = idx !== null ? document.getElementById(`JOB_FAMILY_LABEL$${idx}`) : null;
        const jobId = clean(jobIdEl?.textContent || "");
        const location = clean(locationEl?.textContent || "");
        const jobFamily = clean(familyEl?.textContent || "");

        const dedupe = `${jobId || title}|${title}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({ title, jobId, location, jobFamily });
      }
      return out;
    });

    const jobs = (items || [])
      .filter((j) => /faculty/i.test(j.jobFamily) || looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title))
      .map((j) => ({
        title: clean(j.title),
        url: `${startUrl}#${encodeURIComponent(j.jobId || j.title)}`,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: j.location || null,
        description: null,
      }));

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

/* ============================== WI ============================== */

async function scrapeWiAll(context) {
  const results = await mapWithConcurrency(
    WI_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "WI");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "WI");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "WI");
        if (type === "icims") return await scrapeIcimsAs(context, url, campus, "WI");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "WI");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} WI scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
}

/* ============================== MT ============================== */

async function scrapeMtAll(context) {
  const results = await mapWithConcurrency(
    MT_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "MT");
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "MT");
        // No existing MT dispatch case for "paycom" (function scrapePaycomAs
        // already exists and is dispatched by MA/ME/NY/TX/MS/KS) -- added
        // for Flathead Valley Community College.
        if (type === "paycom") return await scrapePaycomAs(context, url, campus, "MT");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "MT");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} MT scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
}

/* ============================== CO ============================== */

async function scrapeCoAll(context) {
  const results = await mapWithConcurrency(
    CO_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "CO");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "CO");
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "CO");
        if (type === "cu-boulder") return await scrapeCuBoulder(context, url, campus, "CO");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "CO");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "CO");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "CO");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} CO scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
}

/* ============================== OH ============================== */

async function scrapeOhAll(context) {
  const results = await mapWithConcurrency(
    OH_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "OH");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "OH");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "OH");
        if (type === "adp") return await scrapeAdpAs(context, url, campus, "OH");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "OH");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "OH");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} OH scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
}

/* ============================== NM ============================== */

async function scrapeNmAll(context) {
  const results = await mapWithConcurrency(
    NM_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "csod") return await scrapeCsodAs(context, url, campus, "NM");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "NM");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "NM");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "NM");
        if (type === "sjc-sf") return await scrapeSjcSantaFeJobs(context, url, campus, "NM");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "NM");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} NM scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
}

/* ============================== NV ============================== */

async function scrapeNvAll(context) {
  const results = await mapWithConcurrency(
    NV_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "NV");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "NV");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "NV");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} NV scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
}

/* ============================== UT ============================== */

async function scrapeUtAll(context) {
  const results = await mapWithConcurrency(
    UT_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "UT");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "UT");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "UT");
        if (type === "icims") return await scrapeIcimsAs(context, url, campus, "UT");
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "UT");
        if (type === "csod") return await scrapeCsodAs(context, url, campus, "UT");
        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await page.waitForTimeout(900);
            return await scrapeEnUsFilterSite(page, { source: "UT", campus, category: "Faculty" });
          } finally {
            await page.close().catch(() => {});
          }
        }
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "UT");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} UT scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  // Don't filter by looksFacultyish here - PeopleAdmin URLs already filter for faculty positions
  // and job titles may not contain explicit faculty keywords
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

async function scrapeIdAll(context) {
  const results = await mapWithConcurrency(
    ID_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "ID");
        if (type === "csod") return await scrapeCsodAs(context, url, campus, "ID");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "ID");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "ID");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "ID");
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "ID");
        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await gotoWithRetry(page, url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await page.waitForTimeout(900);
            return await scrapeEnUsFilterSite(page, { source: "ID", campus, category: "Faculty" });
          } finally {
            await page.close().catch(() => {});
          }
        }
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "ID");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} ID scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

async function scrapeInAll(context) {
  const results = await mapWithConcurrency(
    IN_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "IN");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "IN");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "IN");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "IN");
        if (type === "adp-career-center") return await scrapeAdpCareerCenterAs(context, url, campus, "IN");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} IN scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

async function scrapeAdpCareerCenterAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(9000);

    const rows = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const raw = String(document.body?.innerText || "");
      if (!raw) return [];

      const start = raw.search(/Current Openings/i);
      const end = raw.search(/Stay connected with us/i);
      const section = raw.slice(start >= 0 ? start : 0, end > start ? end : raw.length);
      const lines = section
        .split(/\r?\n/)
        .map((s) => clean(s))
        .filter(Boolean);

      const out = [];
      for (const line of lines) {
        if (/^Current Openings/i.test(line)) continue;
        if (/^Search$/i.test(line)) continue;
        if (/^Select (Location|Job Type)/i.test(line)) continue;
        if (/^(Clear All|Location|Job Type)$/i.test(line)) continue;
        if (/^\d+\+?\s+days?\s+ago/i.test(line) || /^today$/i.test(line)) continue;
        if (/^(Full Time|Part Time)$/i.test(line)) continue;
        if (/,\s*[A-Z]{2},\s*US$/i.test(line)) continue;

        let title = line;
        const m = line.match(/^(.+?)\s+[A-Za-z .'-]+,\s*[A-Z]{2},\s*US\b/i);
        if (m?.[1]) title = clean(m[1]);
        if (!title || title.length < 6 || title.length > 160) continue;
        out.push({ title, location: null });
      }

      return out;
    });

    const seen = new Set();
    const out = [];
    for (const r of rows || []) {
      const title = clean(r?.title);
      if (!title || !looksFacultyish(title) || omitAdjunct(title)) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        title,
        url: `${startUrl}#${encodeURIComponent(title)}`,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: clean(r?.location) || null,
        description: null,
      });
    }

    console.log(`${campusName} ${sourceName} listings scraped: ${out.length}`);
    return out;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeNdsuJoblistAs(startUrl, campusName, sourceName) {
  try {
    const res = await fetch(startUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const cleanText = (s) => clean(String(s || "").replace(/<[^>]+>/g, " "));
    const out = [];
    const seen = new Set();

    const linkRe = /<a[^>]+href=\"([^\"]*JobOpeningId=\d+[^\"]*)\"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const hrefRaw = m[1] || "";
      let title = cleanText(m[2] || "");
      if (!title || /^view details$/i.test(title)) continue;

      let url = null;
      try {
        const decoded = hrefRaw.replace(/&amp;/g, "&");
        url = new URL(decoded, startUrl).toString();
      } catch {
        continue;
      }

      title = normalizeJobTitle(title);
      if (!title || !looksFacultyish(title) || omitAdjunct(title)) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      out.push({
        title,
        url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      });
    }

    console.log(`${campusName} ${sourceName} listings scraped: ${out.length}`);
    return out;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  }
}

async function scrapeWvAll(context) {
  const results = await mapWithConcurrency(
    WV_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "WV");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "WV");
        if (type === "wvsu-faculty-pdf") return await scrapeWvsuFacultyPdfAs(url, campus, "WV");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "WV");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} WV scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

async function scrapeGaAll(context) {
  const results = await mapWithConcurrency(
    GA_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "GA");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "GA");
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "GA");
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "GA");
        if (type === "nau-search") return await scrapeNauSearch(context, url, campus, "GA");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "GA");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} GA scrape failed:`, e?.message || e);
        return [];
      }
    }
  );
  return uniqByUrl(results.flatMap((x) => (Array.isArray(x) ? x : []))).filter((j) => !omitAdjunct(j.title));
}

async function scrapeAlAll(context) {
  const results = await mapWithConcurrency(
    AL_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "AL");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "AL");
        if (type === "nau-search") return await scrapeNauSearch(context, url, campus, "AL");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "AL");
        if (type === "icims") return await scrapeIcimsAs(context, url, campus, "AL");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "AL");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} AL scrape failed:`, e?.message || e);
        return [];
      }
    }
  );
  return uniqByUrl(results.flatMap((x) => (Array.isArray(x) ? x : []))).filter((j) => !omitAdjunct(j.title));
}

async function scrapeMsAll(context) {
  const results = await mapWithConcurrency(
    MS_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "MS");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "MS");
        // No existing MS dispatch case for "paycom" (function scrapePaycomAs
        // already exists and is dispatched by MA/ME/NY/TX) -- added for
        // Copiah-Lincoln Community College.
        if (type === "paycom") return await scrapePaycomAs(context, url, campus, "MS");
        // No existing MS dispatch case for "schooljobs" (function
        // scrapeSchoolJobsAs already exists) -- added for East Mississippi
        // Community College (governmentjobs.com is the same NEOGOV platform).
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "MS");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "MS");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} MS scrape failed:`, e?.message || e);
        return [];
      }
    }
  );
  return uniqByUrl(results.flatMap((x) => (Array.isArray(x) ? x : []))).filter((j) => !omitAdjunct(j.title));
}

async function scrapeLaAll(context) {
  const results = await mapWithConcurrency(
    LA_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "LA");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "LA");
        if (type === "adp") return await scrapeAdpAs(context, url, campus, "LA");
        // No existing LA dispatch case for "oracle-cx" (function scrapeOracleCxAs
        // already exists and is dispatched by TX) -- added for Franciscan
        // Missionaries of Our Lady University.
        if (type === "oracle-cx") return await scrapeOracleCxAs(context, url, campus, "LA");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "LA");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} LA scrape failed:`, e?.message || e);
        return [];
      }
    }
  );
  return uniqByUrl(results.flatMap((x) => (Array.isArray(x) ? x : []))).filter((j) => !omitAdjunct(j.title));
}

async function scrapeArAll(context) {
  const results = await mapWithConcurrency(
    AR_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "AR");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "AR");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "AR");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "AR");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} AR scrape failed:`, e?.message || e);
        return [];
      }
    }
  );
  return uniqByUrl(results.flatMap((x) => (Array.isArray(x) ? x : []))).filter((j) => !omitAdjunct(j.title));
}

async function scrapeKsAll(context) {
  const results = await mapWithConcurrency(
    KS_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "KS");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "KS");
        if (type === "nau-search") return await scrapeNauSearch(context, url, campus, "KS");
        // No existing KS dispatch case for "paycom" (function scrapePaycomAs
        // already exists and is dispatched by MA/ME/NY/TX/MS) -- added for
        // Cowley County Community College.
        if (type === "paycom") return await scrapePaycomAs(context, url, campus, "KS");
        // No existing KS dispatch case for "adp" (function scrapeAdpAs
        // already exists and is dispatched by several other states) --
        // added for Dodge City Community College.
        if (type === "adp") return await scrapeAdpAs(context, url, campus, "KS");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "KS");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} KS scrape failed:`, e?.message || e);
        return [];
      }
    }
  );
  return uniqByUrl(results.flatMap((x) => (Array.isArray(x) ? x : []))).filter((j) => !omitAdjunct(j.title));
}

async function scrapeOkAll(context) {
  const results = await mapWithConcurrency(
    OK_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "OK");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "OK");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "OK");
        if (type === "interfolio") return await scrapeInterfolioPositionsAs(context, url, campus, "OK");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} OK scrape failed:`, e?.message || e);
        return [];
      }
    }
  );
  return uniqByUrl(results.flatMap((x) => (Array.isArray(x) ? x : []))).filter((j) => !omitAdjunct(j.title));
}

async function scrapeMoAll(context) {
  const results = await mapWithConcurrency(
    MO_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "MO");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "MO");
        if (type === "adp") return await scrapeAdpAs(context, url, campus, "MO");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "MO");
        if (type === "umsystem-hrs") return await scrapeUmsystemHrsJobs(context, url, campus, "MO");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} MO scrape failed:`, e?.message || e);
        return [];
      }
    }
  );
  return uniqByUrl(results.flatMap((x) => (Array.isArray(x) ? x : []))).filter((j) => !omitAdjunct(j.title));
}

async function scrapeKyAll(context) {
  const results = await mapWithConcurrency(
    KY_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "KY");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "KY");
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "KY");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "KY");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "KY");
        // No existing KY dispatch case for "adp" (function scrapeAdpAs already
        // exists and is dispatched by other states) -- added for Frontier
        // Nursing University.
        if (type === "adp") return await scrapeAdpAs(context, url, campus, "KY");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "KY");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} KY scrape failed:`, e?.message || e);
        return [];
      }
    }
  );
  return uniqByUrl(results.flatMap((x) => (Array.isArray(x) ? x : []))).filter((j) => !omitAdjunct(j.title));
}

async function scrapeTnAll(context) {
  const results = await mapWithConcurrency(
    TN_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "TN");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "TN");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "TN");
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "TN");
        if (type === "paycom") return await scrapePaycomAs(context, url, campus, "TN");
        if (type === "adp") return await scrapeAdpAs(context, url, campus, "TN");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "TN");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} TN scrape failed:`, e?.message || e);
        return [];
      }
    }
  );
  return uniqByUrl(results.flatMap((x) => (Array.isArray(x) ? x : []))).filter((j) => !omitAdjunct(j.title));
}

async function scrapeAkAll(context) {
  const results = await mapWithConcurrency(
    AK_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "AK");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} AK scrape failed:`, e?.message || e);
        return [];
      }
    }
  );
  return uniqByUrl(results.flatMap((x) => (Array.isArray(x) ? x : []))).filter((j) => !omitAdjunct(j.title));
}

async function scrapeHiAll(context) {
  const results = await mapWithConcurrency(
    HI_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "HI");
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "HI");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} HI scrape failed:`, e?.message || e);
        return [];
      }
    }
  );
  return uniqByUrl(results.flatMap((x) => (Array.isArray(x) ? x : []))).filter((j) => !omitAdjunct(j.title));
}

async function scrapeFloridaSouthernPortal(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);

    const searchBtn = page.locator("#pg0_V_psSearch_gbtnSearch").first();
    if ((await searchBtn.count().catch(() => 0)) > 0) {
      await searchBtn.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const out = [];
      const seen = new Set();

      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/^javascript:__doPostBack\('([^']+)'/i);
        if (!m || !m[1]) continue;
        const title = clean(a.textContent);
        if (!title || title.length < 4) continue;
        if (/^positions?$|^employment app$/i.test(title)) continue;
        const key = `${m[1]}|${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ title, target: m[1] });
      }
      return out;
    });

    const jobs = (items || [])
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title))
      .map((j) => ({
        title: clean(j.title),
        url: `${startUrl}#${encodeURIComponent(j.target || j.title)}`,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      }));

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeFsuPeopleSoftJobs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1800);

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const out = [];
      const seen = new Set();

      // FSU PeopleSoft renders job rows as indexed fields like SCH_JOB_TITLE$0.
      for (const titleEl of Array.from(document.querySelectorAll('span[id^="SCH_JOB_TITLE$"]'))) {
        const title = clean(titleEl.textContent);
        if (!title || title.length < 4) continue;
        const m = (titleEl.id || "").match(/\$(\d+)$/);
        const idx = m ? m[1] : null;
        const jobIdEl = idx !== null ? document.getElementById(`HRS_SCH_WRK_HRS_JOB_OPENING_ID$${idx}`) : null;
        const locationEl = idx !== null ? document.getElementById(`HRS_RECR_LOC_TBL_DESCR$${idx}`) : null;
        const jobId = clean(jobIdEl?.textContent || "");
        const location = clean(locationEl?.textContent || "");

        const key = idx !== null ? `SCH_JOB_TITLE$${idx}` : title;
        const dedupe = `${jobId || key}|${title}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({ title, key, jobId, location });
      }
      return out;
    });

    const jobs = (items || [])
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title))
      .map((j) => ({
        title: clean(j.title),
        url: `${startUrl}#${encodeURIComponent(j.jobId || j.key || j.title)}`,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: j.location || null,
        description: null,
      }));

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeTamuFacultyPositions(context, startUrl, campusName, sourceName) {
  try {
    const res = await context.request.get(startUrl, { timeout: 60_000 });
    if (!res.ok()) return [];
    const html = await res.text();
    if (!html || html.length < 500) return [];

    const out = [];
    const seen = new Set();
    const rx = /<a[^>]+href="([^"]*JobDetail\.aspx\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = rx.exec(html))) {
      let href = m[1] || "";
      let title = String(m[2] || "").replace(/<[^>]+>/g, " ");
      title = clean(title);
      if (!href || !title || title.length < 4) continue;
      try {
        href = new URL(href, startUrl).toString();
      } catch {
        continue;
      }
      if (seen.has(href)) continue;
      seen.add(href);
      out.push({
        title,
        url: href,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      });
    }

    const jobs = out
      .filter((j) => !omitAdjunct(j.title))
      .filter((j) => looksFacultyish(j.title) || /\b(research|teaching|clinical)\s+professor\b/i.test(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  }
}

async function scrapeTxAll(context) {
  const results = await mapWithConcurrency(
    TX_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "TX");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "TX");
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "TX");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "TX");
        if (type === "tamu-faculty") return await scrapeTamuFacultyPositions(context, url, campus, "TX");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "TX");
        if (type === "peoplesoft") return await scrapePeopleSoftAs(context, url, campus, "TX");
        if (type === "peoplesoft-hrs") return await scrapePeopleSoftHrsBasic(context, url, campus, "TX");
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "TX");
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "TX");
        if (type === "oracle-cx") return await scrapeOracleCxAs(context, url, campus, "TX");
        if (type === "csod") return await scrapeCsodAs(context, url, campus, "TX");
        if (type === "adp") return await scrapeAdpAs(context, url, campus, "TX");
        // No existing TX dispatch case for "paycom" (function scrapePaycomAs
        // already exists and is dispatched by MA/ME/NY) -- added for
        // Brazosport College.
        if (type === "paycom") return await scrapePaycomAs(context, url, campus, "TX");
        if (type === "nau-search") {
          const base = await scrapeNauSearch(context, url, campus, "TX");
          return await enrichEnUsJobCardsFromDetails(context, base, {
            titleDeptSeparator: " - ",
            preferDeptKeys: ["college", "department", "organization", "unit", "school"],
          });
        }
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "TX");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} TX scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

async function scrapeFlAll(context) {
  const results = await mapWithConcurrency(
    FL_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url, locationFilter }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "FL");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "FL");
        // locationFilter threaded through (added for Polytechnic University
        // of Puerto Rico-Orlando's shared Miami/Orlando ADP tenant) -- no-op
        // for every existing FL caller that doesn't set it.
        if (type === "adp") return await scrapeAdpAs(context, url, campus, "FL", locationFilter || null);
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "FL");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "FL");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "FL");
        if (type === "fsu-peoplesoft") return await scrapeFsuPeopleSoftJobs(context, url, campus, "FL");
        if (type === "peoplesoft") return await scrapePeopleSoftAs(context, url, campus, "FL");
        if (type === "ucf-search") return await scrapeUcfSearchAs(context, url, campus, "FL");
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "FL");
        if (type === "exacthire") return await scrapeExactHireAs(context, url, campus, "FL");
        if (type === "oracle-cx") return await scrapeOracleCxAs(context, url, campus, "FL");
        if (type === "flsouthern-portal") return await scrapeFloridaSouthernPortal(context, url, campus, "FL");
        if (type === "fiu-api") return await scrapeFiuApi(campus, "FL");
        // No existing FL dispatch case for "interfolio-inst" (function
        // scrapeInterfolioInstitution already existed, used by other states)
        // -- added while wiring Flagler College during the generic-scraper
        // long tail investigation.
        if (type === "interfolio-inst") return await scrapeInterfolioInstitution(context, url, campus, "FL");
        if (type === "nau-search") {
          const base = await scrapeNauSearch(context, url, campus, "FL");
          return await enrichEnUsJobCardsFromDetails(context, base, {
            titleDeptSeparator: " - ",
            preferDeptKeys: ["college", "department", "organization", "unit", "school"],
          });
        }
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "FL");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} FL scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
}

// Generic Taleo scraper for CU system
async function scrapeTaleoAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(4000);

    // Determine which Taleo format we're dealing with
    const isTbeFormat = /tbe\.taleo\.net/i.test(startUrl);
    const baseUrl = new URL(startUrl).origin;

    const jobs = await page.evaluate(({ isTbeFormat, baseUrl }) => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };
      const out = [];
      const seen = new Set();

      if (isTbeFormat) {
        // TBE Taleo format (used by Adelphi, etc.)
        // Find all links on the page and filter by URL pattern (case-insensitive)
        const allLinks = document.querySelectorAll('a[href]');
        for (const a of allLinks) {
          const href = a.getAttribute('href');
          if (!href) continue;

          const url = abs(href);
          if (!url) continue;
          if (seen.has(url)) continue;

          // Look for job detail links (case-insensitive check)
          if (!/jobdetail|requisition|job.*\d+/i.test(url)) continue;

          const title = clean(a.textContent);
          if (!title || title.length < 5 || title.length > 200) continue;
          if (/^(apply|view|details|more|back|search|login|new search|sort)$/i.test(title)) continue;

          seen.add(url);
          out.push({ title, url });
        }
      } else {
        // CU Taleo format: title links are often href="#", with real requisition IDs resolved via _ftl_api.
        const sectionMatch = location.href.match(/careersection\/([^/]+)/);
        const section = sectionMatch ? sectionMatch[1] : "2";
        const titleLinks = Array.from(document.querySelectorAll('a[id*="reqTitleLinkAction"], a[onclick*="requisition_openRequisitionDescription"]'));

        for (const a of titleLinks) {
          const title = clean(a.textContent);
          if (!title || title.length < 5 || title.length > 220) continue;
          if (/^(apply|details|view|more|back|search|login|new search|sort)$/i.test(title)) continue;

          const oc = a.getAttribute("onclick") || "";
          const keyMatch = oc.match(/'(requisitionListInterface\.ID\d+)'/);
          let reqId = null;

          // Preferred path: evaluate Taleo's runtime list value for this row.
          try {
            if (keyMatch && typeof window._ftl_api?.lstVal === "function") {
              reqId = window._ftl_api.lstVal(
                "requisitionListInterface",
                "requisitionListInterface.listRequisition",
                keyMatch[1],
                a
              );
            }
          } catch {}

          // Fallbacks from onclick payload.
          if (!reqId) {
            const m = oc.match(/job(?:Id|ID|=)\s*[:=]?\s*'?(\d{3,})'?/i) || oc.match(/(?:'|")(\d{3,})(?:'|")/);
            if (m) reqId = m[1];
          }

          const url = reqId
            ? `https://cu.taleo.net/careersection/${section}/jobdetail.ftl?job=${reqId}&lang=en`
            : `${location.href}${location.href.includes("?") ? "&" : "?"}jobRef=${encodeURIComponent(title)}`;

          if (seen.has(url)) continue;
          seen.add(url);
          out.push({ title, url });
        }

        // Last fallback: plain title extraction when DOM is unusual.
        if (out.length === 0) {
          for (const a of Array.from(document.querySelectorAll("a[href], a[onclick]"))) {
            const title = clean(a.textContent);
            if (!title || title.length < 8 || title.length > 220) continue;
            if (!/professor|faculty|lecturer|instructor|research/i.test(title)) continue;
            const href = a.getAttribute("href");
            const url = href && href !== "#" ? abs(href) : `${location.href}${location.href.includes("?") ? "&" : "?"}jobRef=${encodeURIComponent(title)}`;
            if (!url || seen.has(url)) continue;
            seen.add(url);
            out.push({ title, url });
          }
        }
      }

      return out;
    }, { isTbeFormat, baseUrl });

    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceName} Taleo listings scraped: ${filtered.length}`);
    return filtered.map((j) => ({
      title: clean(j.title),
      url: j.url,
      source: sourceName,
      category: "Faculty",
      college: campusName,
      location: null,
      description: null,
    }));
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} Taleo scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// CU Boulder jobs.colorado.edu scraper
async function scrapeCuBoulder(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    // Go to faculty jobs page. "networkidle" never fires here — the site keeps
    // background polling/analytics requests alive — so gotoWithRetry timed out
    // before the listing ever rendered. domcontentloaded + an explicit wait for
    // the listing content is the pattern used by every other JS-rendered scraper
    // in this file; this site was the sole "networkidle" holdout that mattered.
    await gotoWithRetry(page, "https://jobs.colorado.edu/jobs/SearchJobs?employmentType=Faculty", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(5000);

    const jobs = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const out = [];
      const seen = new Set();

      // Get the page text and extract job info
      // CU Boulder displays job titles followed by department and requisition info
      const text = document.body.innerText;
      const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

      let currentTitle = null;
      for (const line of lines) {
        // Look for lines that contain requisition numbers
        const reqMatch = line.match(/Requisition Number:\s*(\d+)/i);
        if (reqMatch) {
          const reqNum = reqMatch[1];
          // The title is usually on the previous non-empty line or at the start of a block
          // Try to find a title above this line
          if (currentTitle && !seen.has(reqNum)) {
            seen.add(reqNum);
            out.push({
              title: currentTitle,
              url: "https://jobs.colorado.edu/jobs/JobDetail/" + reqNum,
            });
          }
          currentTitle = null;
        } else if (
          line.length > 10 &&
          line.length < 200 &&
          !line.includes("|") &&
          !line.includes("Requisition") &&
          !/^(Search|Home|Login|FAQ|Create|Join|Living|Benefits|Perks|Jobs|Menu|Skip|Select|Full-Time|Part-Time|Faculty|Research Faculty|Staff|Temporary Staff|On-Call|Area of Interest|Functional Area|Employment Type|Schedule Interest|Search by Keyword|Reset|Displaying|Next|Previous|\d+$)/i.test(line)
        ) {
          // This might be a job title
          currentTitle = line;
        }
      }

      return out;
    });

    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length}`);
    return filtered.map((j) => ({
      title: clean(j.title),
      url: j.url,
      source: sourceName,
      college: campusName,
    }));
  } finally {
    await page.close().catch(() => {});
  }
}

// Interfolio Institution-specific positions page scraper
async function scrapeInterfolioInstitution(context, startUrl, campusName, sourceName) {
  // Extract institution ID from URL like https://apply.interfolio.com/16224/positions
  const instMatch = startUrl.match(/interfolio\.com\/(\d+)/);
  if (!instMatch) {
    console.error(`❌ ${campusName}: Cannot extract institution ID from ${startUrl}`);
    return [];
  }
  const instId = instMatch[1];
  const apiBase = `https://logic.interfolio.com/byc-search/${instId}/public_job_boards`;

  try {
    const allResults = [];
    const pageSize = 100;
    let page = 1;
    let totalCount = Infinity;

    while (allResults.length < totalCount) {
      const apiUrl = `${apiBase}?limit=${pageSize}&page=${page}`;
      const resp = await fetch(apiUrl, { signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) throw new Error(`API returned ${resp.status}`);
      const data = await resp.json();
      totalCount = data.total_count || 0;
      const results = data.results || [];
      if (results.length === 0) break;
      allResults.push(...results);
      page++;
    }

    const ymd = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);
    const jobs = allResults.map((r) => {
      // Interfolio's API exposes the posting open date + deadline directly
      // (open_date_raw / close_date_raw are already YYYY-MM-DD), so we capture
      // them here instead of visiting each detail page — these jobs already ship
      // an API description and so never enter the page-fetch/date-scan queue.
      const job = {
        title: clean(r.name || ""),
        url: `https://apply.interfolio.com/${r.id}`,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: (() => {
          const loc = (r.location || "").trim();
          if (!loc) return null;
          // Skip numeric campus codes (e.g., "01", "02", "06") and garbage like "Other 70"
          if (/^\d+$/.test(loc) || /^other\s+\d+$/i.test(loc)) return null;
          return loc;
        })(),
        description: r.description ? r.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 2000) : null,
      };
      const posted = ymd(r.open_date_raw);
      const close = ymd(r.close_date_raw) || ymd(r.deadline);
      if (posted) job.datePosted = posted;
      if (close) job.closeDate = close;
      return job;
    });

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  }
}

// SaaS HR REST API scraper (used by Pace University)
async function scrapeSaasHrApi(apiUrl, campusName, sourceName) {
  try {
    const allItems = [];
    const pageSize = 200;
    let offset = 1;

    for (let page = 0; page < 10; page++) {
      const url = `${apiUrl}?offset=${offset}&size=${pageSize}&sort=desc&ein_id=&lang=en-US`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) throw new Error(`API returned ${resp.status}`);
      const data = await resp.json();
      const items = data.job_requisitions || [];
      if (items.length === 0) break;
      allItems.push(...items);
      const total = data._paging?.total || 0;
      if (allItems.length >= total) break;
      offset += pageSize;
    }

    const jobs = allItems.map((j) => ({
      title: clean(j.job_title || ""),
      url: `${apiUrl.replace(/\/rest\/.*/, '')}/6000630.careers?CareersSearch`,
      source: sourceName,
      category: "Faculty",
      college: campusName,
      location: j.location || null,
      description: j.job_description ? j.job_description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 2000) : null,
    }));

    const filtered = jobs
      .filter((j) => looksFacultyish(j.title))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${filtered.length} (SaaS HR API)`);
    return filtered;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} SaaS HR API failed:`, e?.message || e);
    return [];
  }
}

// Interfolio Faculty Search scraper
async function scrapeInterfolioAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(4000);

    // Wait for job listings to load (multiple possible selectors)
    await page.waitForSelector('.position-card, .job-listing, a[href*="/apply/"], .positions-list, [class*="position"], [class*="job"]', { timeout: 15_000 }).catch(() => {});

    // Scroll to load more results
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(800);
    }

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); }
        catch { return null; }
      };

      const out = [];
      const seen = new Set();

      // Find job links on Interfolio - expanded selectors for institution-specific pages
      const selectors = [
        'a[href*="/apply/"]',
        'a[href*="interfolio.com"]',
        'a[href*="/positions/"]',
        '.position-title a',
        '.job-title a',
        '[class*="position"] a',
        '[class*="job"] a'
      ];

      for (const sel of selectors) {
        const links = Array.from(document.querySelectorAll(sel));
        for (const a of links) {
          const href = abs(a.getAttribute("href"));
          if (!href || seen.has(href)) continue;

          // Accept various Interfolio URL patterns
          const isJobLink = /\/apply\/\d+/i.test(href) ||
            /\/positions\/\d+/i.test(href) ||
            /interfolio\.com.*\d+/i.test(href);
          if (!isJobLink) continue;

          // Find the title from the link or parent container
          let title = clean(a.textContent);
          if (!title || title.length < 5) {
            const container = a.closest('.position-card, .job-listing, li, article, div, tr');
            const h = container?.querySelector('h1, h2, h3, h4, .title, .position-title, .job-title');
            title = clean(h?.textContent) || title;
          }

          // Skip navigation/UI text
          if (/^(apply|view|details|more info|learn more|click|back|search)$/i.test(title)) continue;

          if (title && title.length >= 5 && title.length < 300) {
            seen.add(href);
            out.push({ title, url: href });
          }
        }
      }

      // Fallback: look for any links that look like job postings
      if (out.length === 0) {
        const allLinks = document.querySelectorAll('a[href]');
        for (const a of allLinks) {
          const href = abs(a.getAttribute("href"));
          if (!href || seen.has(href)) continue;
          if (!/\d{5,}/i.test(href)) continue; // Job IDs are usually 5+ digits

          const title = clean(a.textContent);
          if (!title || title.length < 10 || title.length > 200) continue;
          if (/search|login|home|about|contact/i.test(title)) continue;

          seen.add(href);
          out.push({ title, url: href });
        }
      }

      return out;
    });

    const filtered = (items || []).filter((j) => !omitAdjunct(j.title));
    const jobs = filtered.map((x) => ({
      title: clean(x.title),
      url: x.url,
      source: sourceName,
      category: "Faculty",
      college: campusName,
      location: null,
      description: null,
    }));

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } catch (e) {
    console.error(`❌ ${campusName} ${sourceName} scrape failed:`, e?.message || e);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// Oracle HCM Candidate Experience (public jobs pages)
async function scrapeOracleCxAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    // Capture any XHR/Fetch calls the site makes to Oracle HCM REST endpoints.
    const apiHits = [];
    page.on("request", (req) => {
      try {
        const rt = req.resourceType();
        if (rt !== "xhr" && rt !== "fetch") return;
        const u = req.url();
        if (!u) return;
        if (u.includes("/hcmRestApi/") && /recruitingCEJobRequisitions/i.test(u)) {
          apiHits.push(u);
        }
      } catch {}
    });

    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Wait for the SPA to actually fire its job-search XHR instead of guessing a
    // fixed delay. Verified live against the Univ. of Wyoming tenant 2026-08-03:
    // the request normally lands ~2.2-2.4s after navigation — a hair under the
    // old fixed 2500ms wait — so any extra latency (slow network, a busier
    // scrape run) pushed it past the deadline and silently starved this source
    // down to 0 real jobs (the DOM fallback in path 3 then picked up stale nav
    // links instead). A capped explicit wait removes that race in both
    // directions: it returns as soon as the request fires, and tolerates far
    // more delay than a fixed guess ever could.
    await page
      .waitForRequest(
        (req) => {
          const rt = req.resourceType();
          if (rt !== "xhr" && rt !== "fetch") return false;
          const u = req.url();
          return !!u && u.includes("/hcmRestApi/") && /recruitingCEJobRequisitions/i.test(u);
        },
        { timeout: 15_000 }
      )
      .catch(() => {});

    // 1) Best case: reuse the exact API URL the site itself called (most reliable).
    let jobs = [];
    // Set when an API path returned a real (non-empty) requisition list, even if
    // none of them were faculty-related — that's a complete, authoritative "zero
    // open faculty postings" answer, not a failed lookup, so it must NOT fall
    // through to a later, less reliable path (DOM scraping picks up nav/category
    // links like a bare "Faculty" facet filter, which isn't a real posting).
    let apiRespondedWithData = false;
    if (apiHits.length) {
      // Prefer URLs that already include finder= and onlyData=true
      const picked =
        apiHits.find((u) => /finder=/i.test(u) && /onlyData=true/i.test(u)) ||
        apiHits.find((u) => /finder=/i.test(u)) ||
        apiHits[0];

      try {
        // A `finder=findReqs;...` URL is Oracle's search-description resource — it
        // returns facet counts (TotalJobsCount etc.) but not the requisitions
        // themselves unless `requisitionList` is explicitly expanded as a child
        // collection. Without this, path 1 "succeeds" (200 OK, valid JSON) but
        // silently yields zero jobs, so callers fall through to path 3's DOM
        // scrape instead of using the real data that was one query param away.
        const pickedUrl = new URL(picked);
        if (/finder=/i.test(picked)) {
          const existingExpand = pickedUrl.searchParams.get("expand");
          if (!/requisitionList/i.test(existingExpand || "")) {
            pickedUrl.searchParams.set("expand", existingExpand ? `${existingExpand},requisitionList` : "requisitionList");
          }
        }
        const res = await context.request.get(pickedUrl.toString(), { timeout: 60_000 });
        if (res.ok()) {
          const json = await res.json().catch(() => null);
          if (oracleCxExtractRequisitionList(json).length > 0) apiRespondedWithData = true;
          jobs = oracleCxJsonToJobs(json, campusName, sourceName, pickedUrl.toString());

          // The site's own page size (commonly 25) is often smaller than
          // TotalJobsCount — without paging through, results beyond the first
          // page are silently dropped (29-job WY tenant: page 1 returns only
          // 25). Keep requesting subsequent offsets off the same finder= URL
          // until we've covered TotalJobsCount, capped well above any real
          // per-campus faculty posting count as a runaway-loop backstop.
          let pageInfo = oracleCxExtractPaginationInfo(json);
          let fetched = pageInfo ? pageInfo.offset + pageInfo.limit : Infinity;
          for (let guard = 0; pageInfo && fetched < pageInfo.total && guard < 40; guard++) {
            const nextUrl = new URL(pickedUrl.toString());
            const finder = nextUrl.searchParams.get("finder") || "";
            const nextOffset = fetched;
            const withoutOffset = finder.replace(/,?offset=\d+/i, "");
            nextUrl.searchParams.set("finder", `${withoutOffset},offset=${nextOffset}`);

            const nextRes = await context.request.get(nextUrl.toString(), { timeout: 60_000 }).catch(() => null);
            if (!nextRes || !nextRes.ok()) break;
            const nextJson = await nextRes.json().catch(() => null);
            const nextJobs = oracleCxJsonToJobs(nextJson, campusName, sourceName, nextUrl.toString());
            if (!nextJobs.length) break;
            jobs = jobs.concat(nextJobs);

            pageInfo = oracleCxExtractPaginationInfo(nextJson);
            if (!pageInfo) break;
            fetched = pageInfo.offset + pageInfo.limit;
          }
        }
      } catch {}
    }

    // 2) If the captured URL path is blocked/empty, try our REST query builder.
    if (!jobs.length && !apiRespondedWithData) {
      jobs = await tryOracleCxRest(context, startUrl, campusName, sourceName, (found) => {
        if (found) apiRespondedWithData = true;
      });
    }

    // 3) As a last resort, fall back to DOM scraping (often 0 on Oracle CX SPAs).
    if (!jobs.length && !apiRespondedWithData) {
      // Try to load more results: scroll + click any "Load more"/"Show more" style button
      for (let i = 0; i < 40; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForTimeout(700);

        const btn = page
          .locator(
            'button:has-text("Load more"), button:has-text("Show more"), button:has-text("More"), ' +
              'button[aria-label*="Load" i], button[aria-label*="More" i]'
          )
          .first();

        if ((await btn.count().catch(() => 0)) > 0 && (await btn.isVisible().catch(() => false))) {
          const before = await page.evaluate(() => document.querySelectorAll("a[href]").length).catch(() => 0);
          await btn.scrollIntoViewIfNeeded().catch(() => {});
          await btn.click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(900);
          const after = await page.evaluate(() => document.querySelectorAll("a[href]").length).catch(() => 0);
          if (after <= before) break;
        }
      }

      const items = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        };

        const anchors = Array.from(document.querySelectorAll("a[href]"));

        const out = [];
        const seen = new Set();

        for (const a of anchors) {
          const url = abs(a.getAttribute("href"));
          if (!url) continue;

          const u = url.toLowerCase();
          const isJob =
            u.includes("/job/") ||
            u.includes("/jobs/") ||
            u.includes("jobid=") ||
            u.includes("job-id=") ||
            u.includes("requisition") ||
            u.includes("jobdetails");

          if (!isJob) continue;

          let title = clean(a.textContent);
          if (!title || title.length < 4 || /view|apply|details/i.test(title)) {
            const card = a.closest("li, article, div, tr, section") || a.parentElement;
            const h =
              card?.querySelector?.("h1,h2,h3,h4,strong,[role='heading']") ||
              card?.querySelector?.("[data-automation-id*='title' i]");
            const ht = clean(h?.textContent);
            if (ht && ht.length >= 4) title = ht;
          }

          if (!title || title.length < 4) continue;
          if (seen.has(url)) continue;
          seen.add(url);

          out.push({ title, url });
        }

        return out;
      }).catch(() => []);

      jobs = (items || [])
        .map((x) => ({
          title: clean(x.title),
          url: x.url,
          source: sourceName,
          category: "Faculty",
          college: campusName,
          location: null,
          description: null,
        }))
        .filter((j) => looksFacultyish(j.title))
        .filter((j) => !omitAdjunct(j.title));

      console.log(`${campusName} ${sourceName} listings scraped (DOM): ${jobs.length}`);
    } else {
      console.log(`${campusName} ${sourceName} listings scraped (REST): ${jobs.length}`);
    }

    return uniqByUrl(jobs);
  } finally {
    await page.close().catch(() => {});
  }
}

// Convert Oracle CX JSON payloads to our standard jobs objects.
// Handles multiple payload shapes seen across tenants.
function oracleCxJsonToJobs(json, campusName, sourceName, apiUrlForSiteHint = "") {
  try {
    // Use the extraction helper to handle nested requisitionList structures
    const items = oracleCxExtractRequisitionList(json);

    // Derive site from the API URL if possible, else default.
    let site = "CX_1";
    try {
      const u = new URL(apiUrlForSiteHint || "");
      const m = (u.searchParams.get("finder") || "").match(/siteNumber\s*=\s*([^,;]+)/i);
      if (m && m[1]) site = m[1].trim();
    } catch {}

    let base = "https://fa-ewca-saasfaprod1.fa.ocs.oraclecloud.com";
    try {
      const apiUrl = new URL(apiUrlForSiteHint || "");
      if (apiUrl.origin) base = apiUrl.origin;
    } catch {}
    const out = [];

    for (const it of items) {
      const title =
        clean(it?.Title || it?.requisitionTitle || it?.RequisitionTitle || it?.title || it?.requisitionName || "");
      if (!title) continue;

      const id =
        it?.Id ??
        it?.id ??
        it?.RequisitionId ??
        it?.requisitionId ??
        it?.JobRequisitionId ??
        it?.jobRequisitionId ??
        null;

      const url =
        (typeof it?.ExternalApplyUrl === "string" && it.ExternalApplyUrl) ||
        (typeof it?.ApplyUrl === "string" && it.ApplyUrl) ||
        (typeof it?.applyUrl === "string" && it.applyUrl) ||
        (id != null ? `${base}/hcmUI/CandidateExperience/en/sites/${site}/job/${id}` : "");

      if (!url) continue;

      out.push({
        title,
        url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      });
    }

    // Oracle CX sites list every open req (custodians, HVAC techs, admissions
    // counselors, etc.) under the same one or two "sites" this scraper is
    // configured against — there's no separate faculty-only board to point at
    // like there is for ADP/Workday, so restrict to faculty-looking titles here.
    return out.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
  } catch {
    return [];
  }
}


// Oracle CX REST helper: tries multiple query patterns and paginates.
// Returns job objects in our standard schema. onRawFound(true) is called if any
// attempt got a real (pre-faculty-filter) requisition list, so the caller can
// tell "authoritative zero faculty postings" apart from "every attempt failed".
async function tryOracleCxRest(context, startUrl, campusName, sourceName, onRawFound) {
  try {
    const u = new URL(startUrl);
    const origin = u.origin;
    const site = extractOracleCxSiteCode(u.pathname) || "CX_1";

    // If the UI URL includes a selectedCategoriesFacet, try to pass it through to REST queries.
    const facetId = u.searchParams.get("selectedCategoriesFacet");

    // Candidate query strings to try (Oracle tenants vary on which fields are queryable)
    const qCandidates = [];
    if (facetId) {
      qCandidates.push(`CategoriesFacet=${facetId}`);
      qCandidates.push(`CategoryId=${facetId}`);
      qCandidates.push(`JobCategoryId=${facetId}`);
      qCandidates.push(`categoriesFacet=${facetId}`);
    }
    // Always include a no-filter attempt
    qCandidates.push(null);

    const basePathVariants = [
      "/hcmRestApi/resources/latest/recruitingCEJobRequisitions",
      "/hcmRestApi/resources/11.13.18.05/recruitingCEJobRequisitions",
    ];

    for (const basePath of basePathVariants) {
      for (const q of qCandidates) {
        const jobs = await fetchOracleCxRequisitions(context, origin + basePath, { q, site, origin, campusName, sourceName, onRawFound });
        if (jobs && jobs.length) return jobs;
      }
    }
  } catch {
    // ignore
  }
  return [];
}

// --- Oracle CX helpers (REST) ---

function extractOracleCxSiteCode(pathname) {
  // Example: /hcmUI/CandidateExperience/en/sites/CX_1/jobs
  const m = String(pathname || "").match(/\/sites\/([^\/]+)/i);
  return m ? m[1] : null;
}

function oracleCxBuildJobUrl(origin, site, reqId) {
  if (!origin || !site || !reqId) return null;
  return `${origin}/hcmUI/CandidateExperience/en/sites/${site}/job/${reqId}`;
}

function oracleCxPickFirst(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function oracleCxExtractRequisitionList(json) {
  // Oracle responses vary:
  // - { items: [ { requisitionList: [...] , TotalJobsCount: N, ... } ] }
  // - { items: [ ...requisitionListItems ] }
  // - { requisitionList: [...] }
  // - { items: [...] } where items already are requisitions
  if (!json) return [];

  const direct = Array.isArray(json.requisitionList) ? json.requisitionList : null;
  if (direct && direct.length) return direct;

  const items = Array.isArray(json.items) ? json.items : null;
  if (items && items.length) {
    const withList = items.find((x) => x && Array.isArray(x.requisitionList));
    if (withList && Array.isArray(withList.requisitionList)) return withList.requisitionList;

    // Some tenants return requisitions directly as items
    const looksLikeReq = items.filter((x) => x && (x.RequisitionId || x.requisitionId || x.Id || x.Title || x.RequisitionTitle));
    if (looksLikeReq.length) return looksLikeReq;
  }

  return [];
}

// A `findReqs` response's pagination lives on the search-description object
// (items[0].Offset/Limit/TotalJobsCount), not the top-level items[]/count/offset
// fields (those describe the 1-element items wrapper, not the requisitions) —
// verified against the live Univ. of Wyoming tenant 2026-08-03, where the
// wrapper's own count/offset/limit (1/0/200) look plausible but are unrelated,
// and the requisition page size (25) silently truncated a 29-job result set.
function oracleCxExtractPaginationInfo(json) {
  const items = Array.isArray(json?.items) ? json.items : null;
  const withList = items?.find((x) => x && Array.isArray(x.requisitionList));
  if (!withList) return null;
  const offset = Number(withList.Offset);
  const limit = Number(withList.Limit);
  const total = Number(withList.TotalJobsCount);
  if (!Number.isFinite(offset) || !Number.isFinite(limit) || !Number.isFinite(total)) return null;
  return { offset, limit, total };
}

async function fetchOracleCxRequisitions(context, baseUrl, { q, site, origin, campusName, sourceName, onRawFound }) {
  const limit = 100;
  let offset = 0;
  const out = [];

  // Build a few q variants because tenants differ on query fields/format.
  const qVariants = [];

  // Always try with SiteNumber filter first (if we have it)
  const siteClauses = site ? [`SiteNumber=${site}`, `siteNumber=${site}`] : [];
  const q0 = q ? String(q) : null;

  if (q0 && siteClauses.length) {
    // Common Oracle REST "q" supports semicolon-separated clauses
    for (const s of siteClauses) {
      qVariants.push(`${q0};${s}`);
      qVariants.push(`${s};${q0}`);
      qVariants.push(`${q0},${s}`);
      qVariants.push(`${s},${q0}`);
    }
  }
  if (q0) qVariants.push(q0);
  if (siteClauses.length) qVariants.push(...siteClauses);
  qVariants.push(null);

  for (const qTry of qVariants) {
    offset = 0;
    out.length = 0;

    for (let safety = 0; safety < 80; safety++) {
      const url = new URL(baseUrl);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      if (qTry) url.searchParams.set("q", qTry);

      const res = await context.request.get(url.toString(), {
        timeout: 60_000,
        headers: {
          accept: "application/json",
          // Oracle REST framework version header (safe to include)
          "REST-Framework-Version": "4",
        },
      }).catch(() => null);

      if (!res || !res.ok()) break;

      const json = await res.json().catch(() => null);
      const reqs = oracleCxExtractRequisitionList(json);

      if (!reqs.length) break;
      if (onRawFound) onRawFound(true);

      for (const r of reqs) {
        const reqId = r?.RequisitionId || r?.requisitionId || r?.Id || r?.id || null;
        const title =
          oracleCxPickFirst(r, ["Title", "RequisitionTitle", "title", "requisitionTitle"]) ||
          oracleCxPickFirst(r, ["RequisitionNumber", "requisitionNumber"]) ||
          null;

        const primaryLoc = oracleCxPickFirst(r, ["PrimaryLocation", "primaryLocation", "Location", "location"]) || null;
        const org = oracleCxPickFirst(r, ["Organization", "organization", "Department", "department", "BusinessUnit", "businessUnit"]) || null;

        // Prefer API-provided link if present
        const href =
          oracleCxPickFirst(r, ["href", "Href", "applyUrl", "ApplyUrl", "externalApplyUrl", "ExternalApplyUrl"]) ||
          (Array.isArray(r?.links) ? oracleCxPickFirst(r.links.find((x) => x?.rel === "self") || {}, ["href"]) : null) ||
          null;

        const jobUrl = href || oracleCxBuildJobUrl(origin, site || "CX_1", reqId) || origin;

        // For your app, "college" is the institution; keep org/location in fields
        out.push({
          title: clean(title || ""),
          url: jobUrl,
          source: sourceName,
          category: "Faculty",
          college: campusName,
          location: primaryLoc,
          description: org, // lightweight: store org/department here if you want; can change later
        });
      }

      // pagination
      const hasMore = Boolean(json?.hasMore);
      const count = Number(json?.count || 0);

      offset += limit;
      if (!hasMore && count < limit) break;
      if (reqs.length < limit) break;
    }

    // Oracle CX sites list every open req (custodians, HVAC techs, admissions
    // counselors, etc.), not just faculty ones, so restrict to faculty-looking
    // titles here rather than returning the tenant's full staff+faculty board.
    const facultyOut = out.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    if (facultyOut.length) return facultyOut;
  }

  return [];
}


async function scrapeWwuFacultyPage(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };

      const root = document.querySelector("main") || document.querySelector("#content") || document.body;

      const out = [];
      const candidates = Array.from(root.querySelectorAll("a[href]")).map((a) => {
        const url = abs(a.getAttribute("href"));
        const text = clean(a.textContent);
        return { a, url, text };
      }).filter((x) => x.url && x.text && x.text.length >= 6);

      for (const { a, url, text } of candidates) {
        if (/privacy|accessibility|contact|directory|undergraduate|graduate/i.test(text)) continue;

        const container = a.closest("li, article, tr, .field-item, .views-row, .card") || a.parentElement;
        let title = text;

        if (container) {
          const h = container.querySelector("h1,h2,h3,strong,b");
          const ht = clean(h?.textContent);
          if (ht && ht.length >= 6) title = ht;
          else {
            const t = clean(container.textContent);
            const first = clean(t.split(/\n|\.|\|/)[0]);
            if (first && first.length >= 6 && first.length <= 160) title = first;
          }
        }

        const ok =
          /job|posting|apply|interfolio|workday|careers|requisition/i.test(url) ||
          /faculty|professor|assistant|associate|lecturer|instructor/i.test(title);

        if (!ok) continue;
        out.push({ title, url });
      }

      const seen = new Set();
      return out.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
    });

    return items.map((x) => ({
      title: x.title,
      url: x.url,
      source: sourceName,
      category: "Faculty",
      college: campusName,
      location: null,
      description: null,
    }));
  } finally {
    await page.close().catch(() => {});
  }
}



// ===== UW Academic Jobs (robust full-list scraper) =====

function normalizeUwTitle(raw) {
  // Normalize whitespace
  let s = String(raw || "").replace(/\s+/g, " ").trim();

  // Remove UW prefixed position number from titles.
  s = s.replace(/^Position\s*\d+\s*/i, "").trim();

  // Fix missing spaces between words like "CenterOpen" or "SurgeryUW"
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  s = s.replace(/([)\]])([A-Za-z])/g, "$1 $2");

  // Normalize separators
  s = s.replace(/\s*--\s*/g, " — ");
  s = s.replace(/\s*-\s*/g, " - ");

  // Trim at metadata that UW appends in the same text block
  const cut = s.search(/\b(Open date:|Position open through:|More info\b|Apply now\b)\b/i);
  if (cut !== -1) s = s.slice(0, cut).trim();

  // Drop common UW facility/location tails (including full name variant)
  s = s.replace(/\b(University of Washington Medical Center|UW Medical Center|UWMC|Harborview Medical Center|Seattle Children'?s)\b[\s\S]*$/i, "").trim();

  // Trim trailing compass/location fragments
  s = s.replace(/\s*[—-]\s*(NW|NE|SW|SE)\b.*$/i, "").trim();
  s = s.replace(/\b(Seattle|Tacoma|Bothell)\b.*$/i, "").trim();

  // Final tidy
  s = s.replace(/\s+,/g, ",").trim();
  s = s.replace(/^[\s|:–—-]+/, "").trim();
  s = s.replace(/\s*\|\s*$/, "").trim();
  return s;
}




async function scrapeUwAcademicJobs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);

    // Warm up lazy-loaded parts by scrolling until the number of "More info" links stops increasing
    try {
      let last = 0;
      for (let i = 0; i < 30; i++) {
        const now = await page.locator('a:has-text("More info")').count().catch(() => 0);
        if (now > last) last = now;
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForTimeout(600);
        const after = await page.locator('a:has-text("More info")').count().catch(() => 0);
        if (after <= last) break;
        last = after;
      }
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await page.waitForTimeout(300);
    } catch {}

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); }
        catch { return null; }
      };

      const out = [];
      const seen = new Set();

      // Strategy 1: Find "More info" links with position-details or job_id
      const moreInfoLinks = Array.from(document.querySelectorAll('a[href*="position-details"], a[href*="job_id"]'));
      for (const a of moreInfoLinks) {
        const href = abs(a.getAttribute("href"));
        if (!href || seen.has(href)) continue;

        // Find the parent li or container
        const container = a.closest("li") || a.parentElement?.closest("li") || a.parentElement;
        if (!container) continue;

        // Keep the raw container text to mine the posting dates, which UW renders
        // on the LISTING (not the detail page): "Open date: M/D/YYYY" and
        // "Position open through: <date|Until filled>".
        const raw = clean(container.textContent || "");
        const odm = raw.match(/Open date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
        const otm = raw.match(/Position open through:\s*(.+?)\s*(?:More info|Apply now|$)/i);

        // Remove common footer text like "More info", "Apply now", dates
        let text = raw.replace(/More info|Apply now|Open date:.*|Position open through:.*/gi, "").trim();
        // Extract title after "Position NNNNN" pattern
        const match = text.match(/Position\s+\d+\s+(.+?)(?:\s+(?:Seattle|Tacoma|Bothell|WA|Open date|$))/i);
        const title = match ? clean(match[1]) : clean(text.split(/\n/)[0]);

        if (title && title.length > 5) {
          seen.add(href);
          out.push({ title, url: href, openDate: odm ? odm[1] : null, openThrough: otm ? clean(otm[1]) : null });
        }
      }

      // Strategy 2: Fallback - find li elements with Position pattern
      if (out.length === 0) {
        const lis = Array.from(document.querySelectorAll("li"));
        for (const li of lis) {
          const text = clean(li.textContent || "");
          if (!/Position\s+\d+/i.test(text)) continue;

          const link = li.querySelector('a[href*="position"], a[href*="job"]') ||
                       li.nextElementSibling?.matches?.('a') ? li.nextElementSibling : null;
          if (!link) continue;

          const href = abs(link.getAttribute("href"));
          if (!href || seen.has(href)) continue;

          const match = text.match(/Position\s+\d+\s+(.+?)(?:\s+(?:Seattle|Tacoma|Bothell|WA|$))/i);
          const title = match ? clean(match[1]) : text;

          seen.add(href);
          out.push({ title, url: href });
        }
      }

      return out;
    });

    // M/D/YYYY (or a parseable date string) → YYYY-MM-DD; reject implausible years.
    const toYmd = (s) => {
      const m = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        const y = d.getFullYear();
        if (y > 2000 && y < 2100) return d.toISOString().slice(0, 10);
      }
      return null;
    };

    const jobs = (items || []).map((x) => {
      const job = {
        title: normalizeUwTitle(x.title),
        url: x.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      };
      const posted = toYmd(x.openDate);
      if (posted) job.datePosted = posted;
      if (x.openThrough) {
        if (/until\s+filled|open\s+until\s+filled|continuous|ongoing/i.test(x.openThrough)) {
          job.openUntilFilled = true;
        } else {
          const close = toYmd(x.openThrough);
          if (close) job.closeDate = close;
        }
      }
      return job;
    });

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } finally {
    await page.close().catch(() => {});
  }
}
