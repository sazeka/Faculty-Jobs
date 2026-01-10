// server.js
// One-file scraper + optional local API server.
// Designed for GitHub Actions (Option B) by exporting scrapeAllJobsStandalone()
// and ONLY starting Express when run directly: `node server.js`

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { chromium } from "playwright";

/* ============================== CONFIG ============================== */

const PORT = process.env.PORT || 3000;

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
  { campus: "The College of New Jersey", type: "taleo", url: "https://tcnj.taleo.net/careersection/00_ex_faculty/jobsearch.ftl?lang=en" },
  { campus: "Kean University", type: "workday", url: "https://kean.wd503.myworkdayjobs.com/Kean?jobFamilyGroup=367abbb2b3b80136908699f7a90d56ac" },
  { campus: "Montclair State University", type: "workday", url: "https://montclair.wd1.myworkdayjobs.com/JobOpportunities?jobFamilyGroup=0c89f3515631109bdddc974975dae955" },
  { campus: "Rutgers, The State University of New Jersey", type: "rutgers", url: "https://jobs.rutgers.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&435=&225=&query_position_type_id%5B%5D=6&2182%5B%5D=3&commit=Search" },
  { campus: "New Jersey City University", type: "taleo", url: "https://phe.tbe.taleo.net/phe03/ats/careers/v2/searchResults?org=NJCU&cws=41" },
  { campus: "New Jersey Institute of Technology", type: "csod", url: "https://njit.csod.com/ux/ats/careersite/1/home?c=njit&cfdd[0][id]=71&cfdd[0][options][0]=35" },
  { campus: "Ramapo College of New Jersey", type: "schooljobs", url: "https://www.schooljobs.com/careers/ramapo?keywords=faculty" },
  { campus: "Stockton University", type: "stockton", url: "https://employment.stockton.edu/jobs/search?page=1&employment_type_uids%5B%5D=fbab94e63ae2bac64f314b271869e32d&query=" },
  { campus: "William Paterson University", type: "workday", url: "https://wpunj.wd1.myworkdayjobs.com/ext?jobFamilyGroup=beb7f5bb680310016e27a7df06100000" },
];

