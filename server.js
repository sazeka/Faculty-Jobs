
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

  // Known mappings for CUNY and other colleges
  const knownNames = {
    'BARUCH': 'Baruch College',
    'HUNTER': 'Hunter College',
    'Hunter': 'Hunter College',
    'BROOKLYN': 'Brooklyn College',
    'Brooklyn': 'Brooklyn College',
    'QUEENS': 'Queens College',
    'Queens': 'Queens College',
    'CITY COLLEGE': 'City College',
    'COLLEGE OF STATEN ISLAND': 'College of Staten Island',
    'JOHN JAY': 'John Jay College',
    'GRADUATE CENTER': 'Graduate Center',
    'CUNY SCHOOL': 'CUNY School of Professional Studies',
    'CUNY Advanced': 'CUNY Advanced Science Research Center',
    'Bronx': 'Bronx Community College',
    'BRONX': 'Bronx Community College',
    'BMCC': 'Borough of Manhattan Community College',
    'HOSTOS': 'Hostos Community College',
    'KINGSBOROUGH': 'Kingsborough Community College',
    'LAGUARDIA': 'LaGuardia Community College',
    'LEHMAN': 'Lehman College',
    'MEDGAR EVERS': 'Medgar Evers College',
    'YORK COLLEGE': 'York College',
    'QUEENSBOROUGH': 'Queensborough Community College',
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
    await postWithRetry(url, { jobs: [], max_new_tokens: 1 }, 1);
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
  if ((n === "CSU" || n === "UC" || n === "CLAREMONT COLLEGES" || n === "CA PRIVATE") && (want.includes("CA") || want.includes("CALIFORNIA"))) return true;
  if ((n === "UMASS" || n === "UMASS AMHERST" || n === "MA PRIVATE") && (want.includes("MA") || want.includes("MASSACHUSETTS"))) return true;
  if (n === "MD" && (want.includes("MARYLAND") || want.includes("MD"))) return true;
  if (n === "ME" && (want.includes("MAINE") || want.includes("ME"))) return true;
  if (n === "NH" && (want.includes("NEW HAMPSHIRE") || want.includes("NH"))) return true;
  if (n === "VT" && (want.includes("VERMONT") || want.includes("VT"))) return true;
  if (n === "CT STATE" && want.includes("CT")) return true;
  return want.includes(n);
}

function isNyOnlyRun() {
  if (!CAMPUS_ALLOWLIST || CAMPUS_ALLOWLIST.length === 0) return false;
  const allow = CAMPUS_ALLOWLIST.map(x => String(x).toUpperCase());
  const nyAliases = ["NY", "NEW YORK", "CUNY", "SUNY"];
  return allow.some(x => nyAliases.includes(x));
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
    type: "yale",
    url: "https://academicpositions.yale.edu/job-posting",
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
    url: "https://conncoll.peopleadmin.com/postings/search",
  },
  {
    campus: "University of Bridgeport",
    type: "paycom",
    url: "https://www.paycomonline.net/v4/ats/web.php/jobs?clientkey=A1640D81A59AFDAFC5501F5B06EF1B08",
  },
];

const CSU_URL =
  "https://csucareers.calstate.edu/en-us/filter/?=&leftNavSearchFormQuery=&=&search=&search-keyword=&job-mail-subscribe-privacy=agree&work-type=instructional%20faculty%20%e2%80%93%20tenured%2ftenure-track&category=unit%203%20-%20cfa%20-%20california%20faculty%20association&job-mail-subscribe-privacy=agree";

