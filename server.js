// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 3000;

/* ============================== SOURCES ============================== */
const CUNY_URL = "https://cuny.jobs/job-category/faculty/jobs/";
const CT_URL = "https://www.ct.edu/hr/jobs";

const CSU_URL =
  "https://csucareers.calstate.edu/en-us/filter/?=&leftNavSearchFormQuery=&=&search=&search-keyword=&job-mail-subscribe-privacy=agree&work-type=instructional%20faculty%20%e2%80%93%20tenured%2ftenure-track&category=unit%203%20-%20cfa%20-%20california%20faculty%20association&job-mail-subscribe-privacy=agree";

/* ============================== UMass ============================== */
const UMASS_AMHERST_URL =
  "https://careers.umass.edu/amherst/en-us/filter/?job-mail-subscribe-privacy=agree&search-keyword=&work-type=faculty%20full%20time";
const UMASS_BOSTON_URL =
  "https://employmentopportunities.umb.edu/boston/en-us/filter/?search-keyword=&work-type=faculty%20full%20time&job-mail-subscribe-privacy=agree";
const UMASS_DARTMOUTH_URL =
  "https://careers.umassd.edu/en-us/filter/?search-keyword=&job-mail-subscribe-privacy=agree&work-type=faculty%20full%20time";
const UMASS_LOWELL_URL =
  "https://explorejobs.uml.edu/lowell/en-us/filter/?job-mail-subscribe-privacy=agree&search-keyword=&work-type=faculty%20full%20time";

/* ================================ UC =============================== */
const UC_BERKELEY_URL = "https://aprecruit.berkeley.edu/apply";
const UCLA_URL = "https://recruit.apo.ucla.edu/apply";
const UCSD_URL = "https://apol-recruit.ucsd.edu/apply";
const UCSB_URL = "https://recruit.ap.ucsb.edu/apply";
const UC_DAVIS_URL = "https://recruit.ucdavis.edu/apply";
const UC_IRVINE_URL = "https://recruit.ap.uci.edu/apply";
const UC_RIVERSIDE_URL = "https://aprecruit.ucr.edu/apply";
const UC_SANTA_CRUZ_URL = "https://recruit.ucsc.edu/apply";
const UC_MERCED_URL = "https://aprecruit.ucmerced.edu/apply";

/* ================================ NJ =============================== */
// original NJ
const NJ_TCNJ_URL =
  "https://tcnj.taleo.net/careersection/00_ex_faculty/jobsearch.ftl?lang=en";
const NJ_KEAN_URL =
  "https://kean.wd503.myworkdayjobs.com/Kean?jobFamilyGroup=367abbb2b3b80136908699f7a90d56ac";
const NJ_MONTCLAIR_URL =
  "https://montclair.wd1.myworkdayjobs.com/JobOpportunities?jobFamilyGroup=0c89f3515631109bdddc974975dae955";
const NJ_RUTGERS_URL =
  "https://jobs.rutgers.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&435=&225=&query_position_type_id%5B%5D=6&2182%5B%5D=3&commit=Search";

// added NJ
const NJ_NJCU_URL =
  "https://phe.tbe.taleo.net/phe03/ats/careers/v2/searchResults?org=NJCU&cws=41";
const NJ_NJIT_URL =
  "https://njit.csod.com/ux/ats/careersite/1/home?c=njit&cfdd[0][id]=71&cfdd[0][options][0]=35";
const NJ_RAMAPO_URL =
  "https://www.schooljobs.com/careers/ramapo?keywords=faculty";
const NJ_STOCKTON_URL =
  "https://employment.stockton.edu/jobs/search?page=1&employment_type_uids%5B%5D=fbab94e63ae2bac64f314b271869e32d&query=";
const NJ_WILLIAM_PATERSON_URL =
  "https://wpunj.wd1.myworkdayjobs.com/ext?jobFamilyGroup=beb7f5bb680310016e27a7df06100000";

/* ------------------------ absolute paths ------------------------ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

/* --------------------------- cache ------------------------------ */
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, data: null };

/* ---------------------------- harden ---------------------------- */
process.on("unhandledRejection", (err) => console.error("❌ UnhandledRejection:", err?.message || err));
process.on("uncaughtException", (err) => console.error("❌ UncaughtException:", err?.message || err));