// Claremont Colleges
const CLAREMONT_CAMPUSES = [
  { campus: "Pomona College", type: "static", url: "https://www.pomona.edu/administration/academic-dean/general/faculty-jobs" },
  { campus: "Claremont Graduate University", type: "static", url: "https://www.cgu.edu/employment-opportunities/faculty-jobs/" },
  { campus: "Scripps College", type: "static", url: "https://www.scrippscollege.edu/hr/faculty" },
  { campus: "Claremont McKenna College", type: "cmc", url: "https://webapps.cmc.edu/jobs/faculty/faculty_opening.php" },
  { campus: "Harvey Mudd College", type: "static", url: "https://www.hmc.edu/dean-of-faculty/available-faculty-positions/" },
  { campus: "Keck Graduate Institute", type: "workday", url: "https://theclaremontcolleges.wd1.myworkdayjobs.com/en-US/KGI_Careers?jobFamilyGroup=c556221e536801fcd7010014ef742f7a&timeType=9df8dc300a421048ab2494d9bae91551" },
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

// ✅ Write jobs.json for BOTH local (public) and GitHub Pages (docs)
try {
  const targets = ["public", "docs"];
  for (const dir of targets) {
    const outDir = path.join(__dirname, dir);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "jobs.json"),
      JSON.stringify(data, null, 2),
      "utf-8"
    );
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
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });

    const tasks = [
      { name: "CUNY", fn: () => scrapeCunyFaculty(context) },
      { name: "CT State", fn: () => scrapeCtFacultyTeaching(context) },
      { name: "CSU", fn: () => scrapeCsuFaculty(context) },
      { name: "UMass", fn: () => scrapeUmassAll(context) },
      { name: "UC", fn: () => scrapeUcAll(context) },
      { name: "NJ", fn: () => scrapeNjAll(context) },
      { name: "Claremont Colleges", fn: () => scrapeClaremontAll(context) },
    ];

    const settled = await Promise.allSettled(tasks.map((t) => t.fn()));
    const jobs = [];

    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      const name = tasks[i].name;
      if (r.status === "fulfilled") {
        if (Array.isArray(r.value)) jobs.push(...r.value);
      } else {
        console.error(`❌ ${name} scrape failed:`, r.reason?.message || r.reason);
      }
    }

    jobs.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    return {
      scrapedAt: new Date().toISOString(),
      count: jobs.length,
      jobs,
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


// Playwright occasionally throws "Execution context was destroyed" when a page
// auto-navigates (redirects / SPA transitions) while we are evaluating.
// This helper retries a few times and waits for the page to settle.
async function safeEvaluate(page, fn, { retries = 4, settleMs = 600 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      // If a navigation is in progress, wait a moment.
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      const v = await page.evaluate(fn);
      return v;
    } catch (e) {
      const msg = String(e?.message || e);
      lastErr = e;
      const likely =
        msg.includes("Execution context was destroyed") ||
        msg.includes("Cannot find context with specified id") ||
        msg.includes("Target closed") ||
        msg.includes("Navigation") ||
        msg.includes("frame was detached");
      if (!likely) throw e;

      // Let the page finish whatever it is doing (redirect, SPA transition, etc.)
      await page.waitForTimeout(settleMs);
    }
  }
  throw lastErr;
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

  await page.getByRole("button", { name: /apply|filter|search|submit|go|update/i }).first().click().catch(() => {});
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

  // Some CSU pages redirect to /search/; wait for either job links or listing container.
  await page.waitForTimeout(800);

  const jobs = await scrapeEnUsFilterSite(page, {
    source: "CSU",
    campus: null,
    category: "Instructional Faculty – Tenured/Tenure-Track",
  });

  console.log(`CSU listing scraped: ${jobs.length}`);

  // Enrich CSU jobs with college + location from detail pages (best-effort)
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
            getFromDtDd(["work location"]) ||
            getFromDtDd(["location"]) ||
            getFromDtDd(["city"]) ||
            null;

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
                const nodes = Array.isArray(j) ? j : (j?.["@graph"] ? j["@graph"] : [j]);
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
        await page.waitForTimeout(800);

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

  // These sites often do a fast redirect or SPA route update after the initial HTML arrives.
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(900);

  // Helper: pull all job links currently visible
  async function collectBatch() {
    return await safeEvaluate(page, () => {
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

        // Require a "job-ish" URL (avoid pagination links, nav links, etc.)
        const u = new URL(url);
        const p = u.pathname || "";
        const isJob =
          /\/job\//i.test(p) ||
          /\/jobs\//i.test(p) ||
          /\/job\/[A-Za-z0-9_-]+/i.test(p) ||
          /job=\d+/i.test(u.search);

        if (!isJob) continue;

        let title = clean(a.textContent);

        // Some sites render "View job" links; prefer nearby headings
        if (!title || title.length < 4 || /view job|apply/i.test(title)) {
          const container = a.closest("li, article, div, tr") || a.parentElement;
          const h = container?.querySelector?.("h1,h2,h3,h4,.job-title,.title,strong");
          const ht = clean(h?.textContent);
          if (ht && ht.length > 4) title = ht;
        }

        if (!title || title.length < 4) continue;

        out.push({ title, url });
      }

      // Dedup inside the page context
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

  // Helper: find next page URL ("More Jobs" on CSU / rel=next / Next)
  async function findNextUrl() {
    // CSU: "More Jobs" link to next page
    const more = page
      .locator('a.more-link.button[title="More Jobs"], a[title*="More Jobs" i]')
      .first();
    if ((await more.count().catch(() => 0)) > 0 && (await more.isVisible().catch(() => false))) {
      const href = await more.getAttribute("href").catch(() => null);
      if (href) return new URL(href, page.url()).toString();
    }

    // Generic rel=next
    const relNext = page.locator('a[rel="next"]').first();
    if ((await relNext.count().catch(() => 0)) > 0 && (await relNext.isVisible().catch(() => false))) {
      const href = await relNext.getAttribute("href").catch(() => null);
      if (href) return new URL(href, page.url()).toString();
    }

    // Text-based Next
    const next = page.locator('a:has-text("Next"), button:has-text("Next")').first();
    if ((await next.count().catch(() => 0)) > 0 && (await next.isVisible().catch(() => false))) {
      const tag = await next.evaluate((el) => el.tagName).catch(() => "A");
      if (tag === "A") {
        const href = await next.getAttribute("href").catch(() => null);
        if (href) return new URL(href, page.url()).toString();
      }
    }

    // Some sites show explicit pagination like ?page=2
    const guess = await safeEvaluate(page, () => {
      const a =
        document.querySelector('a[aria-label*="Next" i]') ||
        Array.from(document.querySelectorAll("a")).find((x) =>
          (/^\s*next\s*$/i).test((x.textContent || "").trim())
        );
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

    // Navigate using goto (avoids click handlers that sometimes trigger in-page rerenders)
    await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);
  }

  return jobs
    .map((j) => ({
      title: clean(j.title),
      url: j.url,
      source,
      category,
      college: campus, // chip for UMass; null for CSU
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

  // Remove fellow/fellowship (global UC requirement)
  return uniqByUrl(out).filter((j) => !omitUcFellowships(j.title));
}

async function scrapeApRecruitCampus(page, campusName) {
  const jobs = [];
  const seen = new Set();

  // AP Recruit often paginates; try to harvest links repeatedly while "Next" exists.
  for (let safety = 0; safety < 120; safety++) {
    const batch = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); }
        catch { return null; }
      };

      const out = [];
      // Job pages are usually /apply/JPFxxxxx or similar
      const anchors = Array.from(document.querySelectorAll('a[href*="/apply/"], a[href*="JPF"], a[href*="/JPF"]'));

      for (const a of anchors) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;
        if (!/JPF\d+/i.test(url)) continue;

        const container = a.closest("tr, li, article, div") || a.parentElement;

        // Title can be polluted with apply-by text; prefer headings in container
        let title = clean(a.textContent);

        const h =
          container?.querySelector?.("h1,h2,h3,h4,.title,.job-title,strong") ||
          null;
        const ht = clean(h?.textContent);

        const isBadTitle = (t) =>
          !t ||
          t.length < 4 ||
          /^apply by\b/i.test(t) ||
          /open\s+\w{3}\s+\d{1,2},\s+\d{4}/i.test(t);

        if (isBadTitle(title) && ht && !isBadTitle(ht)) title = ht;

        // If still bad, try the first strong/heading text in container that isn't apply-by
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

      // Dedup inside evaluate
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

    // Try click "Next" if exists
    const next = page.locator('a[rel="next"], a:has-text("Next"), button:has-text("Next")').first();
    if ((await next.count().catch(() => 0)) > 0 && (await next.isVisible().catch(() => false))) {
      // Prefer href navigation if anchor
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
        // stop if nothing new
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
    college: campusName, // chip
    location: null,
    description: null,
  }));
}

/* ============================== NJ ============================== */

async function scrapeNjAll(context) {
  const tasks = NJ_CAMPUSES.map(({ campus, type, url }) =>
    (async () => {
      try {
        if (type === "taleo") return await scrapeNjTaleo(context, url, campus);
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

async function scrapeNjTaleo(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);

    const jobs = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => { try { return new URL(href, location.href).toString(); } catch { return null; } };

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
    console.log(`${campusName} NJ listings scraped: ${filtered.length}`);
    return filtered.map((j) => toNjJob(clean(j.title), j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeNjWorkday(context, startUrl, campusName) {
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
        const abs = (href) => { try { return new URL(href, location.href).toString(); } catch { return null; } };

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
    console.log(`${campusName} NJ listings scraped: ${filtered.length}`);
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
        const abs = (href) => { try { return new URL(href, location.href).toString(); } catch { return null; } };

        const deptFromContainer = (container) => {
          if (!container) return null;

          const sels = [
            '[data-label*="Department" i]',
            '[aria-label*="Department" i]',
            ".department", ".dept", ".org", ".organization",
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

async function scrapeNjCsod(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1000);

    const jobs = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => { try { return new URL(href, location.href).toString(); } catch { return null; } };

      const out = [];
      const seen = new Set();

      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        const title = clean(a.textContent);
        if (!url || !title || title.length < 4) continue;

        const ok = /\/job\//i.test(url) || /ats\/job/i.test(url) || (/career/i.test(url) && /job/i.test(url));
        if (!ok) continue;

        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title, url });
      }
      return out;
    });

    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} NJ listings scraped: ${filtered.length}`);
    return filtered.map((j) => toNjJob(clean(j.title), j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeNjSchoolJobs(context, startUrl, campusName) {
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
        const abs = (href) => { try { return new URL(href, location.href).toString(); } catch { return null; } };

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

      const nextUrl = await getSchoolJobsNextPageUrl(page, currentUrl);
      if (!nextUrl || nextUrl === currentUrl) break;
      currentUrl = nextUrl;
    }

    const filtered = jobs.filter((j) => looksFacultyish(j.title)).filter((j) => !omitAdjunct(j.title));
    console.log(`${campusName} NJ listings scraped: ${filtered.length}`);
    return filtered.map((j) => toNjJob(clean(j.title), j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

async function getSchoolJobsNextPageUrl(page, currentUrl) {
  const nextA = page.locator('a[rel="next"], a[aria-label*="Next" i], a:has-text("Next")').first();
  if ((await nextA.count().catch(() => 0)) > 0) {
    const href = await nextA.getAttribute("href").catch(() => null);
    if (href) return new URL(href, page.url()).toString();
  }

  const href = await page.evaluate(() => {
    const cur =
      document.querySelector('a[aria-current="page"]') ||
      document.querySelector("li.active a") ||
      document.querySelector("li.selected a");
    let curN = 1;
    if (cur) {
      const t = (cur.textContent || "").trim();
      const m = t.match(/^(\d+)$/);
      if (m) curN = Number(m[1]);
    }
    const want = curN + 1;

    const direct =
      document.querySelector(`a[aria-label="Go to Page ${want}"]`) ||
      document.querySelector(`a[aria-label="Go to page ${want}"]`);
    return direct ? direct.getAttribute("href") : null;
  });

  if (href) {
    const nextUrl = new URL(href, page.url()).toString();
    if (nextUrl !== currentUrl) return nextUrl;
  }
  return null;
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
        const abs = (href) => { try { return new URL(href, location.href).toString(); } catch { return null; } };

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

/* ============================== CLAREMONT COLLEGES ============================== */

async function scrapeClaremontAll(context) {
  const tasks = CLAREMONT_CAMPUSES.map(({ campus, type, url }) =>
    (async () => {
      try {
        if (type === "static") return await scrapeClaremontStatic(context, url, campus);
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
      const abs = (href) => { try { return new URL(href, location.href).toString(); } catch { return null; } };
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
      const abs = (href) => { try { return new URL(href, location.href).toString(); } catch { return null; } };

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
  // Same Workday pagination helpers as NJ
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
        const abs = (href) => { try { return new URL(href, location.href).toString(); } catch { return null; } };

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

      return { title: title || "(No title found)", description, college };
    });

    return { title: job.title, description: job.description, college: job.college, url };
  } finally {
    await page.close().catch(() => {});
  }
}