// UMass (same "en-us/filter" platform style as CSU) - Note: Amherst moved to PageUp in Jan 2026
const UMASS_CAMPUSES = [
  {
    campus: "UMass Boston",
    url: "https://employmentopportunities.umb.edu/boston/en-us/filter/?search-keyword=&work-type=faculty%20full%20time&job-mail-subscribe-privacy=agree",
  },
  {
    campus: "UMass Dartmouth",
    url: "https://careers.umassd.edu/en-us/filter/?search-keyword=&job-mail-subscribe-privacy=agree&work-type=faculty%20full%20time",
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
    type: "generic",
    url: "https://academicjobsonline.org/ajo/jobs?institution=Massachusetts+Institute+of+Technology",
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
  {
    campus: "Boston College",
    type: "generic",
    url: "https://www.bc.edu/bc-web/offices/human-resources.html",
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
    url: "https://babson.peopleadmin.com/postings/search?query=&query_posted_at=&query_position_type_id=2&query_organizational_tier_3_id=any&commit=Search",
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
    type: "stockton",
    url: "https://employment.stockton.edu/jobs/search?page=1&employment_type_uids%5B%5D=fbab94e63ae2bac64f314b271869e32d&query=",
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
];

// Claremont Colleges
const CLAREMONT_CAMPUSES = [
  {
    campus: "Pomona College",
    type: "static",
    url: "https://www.pomona.edu/administration/academic-dean/general/faculty-jobs",
  },
  {
    campus: "Claremont Graduate University",
    type: "static",
    url: "https://www.cgu.edu/employment-opportunities/faculty-jobs/",
  },
  { campus: "Scripps College", type: "static", url: "https://www.scrippscollege.edu/hr/faculty" },
  {
    campus: "Claremont McKenna College",
    type: "cmc",
    url: "https://webapps.cmc.edu/jobs/faculty/faculty_opening.php",
  },
  {
    campus: "Harvey Mudd College",
    type: "static",
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
    url: "https://esu.csod.com/ats/careersite/search.aspx?site=1&c=esu",
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
    type: "static",
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
];

// NC (multi-platform; primarily PeopleAdmin)
const NC_CAMPUSES = [
  {
    campus: "Appalachian State University",
    type: "peopleadmin",
    url: "https://appstate.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=3&commit=Search",
  },
  {
    campus: "East Carolina University",
    type: "peopleadmin",
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
    url: "https://jobs.ncsu.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&1196%5B%5D=4&commit=Search",
  },
  {
    campus: "UNC Asheville",
    type: "peopleadmin",
    url: "https://jobs.unca.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&2414%5B%5D=2&commit=Search&_gl=1*1spg4dq*_gcl_au*MTU5NDAxNTk3Ny4xNzY4MTUzMzA3",
  },
  {
    campus: "UNC-Chapel Hill",
    type: "peopleadmin",
    url: "https://unc.peopleadmin.com/postings/search?query=&query_v0_posted_at_date=&query_organizational_tier_2_id=any&609=&query_organizational_tier_3_id=any&526=Any&query_position_type_id=6&608=Any&commit=Search",
  },
  {
    campus: "UNC Charlotte",
    type: "peopleadmin",
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
    type: "peopleadmin",
    url: "https://jobs.wcu.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&2022=2&query_organizational_tier_3_id=any&commit=Search",
  },
  {
    campus: "Winston-Salem State University",
    type: "peopleadmin",
    url: "https://jobs.wssu.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&435=&query_position_type_id%5B%5D=2&commit=Search",
  },
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
    url: "https://academicjobsonline.org/ajo/jobs?institution=Brown+University",
  },
  {
    campus: "Providence College",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/providencecollege",
  },
  {
    campus: "Bryant University",
    type: "peopleadmin",
    url: "https://employment.bryant.edu/postings/search?query=&query_v0_posted_at_date=&225=&query_position_type_id%5B%5D=3&commit=Search",
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
    type: "generic",
    url: "https://www.anselm.edu/human-resources/employment-opportunities",
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
    url: "https://careers.nau.edu/jobs/search?page=1&category_uids%5B%5D=16877518cdbd46262a1b4a995c2a65c2&query=",
  },
  {
    campus: "University of Arizona",
    type: "csod",
    url: "https://arizona.csod.com/ux/ats/careersite/4/home?c=arizona&cfdd[0][id]=228&cfdd[0][options][0]=288&cfdd[1][id]=161&cfdd[1][options][0]=118&country=us",
  },
];


// NY (State University of New York – SUNY) - Main page + individual campus scrapers
const NY_SUNY_MAIN = {
  campus: "SUNY System",
  url: "https://www.suny.edu/careers/employment/index.cfm?s=y",
};

const NY_SUNY_CAMPUSES = [
  {
    campus: "Stony Brook University (SUNY)",
    type: "interfolio-inst",
    url: "https://apply.interfolio.com/15355/positions",
  },
  {
    campus: "University at Buffalo (SUNY)",
    type: "peopleadmin",
    url: "https://www.ubjobs.buffalo.edu/postings/search?query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "University at Albany (SUNY)",
    type: "interfolio",
    url: "https://apply.interfolio.com/search#q=&institution_name=University%20at%20Albany&position_type=Faculty",
  },
  {
    campus: "Binghamton University (SUNY)",
    type: "interfolio",
    url: "https://apply.interfolio.com/search#q=&institution_name=Binghamton%20University&position_type=Faculty",
  },
];

const SUNY_CAMPUS_HINTS = [
  { campus: "University at Albany (SUNY)", patterns: [/albany/i, /albany\.edu/i] },
  { campus: "Binghamton University (SUNY)", patterns: [/binghamton/i, /binghamton\.edu/i] },
  { campus: "University at Buffalo (SUNY)", patterns: [/\bbuffalo\b/i, /buffalo\.edu/i] },
  { campus: "Stony Brook University (SUNY)", patterns: [/stony\s*brook/i, /stonybrook\.edu/i] },
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
      "www.ubjobs.buffalo.edu": "University at Buffalo (SUNY)",
      "ubjobs.buffalo.edu": "University at Buffalo (SUNY)",
      "careers.upstate.edu": "SUNY Upstate Medical University",
      "jobs.buffalostate.edu": "SUNY Buffalo State University",
      "jobs.cortland.edu": "SUNY Cortland",
      "jobs.newpaltz.edu": "SUNY New Paltz",
      "jobs.geneseo.edu": "SUNY Geneseo",
      "niagaracc-suny.peopleadmin.com": "SUNY Niagara",
      "fitnyc.interviewexchange.com": "SUNY Fashion Institute of Technology",
      "farmingdale.interviewexchange.com": "Farmingdale State College (SUNY)",
      "morrisville.interviewexchange.com": "SUNY Morrisville",
      "sunypoly.interviewexchange.com": "SUNY Polytechnic Institute",
      "sunydutchess.interviewexchange.com": "SUNY Dutchess Community College",
      "sccc.interviewexchange.com": "SUNY Schenectady County Community College",
      "oneonta.interviewexchange.com": "SUNY Oneonta",
      "oswego.interviewexchange.com": "SUNY Oswego",
      "binghamton.interviewexchange.com": "Binghamton University (SUNY)",
      "albany.interviewexchange.com": "University at Albany (SUNY)",
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
    type: "nyu",
    url: "https://www.nyu.edu/about/careers-at-nyu/faculty-and-researchers.html?jobType=Tenured/Tenure-Track%20Faculty&keyword=professor&school=",
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
    type: "enusfilter",
    url: "https://careers.rpi.edu/en-us/filter/?job-mail-subscribe-privacy=agree&search-keyword=&work-type=full%20time&category=faculty",
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
    type: "enusfilter",
    url: "https://careers.marist.edu/cw/en-us/filter/?search-keyword=&work-type=full-time&location=poughkeepsie%20ny&category=faculty&job-mail-subscribe-privacy=agree",
  },
  {
    campus: "Iona University",
    type: "paycom",
    url: "https://www.paycomonline.net/v4/ats/web.php/portal/F28471DFA0F4183976163E181A695BE1/career-page",
  },
  {
    campus: "Manhattan University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/manhattanedu/FTFaculty",
  },
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
    type: "peopleadmin",
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
    type: "static",
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
    url: "https://www.lclark.edu/about/hr/employment/",
  },
  {
    campus: "Willamette University",
    type: "generic",
    url: "https://willamette.edu/offices/hr/jobs/",
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
    url: "https://www.pacificu.edu/about/jobs",
  },
  {
    campus: "George Fox University",
    type: "generic",
    url: "https://www.georgefox.edu/offices/hr/employment/index.html",
  },

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
  {
    campus: "Central Washington University",
    type: "peoplesoft",
    url: "https://cwuhrprdcg.peoplesoft.cwu.edu/psc/careers/EMPLOYEE/CAREERS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?FOCUS=Applicant&&siteid=1&",
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
    type: "generic",
    url: "https://www.gonzaga.edu/about/offices-services/human-resources/careers",
  },
  {
    campus: "University of Puget Sound",
    type: "generic",
    url: "https://www.pugetsound.edu/about/offices-services/human-resources/employment-opportunities",
  },
  {
    campus: "Whitman College",
    type: "generic",
    url: "https://www.whitman.edu/human-resources/employment-opportunities",
  },
  {
    campus: "Whitworth University",
    type: "generic",
    url: "https://www.whitworth.edu/cms/administration/human-resource-services/employment-opportunities/",
  },
  {
    campus: "Pacific Lutheran University",
    type: "generic",
    url: "https://www.plu.edu/human-resources/employment/",
  },
  {
    campus: "Seattle Pacific University",
    type: "generic",
    url: "https://spu.edu/about/spu-jobs",
  },
  {
    campus: "Saint Martin's University",
    type: "generic",
    url: "https://www.stmartin.edu/about/careers",
  },
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
    type: "interfolio-inst",
    url: "https://apply.interfolio.com/36079/positions",
  },
  {
    campus: "Bennington College",
    type: "generic",
    url: "https://www.bennington.edu/employment-opportunities",
  },
  {
    campus: "Saint Michael's College",
    type: "oracle-cx",
    url: "https://stmichaels-ibukjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2",
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
    url: "https://minnstate.wd1.myworkdayjobs.com/Minnesota_State_Careers",
  },
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
];