/* ---------------------------- API ------------------------------- */
app.get("/api/jobs", async (req, res) => {
  try {
    const refresh = req.query.refresh === "1";

    if (!refresh && cache.data && Date.now() - cache.at < CACHE_TTL_MS) {
      return res.json({ cached: true, ...cache.data });
    }

    const data = await scrapeAllJobs();
    cache = { at: Date.now(), data };
    res.json({ cached: false, ...data });
  } catch (err) {
    console.error("❌ /api/jobs:", err);
    res.status(500).json({
      error: "Scrape failed",
      details: String(err?.message || err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`   Refresh scrape: http://localhost:${PORT}/api/jobs?refresh=1`);
});

/* ================================================================= */
/* ============================ SCRAPE ============================== */
/* ================================================================= */

async function scrapeAllJobs() {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });

    const tasks = [
      // core
      { name: "CUNY", fn: () => scrapeCunyFaculty(context) },
      { name: "CT State", fn: () => scrapeCtFacultyTeaching(context) },
      { name: "CSU", fn: () => scrapeCsuFaculty(context) },

      // UMass
      { name: "UMass Amherst", fn: () => scrapeUmassCampus(context, UMASS_AMHERST_URL, "UMass Amherst") },
      { name: "UMass Boston", fn: () => scrapeUmassCampus(context, UMASS_BOSTON_URL, "UMass Boston") },
      { name: "UMass Dartmouth", fn: () => scrapeUmassCampus(context, UMASS_DARTMOUTH_URL, "UMass Dartmouth") },
      { name: "UMass Lowell", fn: () => scrapeUmassCampus(context, UMASS_LOWELL_URL, "UMass Lowell") },

      // UC
      { name: "UC Berkeley", fn: () => scrapeUcCampus(context, UC_BERKELEY_URL, "UC Berkeley") },
      { name: "UCLA", fn: () => scrapeUcCampus(context, UCLA_URL, "UCLA") },
      { name: "UC San Diego", fn: () => scrapeUcCampus(context, UCSD_URL, "UC San Diego") },
      { name: "UC Santa Barbara", fn: () => scrapeUcCampus(context, UCSB_URL, "UC Santa Barbara") },
      { name: "UC Davis", fn: () => scrapeUcCampus(context, UC_DAVIS_URL, "UC Davis") },
      { name: "UC Irvine", fn: () => scrapeUcCampus(context, UC_IRVINE_URL, "UC Irvine") },
      { name: "UC Riverside", fn: () => scrapeUcCampus(context, UC_RIVERSIDE_URL, "UC Riverside") },
      { name: "UC Santa Cruz", fn: () => scrapeUcCampus(context, UC_SANTA_CRUZ_URL, "UC Santa Cruz") },
      { name: "UC Merced", fn: () => scrapeUcCampus(context, UC_MERCED_URL, "UC Merced") },

      // NJ (original)
      { name: "NJ TCNJ", fn: () => scrapeNjTaleo(context, NJ_TCNJ_URL, "The College of New Jersey") },
      { name: "NJ Kean", fn: () => scrapeNjWorkday(context, NJ_KEAN_URL, "Kean University") },
      { name: "NJ Montclair", fn: () => scrapeNjWorkday(context, NJ_MONTCLAIR_URL, "Montclair State University") },
      { name: "NJ Rutgers", fn: () => scrapeNjRutgers(context, NJ_RUTGERS_URL, "Rutgers University") },

      // NJ (added)
      { name: "NJ NJCU", fn: () => scrapeNjTaleo(context, NJ_NJCU_URL, "New Jersey City University") },
      { name: "NJ NJIT", fn: () => scrapeNjCsod(context, NJ_NJIT_URL, "New Jersey Institute of Technology") },
      { name: "NJ Ramapo", fn: () => scrapeNjSchoolJobs(context, NJ_RAMAPO_URL, "Ramapo College of New Jersey") },
      { name: "NJ Stockton", fn: () => scrapeNjStockton(context, NJ_STOCKTON_URL, "Stockton University") },
      { name: "NJ William Paterson", fn: () => scrapeNjWorkday(context, NJ_WILLIAM_PATERSON_URL, "William Paterson University") },
    ];

    const settled = await Promise.allSettled(tasks.map((t) => t.fn()));
    const results = settled.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      console.error(`⚠️ ${tasks[i].name} scrape failed:`, r.reason?.message || r.reason);
      return [];
    });

    const jobs = results
      .flat()
      .filter(Boolean)
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    return { scrapedAt: new Date().toISOString(), count: jobs.length, jobs };
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ================================================================= */
/* ============================== CUNY ============================== */
/* ================================================================= */

