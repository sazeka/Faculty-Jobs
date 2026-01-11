// server.js
// One-file scraper + optional local API server.
// Exports scrapeAllJobsStandalone() for GitHub Actions.
// Starts Express only when run directly: `node server.js`

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { chromium } from "playwright";

/* ============================== CONFIG ============================== */

const PORT = process.env.PORT || 3000;

const MAX_PARALLEL_CAMPUSES = Number(process.env.MAX_PARALLEL_CAMPUSES || 4);
const MAX_PARALLEL_SYSTEMS = Number(process.env.MAX_PARALLEL_SYSTEMS || 4);

const CUNY_URL = "https://cuny.jobs/job-category/faculty/jobs/";
const CT_URL = "https://www.ct.edu/hr/jobs";

const CSU_URL =
  "https://csucareers.calstate.edu/en-us/filter/?=&leftNavSearchFormQuery=&=&search=&search-keyword=&job-mail-subscribe-privacy=agree&work-type=instructional%20faculty%20%e2%80%93%20tenured%2ftenure-track&category=unit%203%20-%20cfa%20-%20california%20faculty%20association&job-mail-subscribe-privacy=agree";

// UMass (same “en-us/filter” platform style as CSU)
const UMASS_CAMPUSES = [
  {
    campus: "UMass Amherst",
    url: "https://careers.umass.edu/amherst/en-us/filter/?job-mail-subscribe-privacy=agree&search-keyword=&work-type=faculty%20full%20time",
  },
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

// UC (AP Recruit)
const UC_CAMPUSES = [
  { campus: "UC Berkeley", url: "https://aprecruit.berkeley.edu/apply" },
  { campus: "UCLA", url: "https://recruit.apo.ucla.edu/apply" },
  { campus: "UC San Diego", url: "https://apol-recruit.ucsd.edu/apply" },
  { campus: "UC Santa Barbara", url: "https://recruit.ap.ucsb.edu/apply" },
  { campus: "UC Davis", url: "https://recruit.ucdavis.edu/apply" },
  { campus: "UC Irvine", url: "https://recruit.ap.uci.edu/apply" },
  { campus: "UC Riverside", url: "https://aprecruit.ucr.edu/apply" },
  { campus: "UC Santa Cruz", url: "https://recruit.ucsc.edu/apply" },
  { campus: "UC Merced", url: "https://aprecruit.ucmerced.edu/apply" },
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


// NY (State University of New York – SUNY)
const NY_SUNY = {
  campus: "State University of New York (SUNY)",
  type: "suny",
  url: "https://www.suny.edu/careers/employment/index.cfm?s=y",
};



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
];


// ME (Maine)
const ME_CAMPUSES = [
  {
    campus: "University of Maine System",
    type: "oracle-cx",
    url: "https://fa-ewca-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs?lastSelectedFacet=CATEGORIES&selectedCategoriesFacet=300000014335735",
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
const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;
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

    const tasks = [
      { name: "CUNY", fn: () => scrapeCunyFaculty(context) },
      { name: "CT State", fn: () => scrapeCtFacultyTeaching(context) },
      { name: "AZ", fn: () => scrapeAzAll(context) },
      { name: "CSU", fn: () => scrapeCsuFaculty(context) },
      { name: "UMass", fn: () => scrapeUmassAll(context) },
      { name: "UC", fn: () => scrapeUcAll(context) },
      { name: "NJ", fn: () => scrapeNjAll(context) },
            { name: "NC", fn: () => scrapeNcAll(context) },
      { name: "DE", fn: () => scrapeDeAll(context) },
      { name: "RI", fn: () => scrapeRiAll(context) },
{ name: "PA", fn: () => scrapePaAll(context) },
      { name: "Claremont Colleges", fn: () => scrapeClaremontAll(context) },
      { name: "NY (SUNY)", fn: () => scrapeNySuny(context) },
      { name: "OR", fn: () => scrapeOrAll(context) },
      { name: "WA", fn: () => scrapeWaAll(context) },
      { name: "ME", fn: () => scrapeMeAll(context) },

    ];

    const results = await mapWithConcurrency(tasks, MAX_PARALLEL_SYSTEMS, async (t) => {
      try {
        return await t.fn();
      } catch (e) {
        console.error(`❌ ${t.name} scrape failed:`, e?.message || e);
        return null;
      }
    });

    const jobs = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (Array.isArray(r)) jobs.push(...r);
    }

    const facultyOnly = jobs.filter((j) => looksFacultyish(j.title));

    facultyOnly.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    return {
      scrapedAt: new Date().toISOString(),
      count: facultyOnly.length,
      jobs: facultyOnly,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ============================== HELPERS ============================== */

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
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
  return /adjunct/i.test(String(title || ""));
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
  return (
    s.includes("faculty") ||
    s.includes("professor") ||
    s.includes("lecturer") ||
    s.includes("instructor") ||
    s.includes("assistant professor") ||
    s.includes("associate professor") ||
    s.includes("chair")
  );
}

/* ============================== CUNY ============================== */

async function scrapeCunyFaculty(context) {
  const page = await context.newPage();
  await page.goto(CUNY_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);

  await expandToAllCunyJobs(page);

  const links = await page.evaluate(() => {
    const out = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href");
      if (!href) continue;
      try {
        const u = new URL(href, location.href);
        if (/\/job\/?$/i.test(u.pathname)) out.add(u.toString());
      } catch {}
    }
    return Array.from(out);
  });

  console.log(`CUNY discovered links: ${links.length}`);

  const jobs = await fetchAllJobDetails(context, links, "CUNY", 6);
  return jobs
    .filter((j) => j.title && j.title !== "(No title found)")
    .filter((j) => !omitAdjunct(j.title));
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
    return {
      ...j,
      college: j.college || d?.college || null,
      location: j.location || d?.location || null,
    };
  });
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
            getFromDtDd(["work location"]) || getFromDtDd(["location"]) || getFromDtDd(["city"]) || null;

          const college =
            getFromDtDd(["campus"]) ||
            getFromDtDd(["organization"]) ||
            getFromDtDd(["department"]) ||
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

          return { location, college: college || orgFromLd || null };
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