// OH (Ohio)
const OH_CAMPUSES = [
  {
    campus: "Ohio State University",
    type: "workday",
    url: "https://osu.wd1.myworkdayjobs.com/OSUCareers",
  },
  {
    campus: "University of Toledo",
    type: "workday",
    url: "https://utoledo.wd1.myworkdayjobs.com/UTJobs",
  },
  {
    campus: "Ohio University",
    type: "peopleadmin",
    url: "https://www.ohiouniversityjobs.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "Kent State University",
    type: "peopleadmin",
    url: "https://jobs.kent.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "Cleveland State University",
    type: "peopleadmin",
    url: "https://hrjobs.csuohio.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "Wright State University",
    type: "peopleadmin",
    url: "https://jobs.wright.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=1&commit=Search",
  },
];

// NM (New Mexico)
const NM_CAMPUSES = [
  {
    campus: "University of New Mexico",
    type: "csod",
    url: "https://unm.csod.com/ux/ats/careersite/18/home?c=unm",
  },
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
    type: "peopleadmin",
    url: "https://jobs.weber.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "Utah Valley University",
    type: "peopleadmin",
    url: "https://www.uvu.jobs/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=1&commit=Search",
  },
  {
    campus: "Southern Utah University",
    type: "workday",
    url: "https://suu.wd1.myworkdayjobs.com/SUUJobs",
  },
  {
    campus: "Utah Tech University",
    type: "workday",
    url: "https://utahtech.wd5.myworkdayjobs.com/DSUcareers",
  },
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
    url: "https://careers.emich.edu/jobs/search?page=1&employment_type_uids%5B%5D=e287a25700cc5e02041e575342cc273a&query=",
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
    campus: "Western Michigan University",
    type: "peopleadmin",
    url: "https://www.wmujobs.org/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id[]=3&435=&commit=Search",
  },
];