async function scrapeCunyFaculty(context) {
  const page = await context.newPage();
  try {
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
    return jobs.filter((j) => j.title && j.title !== "(No title found)");
  } finally {
    await page.close().catch(() => {});
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

/* ================================================================= */
/* =============================== CT =============================== */
/* ================================================================= */

async function scrapeCtFacultyTeaching(context) {
  const page = await context.newPage();
  try {
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
      if (rows.length) {
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
            location: null,
          });
        }
        return out;
      }

      return out;
    });

    console.log(`CT Faculty/Teaching results scraped: ${ctJobs.length}`);
    return ctJobs;
  } finally {
    await page.close().catch(() => {});
  }
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

/* ================================================================= */
/* =============================== CSU =============================== */
/* ================================================================= */

async function scrapeCsuFaculty(context) {
  const page = await context.newPage();
  try {
    await page.goto(CSU_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForCsuResults(page, 60_000);

    const jobs = [];
    const seen = new Set();

    // CSU paginates with: <a class="more-link button" title="More Jobs" href="...page=2...">
    for (let safety = 0; safety < 80; safety++) {
      const jobAnchors = page.locator('a[href*="/job/"]');
      const n = await jobAnchors.count().catch(() => 0);

      for (let i = 0; i < n; i++) {
        const a = jobAnchors.nth(i);
        const href = await a.getAttribute("href").catch(() => null);
        if (!href) continue;

        let abs;
        try {
          abs = new URL(href, page.url()).toString();
        } catch {
          continue;
        }

        let isJob = false;
        try {
          const p = new URL(abs).pathname;
          isJob = /\/job\/\d+(\/|$)/i.test(p);
        } catch {}
        if (!isJob) continue;

        if (seen.has(abs)) continue;

        const title = ((await a.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
        if (!title || title.length < 4) continue;

        seen.add(abs);
        jobs.push({
          title,
          url: abs,
          source: "CSU",
          category: "Instructional Faculty – Tenured/Tenure-Track",
          college: null,
          location: null,
          description: null,
        });
      }

      const more = page.locator('a.more-link.button[title="More Jobs"]').first();
      if ((await more.count()) === 0) break;

      const nextHref = await more.getAttribute("href").catch(() => null);
      if (!nextHref) break;

      const nextUrl = new URL(nextHref, page.url()).toString();
      if (nextUrl === page.url()) break;

      await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await waitForCsuResults(page, 60_000);
    }

    console.log(`CSU listing scraped: ${jobs.length}`);

    // enrich CSU jobs from detail pages (college + location)
    const detailMap = await fetchPhenomDetailsFromDetails(context, jobs.map((j) => j.url), 6);

    return jobs.map((j) => {
      const d = detailMap.get(j.url);
      return { ...j, college: d?.college || null, location: d?.location || null };
    });
  } finally {
    await page.close().catch(() => {});
  }
}

async function waitForCsuResults(page, timeoutMs = 60_000) {
  const start = Date.now();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(600);

  while (Date.now() - start < timeoutMs) {
    const jobCount = await page.locator('a[href*="/job/"]').count().catch(() => 0);
    if (jobCount > 0) return;

    const moreCount = await page.locator('a.more-link.button[title="More Jobs"]').count().catch(() => 0);
    if (moreCount > 0) return;

    await page.waitForTimeout(500);
  }

  throw new Error("CSU results did not render in time");
}

/* ================================================================= */
/* ============================== UMass ============================= */
/* ================================================================= */

async function scrapeUmassCampus(context, startUrl, campusName) {
  // one source category "UMass"; campus appears as chip via `college`
  return scrapePhenomFaculty(context, startUrl, "UMass", "Faculty – Full Time", campusName);
}

async function scrapePhenomFaculty(context, startUrl, sourceName, categoryLabel, campusName = null) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    await page.waitForSelector('a[href*="/job/"], a[href*="/jobs/"]', { timeout: 45_000 }).catch(() => {});

    const jobs = [];
    const seen = new Set();

    for (let safety = 0; safety < 120; safety++) {
      const anchors = page.locator('a[href*="/job/"], a[href*="/jobs/"]');
      const n = await anchors.count().catch(() => 0);

      for (let i = 0; i < n; i++) {
        const a = anchors.nth(i);

        const href = await a.getAttribute("href").catch(() => null);
        if (!href) continue;

        let abs;
        try {
          abs = new URL(href, page.url()).toString();
        } catch {
          continue;
        }

        let isJob = false;
        try {
          const p = new URL(abs).pathname;
          isJob = /\/job\/\d+(\/|$)/i.test(p) || /\/jobs\/\d+(\/|$)/i.test(p);
        } catch {}
        if (!isJob) continue;

        if (seen.has(abs)) continue;

        const title = ((await a.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
        if (!title || title.length < 4) continue;

        seen.add(abs);
        jobs.push({
          title,
          url: abs,
          source: sourceName, // "UMass"
          category: categoryLabel,
          college: campusName || null, // campus chip
          location: null,
          description: null,
        });
      }

      const more = page.locator('a.more-link.button[title="More Jobs"]').first();
      if ((await more.count()) === 0) break;

      const nextHref = await more.getAttribute("href").catch(() => null);
      if (!nextHref) break;

      const nextUrl = new URL(nextHref, page.url()).toString();
      if (nextUrl === page.url()) break;

      await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(600);
    }

    console.log(`${campusName || sourceName} listing scraped: ${jobs.length}`);

    // enrich from detail pages to get department + location
    const detailMap = await fetchPhenomDetailsFromDetails(context, jobs.map((j) => j.url), 6);

    return jobs.map((j) => {
      const d = detailMap.get(j.url);
      let college = j.college; // campus
      const dept = d?.college || null;

      // append dept/org if present and not duplicative
      if (college && dept && dept.toLowerCase() !== college.toLowerCase()) college = `${college} — ${dept}`;
      else if (!college && dept) college = dept;

      return { ...j, college, location: d?.location || null };
    });
  } finally {
    await page.close().catch(() => {});
  }
}

/* ================================================================= */
/* ================================ UC ============================== */
/* ================================================================= */
/**
 * UC = one source category ("UC"), each campus is a chip via `college`.
 * Fix listing titles (avoid JPF + deadline strings) and enrich from detail pages when needed.
 * EXCLUDE fellow / fellowship titles.
 */

async function scrapeUcCampus(context, startUrl, campusName) {
  return scrapeApRecruitCampus(context, startUrl, campusName);
}

function isUcFellowship(title) {
  const s = String(title || "").toLowerCase();
  return s.includes("fellowship") || /\bfellow\b/.test(s);
}
function looksLikeJpfTitle(t) {
  const s = String(t || "").trim();
  return /^JPF\s*\d{4,}$/i.test(s);
}
function looksLikeUcBadTitle(t) {
  const s = String(t || "").toLowerCase();
  if (!s) return false;
  if (s.includes("apply by")) return true;
  if (s.includes("for full consideration")) return true;
  if (s.includes("open ") && (s.includes("–") || s.includes("-"))) return true;
  return false;
}

async function scrapeApRecruitCampus(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1000);

    // listing scrape (avoid deadlines + fellowships early)
    const jobs = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return null;
        }
      };

      const looksLikeJpf = (t) => /^JPF\s*\d{4,}$/i.test(t || "");
      const isFellowship = (t) =>
        (t || "").toLowerCase().includes("fellowship") || /\bfellow\b/i.test(t || "");

      const looksLikeDeadline = (t) => {
        const s = String(t || "").toLowerCase();
        if (s.includes("apply by")) return true;
        if (s.includes("for full consideration")) return true;
        if (s.includes("open ") && (s.includes("–") || s.includes("-"))) return true;
        const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","sept","oct","nov","dec"];
        const hasMonth = months.some((m) => s.includes(m));
        const hasYear = /\b20\d{2}\b/.test(s);
        return hasMonth && hasYear;
      };

      const out = [];
      const seen = new Set();

      const table = document.querySelector("table");
      const headerTexts = table
        ? Array.from(table.querySelectorAll("thead th")).map((th) => clean(th.textContent).toLowerCase())
        : [];

      const titleColIdx = headerTexts.findIndex(
        (h) => h.includes("title") || h.includes("position") || h.includes("recruitment title")
      );

      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      for (const tr of rows) {
        const a = tr.querySelector("a[href]");
        if (!a) continue;

        const url = abs(a.getAttribute("href"));
        if (!url || seen.has(url)) continue;

        const anchorText = clean(a.textContent); // often JPF####
        const tds = Array.from(tr.querySelectorAll("td"));
        const cellTexts = tds.map((td) => clean(td.textContent)).filter(Boolean);

        let title = null;

        // Prefer title column if present
        if (titleColIdx >= 0 && tds[titleColIdx]) {
          const cand = clean(tds[titleColIdx].textContent);
          if (cand && !looksLikeJpf(cand) && !looksLikeDeadline(cand) && !isFellowship(cand)) {
            title = cand;
          }
        }

        // Otherwise pick first reasonable non-deadline, non-JPF, non-fellow cell
        if (!title) {
          const candidates = cellTexts.filter((txt) => {
            if (!txt) return false;
            if (txt === anchorText) return false;
            if (txt.length < 4) return false;
            if (looksLikeJpf(txt)) return false;
            if (looksLikeDeadline(txt)) return false;
            if (isFellowship(txt)) return false;
            return true;
          });
          title = candidates[0] || null;
        }

        if (!title) title = anchorText;
        if (isFellowship(title)) continue;

        seen.add(url);
        out.push({ title, url });
      }

      return out;
    });

    console.log(`${campusName} UC listings scraped (pre-filter): ${jobs.length}`);

    const needsTitle = jobs
      .filter((j) => looksLikeJpfTitle(j.title) || looksLikeUcBadTitle(j.title))
      .map((j) => j.url);

    const detailTitleMap = needsTitle.length
      ? await fetchUcTitlesFromDetails(context, needsTitle, 6)
      : new Map();

    const finalJobs = jobs
      .map((j) => ({
        title: detailTitleMap.get(j.url) || j.title,
        url: j.url,
        source: "UC",
        category: "Faculty",
        college: campusName,
        location: null,
        description: null,
      }))
      .filter((j) => !isUcFellowship(j.title));

    console.log(`${campusName} UC listings kept (post-filter): ${finalJobs.length}`);
    return finalJobs;
  } finally {
    await page.close().catch(() => {});
  }
}