/* ===== Generic “en-us/filter” site scraper (CSU/UMass style) ===== */

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

        const h = container?.querySelector?.("h1,h2,h3,h4,.title,.job-title,strong") || null;
        const ht = clean(h?.textContent);

        const isBadTitle = (t) =>
          !t ||
          t.length < 4 ||
          /^apply by\b/i.test(t) ||
          /open\s+\w{3}\s+\d{1,2},\s+\d{4}/i.test(t);

        if (isBadTitle(title) && ht && !isBadTitle(ht)) title = ht;

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

async function scrapeNjAll(context) {
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

      const out = [];
      const seen = new Set();

      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;

        const ok =
          /jobdetail\.ftl/i.test(url) ||
          /\/ats\/careers\//i.test(url) ||
          (/careersection/i.test(url) && /job/i.test(url));
        if (!ok) continue;

        const title = clean(a.textContent);
        if (!title || title.length < 4) continue;
        if (/search|advanced|return|back|home|login|language|accessibility/i.test(title)) continue;

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

async function scrapeNjWorkday(context, startUrl, campusName, sourceLabel = "NJ") {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-automation-id="jobTitle"]', { timeout: 60_000 });

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
      await page.waitForSelector('[data-automation-id="jobTitle"]', { timeout: 60_000 }).catch(() => {});
    }

    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
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
    await page.waitForTimeout(1000);

    
    // CSOD often lazy-loads results behind a "Load more" button.
    // Click it a few times to surface more job cards/links.
    for (let i = 0; i < 40; i++) {
      const btn = page.locator('button:has-text("Load more"), button:has-text("Show more"), button[aria-label*="Load" i], button[aria-label*="More" i]').first();
      if ((await btn.count().catch(() => 0)) === 0) break;
      if (!(await btn.isVisible().catch(() => false))) break;
      const before = await page.evaluate(() => document.querySelectorAll("a[href]").length).catch(() => 0);
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(900);
      const after = await page.evaluate(() => document.querySelectorAll("a[href]").length).catch(() => 0);
      if (after <= before) break;
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
    console.log(`${campusName} NJ listings scraped: ${filtered.length}`);
    return filtered.map((j) => toNjJob(clean(j.title), j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeNjStockton(context, startUrl, campusName) {
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
    console.log(`${campusName} NJ listings scraped: ${filtered.length}`);
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


async function scrapeRiAll(context) {
  const results = await mapWithConcurrency(
    RI_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "RI");
        if (type === "peopleadmin-dept") return await scrapePeopleAdminWithDept(context, url, campus, "RI");
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




/* ============================== PA ============================== */


async function scrapePaAll(context) {
  const results = await mapWithConcurrency(
    PA_CAMPUSES,
    MAX_PARALLEL_CAMPUSES,
    async ({ campus, type, url }) => {
      try {

if (type === "schooljobs") return await scrapeSchoolJobsAs(context, url, campus, "PA");
if (type === "csod") return await scrapeCsodAs(context, url, campus, "PA");
if (type === "nau-search") return await scrapeNauSearch(context, url, campus, "AZ");
        if (type === "peopleadmin") return await scrapePeopleAdminAs(context, url, campus, "PA");

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
      .map((j) => ({
        title: clean(j.title),
        url: j.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      }))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} PA listings scraped: ${out.length}`);
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
      .map((j) => ({
        title: clean(j.title),
        url: j.url,
        source: sourceName,
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      }))
      .filter((j) => !omitAdjunct(j.title));

    console.log(`${campusName} ${sourceName} listings scraped: ${out.length}`);
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}



/* ============================== CLAREMONT COLLEGES ============================== */

async function scrapeClaremontAll(context) {
  const tasks = CLAREMONT_CAMPUSES.map(({ campus, type, url }) =>
    (async () => {
      try {
        if (type === "static") return await scrapeStaticLinksAs(context, url, campus, "OR");
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
          /job|faculty|professor|lecturer|instructor|assistant|associate|chair|director|tenure/i.test(t) ||
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
          .filter((t) => /faculty|professor|lecturer|instructor|assistant|associate|chair|director|tenure/i.test(t));

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
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-automation-id="jobTitle"]', { timeout: 60_000 });

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
      await page.waitForSelector('[data-automation-id="jobTitle"]', { timeout: 60_000 }).catch(() => {});
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


async function scrapeNySuny(context) {
  const page = await context.newPage();
  try {
    await page.goto(NY_SUNY.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);

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
        if (!/employment|jobs|postings|careers/i.test(url)) continue;

        const title = clean(a.textContent);
        if (!title || title.length < 6) continue;
        if (seen.has(url)) continue;
        seen.add(url);

        out.push({
          title,
          url,
          source: "NY",
          category: "Faculty",
          college: "SUNY",
          location: null,
          description: null,
        });
      }
      return out;
    });

    console.log(`SUNY listings scraped: ${jobs.length}`);
    return jobs;
  } finally {
    await page.close().catch(() => {});
  }
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
          try { return new URL(href, location.href).toString(); } catch { return null; }
        };

        const out = [];
        for (const a of Array.from(document.querySelectorAll('a[href]'))) {
          const href = abs(a.getAttribute("href"));
          if (!href) continue;
          if (!/\/jobs\//i.test(href) || /\/jobs\/search/i.test(href)) continue;

          let title = clean(a.textContent);
          // Some cards have "Read more" links; try heading inside the card
          if (!title || title.length < 6 || /read more/i.test(title)) {
            const card = a.closest("article,li,div");
            const h = card?.querySelector("h1,h2,h3");
            const ht = clean(h?.textContent);
            if (ht) title = ht;
          }

          if (!title || title.length < 6) continue;
          out.push({ title, url: href });
        }
        return out;
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
          location: null,
          description: null,
        });
        addedThisPage++;
      }

      // stop if this page produced no new jobs
      if (addedThisPage === 0) break;
    }

    console.log(`${campusName} ${sourceName} listings scraped: ${jobs.length}`);
    try {
      const sample = (items || []).slice(0, 5);
      for (const x of sample) {
        console.log("UW sample titles (raw -> cleaned):", x.title, "=>", normalizeUwTitle(x.title));
      }
    } catch {}

    return uniqByUrl(jobs);
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
        return [];
      } catch (e) {
        console.error(`❌ ${campus} ME scrape failed:`, e?.message || e);
        return [];
      }
    }
  );

  const jobs = results.flatMap((x) => (Array.isArray(x) ? x : []));
  return uniqByUrl(jobs).filter((j) => !omitAdjunct(j.title));
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
    const items =
      (json && Array.isArray(json.items) && json.items) ||
      (json && Array.isArray(json.requisitionList) && json.requisitionList) ||
      (json && Array.isArray(json.RequisitionList) && json.RequisitionList) ||
      (json && Array.isArray(json.data) && json.data) ||
      [];

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

      const heading = Array.from(document.querySelectorAll("h1,h2,h3")).find((h) =>
        /Academic Jobs/i.test(clean(h.textContent))
      );

      let root = document.querySelector("main") || document.body;
      if (heading) {
        const section = heading.closest("section, article, main, div") || root;
        root = section;
      }

      const ul =
        root.querySelector("ul") ||
        document.querySelector("main ul") ||
        document.querySelector("ul");

      if (!ul) return [];

      // Walk UL children; postings are rendered as LI + sibling anchors ("More info", "Apply now")
      const children = Array.from(ul.children);
      const out = [];

      let pendingTitle = null;

      const flush = (url) => {
        if (!pendingTitle || !url) return;
        out.push({ title: pendingTitle, url });
        pendingTitle = null;
      };

      for (const el of children) {
        const tag = (el.tagName || "").toLowerCase();
        const text = clean(el.textContent);

        if (tag === "li" && /\bPosition\s+\d+\b/i.test(text)) {
          pendingTitle = text;
          continue;
        }

        if (pendingTitle && tag === "a") {
          const label = clean(el.textContent).toLowerCase();
          const href = abs(el.getAttribute("href"));
          if (!href) continue;

          if (label === "more info") {
            flush(href);
            continue;
          }
          if (label === "apply now" || /interfolio/i.test(href)) {
            flush(href);
            continue;
          }
        }
      }

      const seen = new Set();
      return out.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
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