// IL (Illinois)
const IL_CAMPUSES = [
  {
    campus: "Chicago State University",
    type: "peopleadmin",
    url: "https://chicagostate.peopleadmin.com/postings/search?query=&query_posted_at=&142=&query_organizational_tier_3_id=any&query_position_type_id=2&commit=Search",
  },
  {
    campus: "Eastern Illinois University",
    type: "eiu-static",
    url: "https://www.eiu.edu/jobs/",
  },
  {
    campus: "Governors State University",
    type: "schooljobs",
    url: "https://www.schooljobs.com/careers/govst/",
  },
  {
    campus: "Illinois State University",
    type: "enusfilter",
    url: "https://jobsearch.illinoisstate.edu/en-us/filter/?search-keyword=&category=faculty",
  },
  {
    campus: "University of Illinois Chicago",
    type: "csod",
    url: "https://uic.csod.com/ux/ats/careersite/1/home/?c=uic&cfdd[0][id]=192&cfdd[0][options][0]=1161&cfdd[1][id]=250&cfdd[1][options][0]=1856",
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
  {
    campus: "Northeastern Illinois University",
    type: "static",
    url: "https://www.neiu.edu/academics/colleges-departments/education/employment-opportunities",
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
    type: "pageup",
    url: "https://careers.usi.edu/cw/en-us/listing/",
  },
];

/* ============================== EXPRESS ============================== */

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

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
      { name: "UMass", fn: () => scrapeUmassAll(context) },
      { name: "UMass Amherst", fn: () => scrapeUmassAmherst(context) },
      { name: "MA Private", fn: () => scrapeMaPrivate(context) },
      { name: "UC", fn: () => scrapeUcAll(context) },
      { name: "CA Private", fn: () => scrapeCaPrivate(context) },
      { name: "NJ", fn: () => scrapeNjAll(context) },
      { name: "NC", fn: () => scrapeNcAll(context) },
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
      { name: "WI", fn: () => scrapeWiAll(context) },
      { name: "MT", fn: () => scrapeMtAll(context) },
      { name: "CO", fn: () => scrapeCoAll(context) },
      { name: "OH", fn: () => scrapeOhAll(context) },
      { name: "NM", fn: () => scrapeNmAll(context) },
      { name: "UT", fn: () => scrapeUtAll(context) },
      { name: "ID", fn: () => scrapeIdAll(context) },
      { name: "IN", fn: () => scrapeInAll(context) },

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
    const normalizedJobs = jobs.map(normalizeLocationByCollege);

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
        facultyJobs = fallbackJobs;
      }
    }
    if (preFilterCount !== facultyJobs.length) {
      console.log(`🔍 Global faculty filter: ${preFilterCount} → ${facultyJobs.length} (removed ${preFilterCount - facultyJobs.length} non-faculty jobs)`);
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

function inferAcademicFieldsFromTitle(title) {
  const t = clean(title);
  if (!t) return { department: null, specialization: null };

  let dept = null;
  let spec = null;

  // Pattern: "Assistant Professor of X", "Lecturer in Y", "Chair of Z"
  let m = t.match(/\b(?:Professor|Lecturer|Instructor|Chair)\s+(?:of|in)\s+(.+)$/i);

  // Pattern: "Postdoctoral ... in X"
  if (!m) m = t.match(/\bPost(?:doc|doctoral)\b.*?\bin\s+(.+)$/i);

  // Pattern: title previously enriched as "Title — Department Name"
  if (!m) {
    const parts = t.split(/\s+[—-]\s+/);
    if (parts.length >= 2) m = [parts[0], parts.slice(1).join(" — ")];
  }

  if (m && m[1]) {
    const value = clean(String(m[1]).replace(/[.;,:)\]]+\s*$/g, ""));
    if (value && value.length <= 120) {
      dept = value;
      spec = value;
    }
  }

  return { department: dept || null, specialization: spec || null };
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
};

function isLikelyGeographicLocation(location) {
  const t = clean(location);
  if (!t) return false;
  // Typical US city/state pattern.
  if (/, [A-Z]{2}\b/.test(t)) return true;
  // Accept obvious Pennsylvania city shorthand.
  if (/\b(Philadelphia|Pittsburgh|Villanova|Lewisburg|Swarthmore|Gettysburg|Carlisle|Easton|Lancaster|Bethlehem),?\s*PA\b/i.test(t)) return true;
  return false;
}