async function fetchUcTitlesFromDetails(context, urls, concurrency = 6) {
  const out = new Map();
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const url = urls[idx++];
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(500);

        const title = await page.evaluate(() => {
          const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
          const meta = (sel, attr) => clean(document.querySelector(sel)?.getAttribute(attr));

          let t =
            clean(document.querySelector("h1")?.textContent) ||
            meta("meta[property='og:title']", "content") ||
            meta("meta[name='twitter:title']", "content") ||
            clean(document.title);

          if (t) t = t.replace(/\s+\|\s+.*$/g, "").trim();

          const low = (t || "").toLowerCase();
          if (!t) return null;
          if (/^jpf\s*\d+/i.test(t)) return null;
          if (low.includes("apply by")) return null;
          if (low.includes("for full consideration")) return null;
          if (low.includes("fellowship") || /\bfellow\b/.test(low)) return null;

          return t;
        });

        if (title) out.set(url, title);
      } catch {
        // ignore
      } finally {
        await page.close().catch(() => {});
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

/* ================================================================= */
/* ================================ NJ ============================== */
/* ================================================================= */
/*
  NJ = one source category ("NJ"), each university appears as chip via `college`.

  Covered platforms:
  - Taleo classic + Taleo ATS v2: TCNJ, NJCU
  - Workday (pagination tabs/buttons): Kean, Montclair, William Paterson
  - Rutgers (jobs.rutgers.edu /postings/): Rutgers
  - CSOD / Cornerstone: NJIT
  - SchoolJobs (pager links "Go to Page 2"): Ramapo
  - Stockton custom jobs site: Stockton (paged best-effort)
*/

// ------------------------ shared helpers ------------------------

function looksFacultyish(title) {
  const s = String(title || "").toLowerCase();
  // keep broad but useful
  return (
    s.includes("faculty") ||
    s.includes("professor") ||
    s.includes("lecturer") ||
    s.includes("instructor") ||
    s.includes("assistant professor") ||
    s.includes("associate professor") ||
    s.includes("adjunct")
  );
}

function toNjJob(title, url, campusName, category = "Faculty") {
  return {
    title,
    url,
    source: "NJ",
    category,
    college: campusName, // campus chip
    location: null,
    description: null,
  };
}

// ------------------------ Taleo (TCNJ + NJCU) ------------------------

async function scrapeNjTaleo(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(900);

    const jobs = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); }
        catch { return null; }
      };

      const out = [];
      const seen = new Set();

      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const url = abs(a.getAttribute("href"));
        if (!url) continue;

        const ok =
          /jobdetail\.ftl/i.test(url) ||                           // classic Taleo
          (/careersection/i.test(url) && /job/i.test(url)) ||
          /\/ats\/careers\//i.test(url);                           // Taleo ATS v2

        if (!ok) continue;

        const title = clean(a.textContent);
        if (!title || title.length < 4) continue;

        // skip nav/UI
        if (/search|advanced|return|back|home|login|language|accessibility/i.test(title)) continue;
        if (title.toLowerCase() === "apply" || title.toLowerCase() === "view") continue;

        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title, url });
      }

      return out;
    });

    const filtered = jobs.filter((j) => looksFacultyish(j.title));
    console.log(`${campusName} NJ listings scraped: ${filtered.length}`);

    return filtered.map((j) => toNjJob(j.title, j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

// ------------------------ Workday (Kean + Montclair + William Paterson) ------------------------

async function scrapeNjWorkday(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-automation-id="jobTitle"]', { timeout: 60_000 });

    const jobs = [];
    const seen = new Set();
    const visitedPages = new Set(); // "1","2",...

    for (let safety = 0; safety < 100; safety++) {
      await page.waitForTimeout(450);

      const batch = await page.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try { return new URL(href, location.href).toString(); }
          catch { return null; }
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

      const currentPage = await getWorkdayCurrentPageLabel(page);
      if (currentPage) visitedPages.add(currentPage);

      const moved = await goToNextWorkdayPage(page, visitedPages);
      if (!moved) break;

      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForSelector('[data-automation-id="jobTitle"]', { timeout: 60_000 }).catch(() => {});
    }

    const filtered = jobs.filter((j) => looksFacultyish(j.title));
    console.log(`${campusName} NJ listings scraped: ${filtered.length}`);

    return filtered.map((j) => toNjJob(j.title, j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

async function getWorkdayCurrentPageLabel(page) {
  const btn = page.locator(
    'button[data-uxi-widget-type="paginationPageButton"][aria-current="page"], ' +
      'button[data-uxi-widget-type="paginationPageButton"][aria-selected="true"]'
  ).first();

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
  // 1) next button if present
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

  // 2) numbered page buttons
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

// ------------------------ Rutgers (jobs.rutgers.edu /postings/) ------------------------

async function scrapeNjRutgers(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();

    let currentUrl = startUrl;

    for (let safety = 0; safety < 60; safety++) {
      await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(700);

      const batch = await page.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try { return new URL(href, location.href).toString(); }
          catch { return null; }
        };

        const out = [];
        for (const a of Array.from(document.querySelectorAll('a[href*="/postings/"]'))) {
          const url = abs(a.getAttribute("href"));
          const title = clean(a.textContent);
          if (!url || !title || title.length < 4) continue;
          if (!/\/postings\/\d+/i.test(url)) continue;
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

    const filtered = jobs.filter((j) => looksFacultyish(j.title));
    console.log(`${campusName} NJ listings scraped: ${filtered.length}`);

    return filtered.map((j) => toNjJob(j.title, j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

// ------------------------ CSOD / Cornerstone (NJIT) ------------------------

async function scrapeNjCsod(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1000);

    const jobs = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const abs = (href) => {
        try { return new URL(href, location.href).toString(); }
        catch { return null; }
      };

      const out = [];
      const seen = new Set();

      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const url = abs(a.getAttribute("href"));
        const title = clean(a.textContent);
        if (!url || !title || title.length < 4) continue;

        // CSOD job routes vary; keep strong hints only
        const ok = /\/job\//i.test(url) || /ats\/job/i.test(url) || /career/i.test(url) && /job/i.test(url);
        if (!ok) continue;

        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title, url });
      }

      return out;
    });

    const filtered = jobs.filter((j) => looksFacultyish(j.title));
    console.log(`${campusName} NJ listings scraped: ${filtered.length}`);

    return filtered.map((j) => toNjJob(j.title, j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

// ------------------------ SchoolJobs (Ramapo) ------------------------

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
        const abs = (href) => {
          try { return new URL(href, location.href).toString(); }
          catch { return null; }
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

      const nextUrl = await getSchoolJobsNextPageUrl(page, currentUrl);
      if (!nextUrl) break;
      if (nextUrl === currentUrl) break;
      currentUrl = nextUrl;
    }

    const filtered = jobs.filter((j) => looksFacultyish(j.title));
    console.log(`${campusName} NJ listings scraped: ${filtered.length}`);

    return filtered.map((j) => toNjJob(j.title, j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

async function getSchoolJobsNextPageUrl(page, currentUrl) {
  // Prefer explicit Next
  const nextA = page.locator('a[rel="next"], a[aria-label*="Next" i], a:has-text("Next")').first();
  if ((await nextA.count().catch(() => 0)) > 0) {
    const href = await nextA.getAttribute("href").catch(() => null);
    if (href) return new URL(href, page.url()).toString();
  }

  // Or numbered pages: aria-label="Go to Page 2"
  const href = await page.evaluate(() => {
    const getCur = () => {
      const cur =
        document.querySelector('a[aria-current="page"]') ||
        document.querySelector("li.active a") ||
        document.querySelector("li.selected a");
      if (!cur) return 1;
      const t = (cur.textContent || "").trim();
      const m = t.match(/^(\d+)$/);
      return m ? Number(m[1]) : 1;
    };

    const curN = getCur();
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

// ------------------------ Stockton (employment.stockton.edu) ------------------------

async function scrapeNjStockton(context, startUrl, campusName) {
  const page = await context.newPage();
  try {
    const jobs = [];
    const seen = new Set();

    let currentUrl = startUrl;

    for (let safety = 0; safety < 60; safety++) {
      await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(800);

      const batch = await page.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const abs = (href) => {
          try { return new URL(href, location.href).toString(); }
          catch { return null; }
        };

        const out = [];
        for (const a of Array.from(document.querySelectorAll('a[href]'))) {
          const url = abs(a.getAttribute("href"));
          const title = clean(a.textContent);
          if (!url || !title || title.length < 4) continue;

          // keep strong hints for detail pages
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

      // try next via rel=next or "Next"
      const next = page.locator('a[rel="next"], a:has-text("Next"), a[aria-label*="Next" i]').first();
      if ((await next.count().catch(() => 0)) === 0) break;
      if (!(await next.isVisible().catch(() => false))) break;

      const href = await next.getAttribute("href").catch(() => null);
      if (!href) break;

      const nextUrl = new URL(href, page.url()).toString();
      if (nextUrl === currentUrl) break;
      currentUrl = nextUrl;
    }

    const filtered = jobs.filter((j) => looksFacultyish(j.title));
    console.log(`${campusName} NJ listings scraped: ${filtered.length}`);

    return filtered.map((j) => toNjJob(j.title, j.url, campusName));
  } finally {
    await page.close().catch(() => {});
  }
}

/* ================================================================= */
/* ============================ SHARED ============================== */
/* ================================================================= */

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
        // skip failures
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

// used for CUNY detail pages (simple/stable)
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

      // JSON-LD fallback
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

      // College (best-effort)
      let college = null;
      const org = jp?.hiringOrganization;
      if (typeof org === "string") college = clean(org);
      else if (org && typeof org === "object" && typeof org.name === "string") college = clean(org.name);

      // dt/dd fallback
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

      // Description
      const paras = Array.from(document.querySelectorAll("p"))
        .map((p) => clean(p.textContent))
        .filter((t) => t.length > 40);

      const description =
        meta("meta[property='og:description']", "content") ||
        paras.find((t) => !t.toLowerCase().includes("reasonable accommodation")) ||
        null;

      // drop system-only org
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

// shared detail enricher for CSU + UMass (Phenom-style job pages)
async function fetchPhenomDetailsFromDetails(context, urls, concurrency = 6) {
  const out = new Map(); // url -> { college, location }
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const url = urls[idx++];
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(450);

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
            getFromDtDd(["job location"]) ||
            getFromDtDd(["location"]) ||
            getFromDtDd(["city"]) ||
            null;

          const college =
            getFromDtDd(["department"]) ||
            getFromDtDd(["organization"]) ||
            getFromDtDd(["campus"]) ||
            getFromDtDd(["agency"]) ||
            null;

          // JSON-LD fallback for org
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