function normalizeLocationByCollege(job) {
  if (!job || !["PA", "RI", "DE", "MD", "ME", "NH", "VT", "OR", "WA"].includes(job.source)) return job;
  const fallback = COLLEGE_LOCATION_DEFAULTS[job.college] || null;
  if (!fallback) return job;

  const loc = clean(job.location || "");
  // Replace null or building-level locations with canonical campus city/state.
  if (!loc || !isLikelyGeographicLocation(loc)) {
    return { ...job, location: fallback };
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
    /adjunct/i.test(t) ||
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

function looksFacultyish(title) {
  const s = String(title || "").toLowerCase();
  // Strict filter: only true faculty positions
  // Must contain professor, lecturer, instructor, or faculty
  return (
    s.includes("professor") ||
    s.includes("lecturer") ||
    s.includes("instructor") ||
    /\bfaculty\b/.test(s)
  );
}

/* ============================== CUNY ============================== */

// Fetch job description from CUNY detail page (requires JS rendering)
async function fetchCunyJobDescription(context, url, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
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
    await page.goto(CUNY_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

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
  await page.goto(CT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
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

/* ============================== CSU ============================== */

async function scrapeCsuFaculty(context) {
  const page = await context.newPage();
  await page.goto(CSU_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

function mapCsuLocationToCampus(location) {
  if (!location) return null;
  const key = clean(String(location));
  const byLocation = {
    "Bakersfield": "California State University, Bakersfield",
    "Channel Islands": "California State University Channel Islands",
    "Chico": "California State University, Chico",
    "Dominguez Hills": "California State University, Dominguez Hills",
    "East Bay": "California State University, East Bay",
    "Fresno": "California State University, Fresno",
    "Fullerton": "California State University, Fullerton",
    "Humboldt": "Cal Poly Humboldt",
    "Long Beach": "California State University, Long Beach",
    "Los Angeles": "California State University, Los Angeles",
    "Maritime Academy": "California State University Maritime Academy",
    "Monterey Bay": "California State University, Monterey Bay",
    "Northridge": "California State University, Northridge",
    "Pomona": "California State Polytechnic University, Pomona",
    "Sacramento": "California State University, Sacramento",
    "San Bernardino": "California State University, San Bernardino",
    "San Diego": "San Diego State University",
    "San Francisco": "San Francisco State University",
    "San Jose": "San Jose State University",
    "San José": "San Jose State University",
    "San Luis Obispo": "California Polytechnic State University, San Luis Obispo",
    "San Marcos": "California State University San Marcos",
    "Sonoma": "Sonoma State University",
    "Stanislaus": "California State University, Stanislaus",
  };
  return byLocation[key] || null;
}

function inferCsuCampusFromText(text) {
  if (!text) return null;
  const cleaned = clean(String(text));
  const patterns = [
    /\b(California State University Channel Islands)\b/i,
    /\b(California State University,\s*[A-Za-z .'-]+)\b/i,
    /\b(California State University San Marcos)\b/i,
    /\b(California State Polytechnic University,\s*[A-Za-z .'-]+)\b/i,
    /\b(California Polytechnic State University,\s*San Luis Obispo)\b/i,
    /\b(San Diego State University|San Francisco State University|San Jose State University|Sonoma State University|Cal Poly Humboldt)\b/i,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m && m[1]) return clean(m[1]);
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
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

/* ============================== UMass ============================== */

async function scrapeUmassAll(context) {
  const out = [];

  await Promise.all(
    UMASS_CAMPUSES.map(async ({ campus, url }) => {
      try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
    await page.goto(UMASS_AMHERST_URL, { waitUntil: "networkidle", timeout: 60_000 });
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
    async ({ campus, type, url }) => {
      try {
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "CA Private");
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "CA Private");
        if (type === "usc-jobs") return await scrapeUscJobsAs(url, campus, "CA Private");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "CA Private");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "CA Private");
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

    await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
            await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

        // Princeton AHIRE lists jobs with links containing "listingId"
        const links = document.querySelectorAll('a[href*="listingId"]');
        for (const a of links) {
          const href = abs(a.getAttribute("href"));
          const title = clean(a.textContent);
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
  return { title, url, source: "NJ", category, college: campusName, location: null, description: null };
}

async function scrapeNjTaleo(context, startUrl, campusName, sourceLabel = "NJ") {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);

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
          if (parts[0] === "recruiting" && parts[1] && parts[2]) {
            apiUrl = `https://${u.host}/wday/cxs/${parts[1]}/${parts[2]}/jobs`;
          }
        }
      } catch {}
    }

    if (!apiUrl) {
      console.log(`${campusName} ${sourceLabel}: Could not parse Workday URL, falling back to browser`);
      return await scrapeNjWorkdayBrowser(context, startUrl, campusName, sourceLabel);
    }

    // Parse facets from URL query parameters (e.g. ?jobFamilyGroup=abc&timeType=xyz)
    const appliedFacets = {};
    try {
      const qs = new URL(startUrl).searchParams;
      for (const [key, val] of qs.entries()) {
        if (!appliedFacets[key]) appliedFacets[key] = [];
        appliedFacets[key].push(val);
      }
    } catch {}

    const allJobs = [];
    let offset = 0;
    const limit = 20;

    for (let page = 0; page < 50; page++) {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appliedFacets,
          limit,
          offset,
          searchText: ""
        })
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
      if (offset >= data.total) break;
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
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
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
      await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
          if (/adjunct/i.test(title)) continue;

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
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
          out.push({ title, url });
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

// SchoolJobs pagination sometimes uses javascript:void(0) for Next.
// We click and wait for results signature to change.
async function scrapeNjSchoolJobs(context, startUrl, campusName, sourceLabel = "NJ") {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();

    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
          out.push({ title, url });
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

    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
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
      await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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



async function scrapeDeAll(context) {
  const results = await mapWithConcurrency(
    DE_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {

if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "DE");
if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "DE");
if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "DE");
if (type === "enusfilter") {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

        // Fallback: try en-us/filter-style extractor
        const page = await context.newPage();
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

async function scrapeSchoolJobsAs(context, startUrl, campusName, sourceName) {
  const items = await scrapeNjSchoolJobs(context, startUrl, campusName, sourceName);
  return items.map((j) => ({ ...j, source: sourceName, college: campusName }));
}

async function scrapeCsodAs(context, startUrl, campusName, sourceName) {
  const items = await scrapeNjCsod(context, startUrl, campusName, sourceName);
  return items.map((j) => ({ ...j, source: sourceName, college: campusName }));
}

async function scrapeWorkdayAs(context, startUrl, campusName, sourceName) {
  const items = await scrapeNjWorkday(context, startUrl, campusName, sourceName);
  return items.map((j) => ({ ...j, source: sourceName, college: campusName }));
}

async function scrapePeopleAdminAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();
    let currentUrl = startUrl;

    for (let safety = 0; safety < 120; safety++) {
      await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

    const out = jobs
      .map((j) => {
        const title = clean(j.title);
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
      })
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${out.length}`);
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}


async function scrapePeopleSoftAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

    for (let safety = 0; safety < 120; safety++) {
      await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

        const dept = deptFromContainer(j.containerText || "");
        let title = clean(j.title);
        if (dept && !title.toLowerCase().includes(dept.toLowerCase())) {
          title = `${title} — ${dept}`;
        }

        jobs.push({ title, url: j.url });
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
        const title = clean(j.title);
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
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "IL");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "IL");
        if (type === "csod") return await scrapeCsodAs(context, url, campus, "IL");

        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await page.waitForTimeout(900);
            return await scrapeEnUsFilterSite(page, { source: "IL", campus, category: "Faculty" });
          } finally {
            await page.close().catch(() => {});
          }
        }

        if (type === "eiu-static") return await scrapeEiuJobs(context, url, campus);
        if (type === "static") return await scrapeStaticLinksAs(context, url, campus, "IL");
        if (type === "interfolio") return await scrapeInterfolioPositionsAs(context, url, campus, "IL");
        if (type === "interviewexchange") return await scrapeInterviewExchangeAs(context, url, campus, "IL");

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
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);

    const jobs = [];
    const seen = new Set();

    for (let safety = 0; safety < 40; safety++) {
      const batch = await safeEvaluate(page, () => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try { return new URL(href, location.href).toString(); } catch { return null; }
        };

        const out = [];
        const links = Array.from(document.querySelectorAll('a[href*="/positions/"], a[href*="/position/"]'));
        for (const a of links) {
          const url = abs(a.getAttribute("href"));
          if (!url) continue;

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
        await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
async function scrapeInterviewExchangeAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);

    const items = await safeEvaluate(page, () => {
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
    title,
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
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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


function toClaremontJob(title, url, campusName) {
  return { title, url, source: "Claremont Colleges", category: "Faculty", college: campusName, location: null, description: null };
}

async function scrapeClaremontStatic(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

async function scrapeClaremontCmc(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

        const title = clean(a.textContent) || clean(r.querySelector("td")?.textContent);
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
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
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

    const href = await loc.getAttribute("href").catch(() => null);
    const bad = !href || href === "#" || /^javascript:/i.test(href);

    if (!bad) {
      const nextUrl = new URL(href, page.url()).toString();
      await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const after = await schoolJobsSignature(page);
      return after && after !== before;
    }

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
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
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
  const tasks = AZ_CAMPUSES.map(({ campus, type, url }) =>
    (async () => {
      try {
        if (type === "asu-table") return await scrapeAsuFacultyPositionsTable(context, campus, url);
        if (type === "nau-search") return await scrapeNauSearch(context, url, campus, "AZ");
        if (type === "csod") return await scrapeCsodAs(context, url, campus, "AZ");
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
    await page.goto(NY_SUNY_MAIN.url, { waitUntil: "networkidle", timeout: 60_000 });
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
        if (type === "generic") return await scrapeGenericJobPage(context, url, campus, "NY");
        if (type === "paycom") return await scrapePaycomAs(context, url, campus, "NY");
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "NY");
        if (type === "pageup") return await scrapePageUpAs(context, url, campus, "NY");
        if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "NY");
        if (type === "saashr") return await scrapeSaasHrApi(url, campus, "NY");
        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
async function scrapePaycomAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

        out.push({ title, url });
      }

      return out;
    });

    const filtered = jobs.filter((j) => !omitAdjunct(j.title));
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
    await page.goto(directoryUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
async function scrapeGenericJobPage(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);

    const jobs = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };

      const out = [];
      const seen = new Set();

      // Look for job links
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;

        // Skip navigation and common non-job links
        if (/login|logout|search|home|about|contact|privacy|terms|faq|help/i.test(url)) continue;
        if (/\/directory\b|\/faculty-staff\b|\/our-faculty\b|\/faculty-profiles\b|\/people\b/i.test(url)) continue;

        let title = clean(a.textContent);
        if (!title || title.length < 10) continue;

        // Skip navigation elements
        if (/^(menu|search|login|home|back|next|previous|submit|apply|click|more|view)$/i.test(title)) continue;
        if (/faculty\s+(and|&)\s+staff\s+directory|faculty\s+directory|our\s+faculty|meet\s+the\s+faculty|faculty\s+profiles?/i.test(title)) continue;

        // Look for faculty-related keywords in title - be strict
        const isFacultyRelated =
          /professor|lecturer|instructor|\bfaculty\b/i.test(title);

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

      return out;
    });

    const filtered = jobs.filter((j) => !omitAdjunct(j.title));
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

// PageUp scraper (used by Yeshiva University)
async function scrapePageUpAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);

    const jobs = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };

      const out = [];
      const seen = new Set();

      // PageUp uses specific selectors for job listings
      const selectors = [
        'a[href*="/job/"]',
        'a[href*="/listing/"]',
        '.job-title a',
        '.job-link',
        '[class*="JobTitle"]',
        '[class*="job-title"]'
      ];

      for (const sel of selectors) {
        for (const a of Array.from(document.querySelectorAll(sel))) {
          const url = abs(a.getAttribute("href"));
          if (!url) continue;

          const title = clean(a.textContent);
          if (!title || title.length < 5) continue;
          if (/search|home|back|login|filter/i.test(title)) continue;

          if (seen.has(url)) continue;
          seen.add(url);

          out.push({ title, url });
        }
      }

      return out;
    });

    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
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

// iCIMS scraper (used by NYU and others)
async function scrapeIcimsAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);

    // iCIMS pages often have job cards with links
    const jobs = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); } catch { return null; }
      };

      const out = [];
      const seen = new Set();

      // iCIMS uses various selectors for job listings
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
    });

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

// NYU Faculty scraper
async function scrapeNyuFaculty(context, startUrl) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, {
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
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
        const jobAnchors = Array.from(document.querySelectorAll('a[href]'))
          .map((a) => abs(a.getAttribute("href")))
          .filter((href) => href && /\/jobs\//i.test(href) && !/\/jobs\/search/i.test(href));

        // De-dupe URLs on the page first to avoid grabbing secondary anchors within the same card.
        const uniqUrls = Array.from(new Set(jobAnchors));

        for (const href of uniqUrls) {
          const a = Array.from(document.querySelectorAll('a[href]')).find((x) => abs(x.getAttribute('href')) === href);
          const card = a ? (a.closest("article,li,div") || null) : null;

          const title = pickBestTitle(card, href) || clean(a?.textContent);
          if (!title || title.length < 6) continue;

          out.push({ title, url: href, location: extractLocation(card) });
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
    const dept = d.dept || null;
    const location = d.location || j.location || null;

    if (dept && title && !title.toLowerCase().includes(dept.toLowerCase())) {
      title = `${title}${titleDeptSeparator}${dept}`;
    }

    // Keep the campus name in `college`, but use dept/college info only for title enrichment.
    return {
      ...j,
      title,
      location,
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
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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
        if (type === "umn") return await scrapeUmnJobs(context, url, campus, "MN");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "MN");
        return [];
      } catch (e) {
        console.error(`❌ ${campus} MN scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
}

// University of Minnesota (PeopleSoft-based MyU portal)
async function scrapeUmnJobs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2000);

    // Try to load more results by scrolling and clicking "Show More" if present
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(500);

      const showMore = page.locator('button:has-text("Show More"), a:has-text("Show More"), button:has-text("Load More")').first();
      if ((await showMore.count().catch(() => 0)) > 0 && (await showMore.isVisible().catch(() => false))) {
        await showMore.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    const items = await safeEvaluate(page, () => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); }
        catch { return null; }
      };

      const out = [];
      const seen = new Set();

      // PeopleSoft job links often have patterns like HRS_CE_JOB_DTL or job posting IDs
      const links = Array.from(document.querySelectorAll('a[href]'));
      for (const a of links) {
        const href = abs(a.getAttribute("href"));
        if (!href) continue;

        // Match PeopleSoft job detail patterns
        const isJob =
          /HRS_CE_JOB_DTL/i.test(href) ||
          /jobid=/i.test(href) ||
          /job_id=/i.test(href) ||
          /posting/i.test(href) ||
          (/HRS.*JOB/i.test(href));

        if (!isJob) continue;
        if (seen.has(href)) continue;

        const title = clean(a.textContent);
        if (!title || title.length < 5) continue;
        if (/^(view|apply|details|more|back|home|search|login)$/i.test(title)) continue;

        seen.add(href);
        out.push({ title, url: href });
      }

      return out;
    });

    const jobs = (items || []).map((x) => ({
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

/* ============================== WI ============================== */

async function scrapeWiAll(context) {
  const results = await mapWithConcurrency(
    WI_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "WI");
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
        if (type === "taleo") return await scrapeTaleoAs(context, url, campus, "CO");
        if (type === "cu-boulder") return await scrapeCuBoulder(context, url, campus, "CO");
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
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "NM");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "NM");
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

/* ============================== UT ============================== */

async function scrapeUtAll(context) {
  const results = await mapWithConcurrency(
    UT_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "UT");
        if (type === "workday") return await scrapeWorkdayAs(context, url, campus, "UT");
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
        if (type === "enusfilter") {
          const page = await context.newPage();
          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await page.waitForTimeout(900);
            return await scrapeEnUsFilterSite(page, { source: "ID", campus, category: "Faculty" });
          } finally {
            await page.close().catch(() => {});
          }
        }
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

// Generic Taleo scraper for CU system
async function scrapeTaleoAs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "networkidle", timeout: 60_000 });
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
        // CU Taleo format
        const rows = document.querySelectorAll('[id*="requisitionListInterface"]');
        for (const row of rows) {
          const text = row.textContent || "";
          const reqMatch = text.match(/Requisition\s*(?:ID)?[:#]?\s*(\d+)/i);
          if (!reqMatch) continue;

          const reqId = reqMatch[1];
          if (seen.has(reqId)) continue;
          seen.add(reqId);

          const titleMatch = text.match(/^([^R]+?)(?:Requisition|$)/i);
          let title = titleMatch ? clean(titleMatch[1]) : "";
          if (!title || title.length < 4) continue;

          // Extract section from current URL
          const sectionMatch = location.href.match(/careersection\/([^/]+)/);
          const section = sectionMatch ? sectionMatch[1] : "2";
          const url = `https://cu.taleo.net/careersection/${section}/jobdetail.ftl?job=${reqId}`;
          out.push({ title, url });
        }

        // Fallback for CU format
        if (out.length === 0) {
          const links = document.querySelectorAll('a[href="#"]');
          for (const a of links) {
            const title = clean(a.textContent);
            if (title && title.length > 10 && title.length < 200) {
              const parent = a.closest("tr, div, li");
              if (parent) {
                const parentText = parent.textContent || "";
                const reqMatch = parentText.match(/Requisition\s*(?:ID)?[:#]?\s*(\d+)/i);
                if (reqMatch && !seen.has(reqMatch[1])) {
                  seen.add(reqMatch[1]);
                  const sectionMatch = location.href.match(/careersection\/([^/]+)/);
                  const section = sectionMatch ? sectionMatch[1] : "2";
                  const url = `https://cu.taleo.net/careersection/${section}/jobdetail.ftl?job=${reqMatch[1]}`;
                  out.push({ title, url });
                }
              }
            }
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
    // Go to faculty jobs page
    await page.goto("https://jobs.colorado.edu/jobs/SearchJobs?employmentType=Faculty", { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(3000);

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
      const resp = await fetch(apiUrl);
      if (!resp.ok) throw new Error(`API returned ${resp.status}`);
      const data = await resp.json();
      totalCount = data.total_count || 0;
      const results = data.results || [];
      if (results.length === 0) break;
      allResults.push(...results);
      page++;
    }

    const jobs = allResults.map((r) => ({
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
    }));

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
      const resp = await fetch(url);
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
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Let the SPA hydrate and fire its XHRs
    await page.waitForTimeout(2500);

    // 1) Best case: reuse the exact API URL the site itself called (most reliable).
    let jobs = [];
    if (apiHits.length) {
      // Prefer URLs that already include finder= and onlyData=true
      const picked =
        apiHits.find((u) => /finder=/i.test(u) && /onlyData=true/i.test(u)) ||
        apiHits.find((u) => /finder=/i.test(u)) ||
        apiHits[0];

      try {
        const res = await context.request.get(picked, { timeout: 60_000 });
        if (res.ok()) {
          const json = await res.json().catch(() => null);
          jobs = oracleCxJsonToJobs(json, campusName, sourceName, picked);
        }
      } catch {}
    }

    // 2) If the captured URL path is blocked/empty, try our REST query builder.
    if (!jobs.length) {
      jobs = await tryOracleCxRest(context, startUrl, campusName, sourceName);
    }

    // 3) As a last resort, fall back to DOM scraping (often 0 on Oracle CX SPAs).
    if (!jobs.length) {
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

    const base = "https://fa-ewca-saasfaprod1.fa.ocs.oraclecloud.com";
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

    return out.filter((j) => !omitAdjunct(j.title));
  } catch {
    return [];
  }
}


// Oracle CX REST helper: tries multiple query patterns and paginates.
// Returns job objects in our standard schema.
async function tryOracleCxRest(context, startUrl, campusName, sourceName) {
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
        const jobs = await fetchOracleCxRequisitions(context, origin + basePath, { q, site, origin, campusName, sourceName });
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

async function fetchOracleCxRequisitions(context, baseUrl, { q, site, origin, campusName, sourceName }) {
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

    if (out.length) return out;
  }

  return [];
}


async function scrapeWwuFacultyPage(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

  // Fix missing spaces between words like "CenterOpen" or "SurgeryUW"
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");

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
  return s;
}




async function scrapeUwAcademicJobs(context, startUrl, campusName, sourceName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

        // Extract title from container text
        let text = clean(container.textContent || "");
        // Remove common footer text like "More info", "Apply now", dates
        text = text.replace(/More info|Apply now|Open date:.*|Position open through:.*/gi, "").trim();
        // Extract title after "Position NNNNN" pattern
        const match = text.match(/Position\s+\d+\s+(.+?)(?:\s+(?:Seattle|Tacoma|Bothell|WA|Open date|$))/i);
        const title = match ? clean(match[1]) : clean(text.split(/\n/)[0]);

        if (title && title.length > 5) {
          seen.add(href);
          out.push({ title, url: href });
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

    const jobs = (items || []).map((x) => ({
      title: normalizeUwTitle(x.title),
      url: x.url,
      source: sourceName,
      category: "Faculty",
      college: campusName,
      location: null,
      description: null,
    }));

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    return jobs;
  } finally {
    await page.close().catch(() => {});
  }
}
