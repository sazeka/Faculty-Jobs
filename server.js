// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 3000;

const CUNY_URL = "https://cuny.jobs/job-category/faculty/jobs/";
const CT_URL = "https://www.ct.edu/hr/jobs";
const CSU_URL =
  "https://csucareers.calstate.edu/en-us/filter/?=&leftNavSearchFormQuery=&=&search=&search-keyword=&job-mail-subscribe-privacy=agree&work-type=instructional%20faculty%20%e2%80%93%20tenured%2ftenure-track&category=unit%203%20-%20cfa%20-%20california%20faculty%20association&job-mail-subscribe-privacy=agree";

const UMASS_AMHERST_URL =
  "https://careers.umass.edu/amherst/en-us/filter/?job-mail-subscribe-privacy=agree&search-keyword=&work-type=faculty%20full%20time";
const UMASS_BOSTON_URL =
  "https://employmentopportunities.umb.edu/boston/en-us/filter/?search-keyword=&work-type=faculty%20full%20time&job-mail-subscribe-privacy=agree";
const UMASS_DARTMOUTH_URL =
  "https://careers.umassd.edu/en-us/filter/?search-keyword=&job-mail-subscribe-privacy=agree&work-type=faculty%20full%20time";
const UMASS_LOWELL_URL =
  "https://explorejobs.uml.edu/lowell/en-us/filter/?job-mail-subscribe-privacy=agree&search-keyword=&work-type=faculty%20full%20time";

/* ------------------------ absolute paths ------------------------ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

/* --------------------------- cache ------------------------------ */
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, data: null };

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

    const [
      cunyJobs,
      ctJobs,
      csuJobs,
      umassAmherst,
      umassBoston,
      umassDartmouth,
      umassLowell,
    ] = await Promise.all([
      scrapeCunyFaculty(context),
      scrapeCtFacultyTeaching(context),
      scrapeCsuFaculty(context),
      scrapeUmassCampus(context, UMASS_AMHERST_URL, "UMass Amherst"),
      scrapeUmassCampus(context, UMASS_BOSTON_URL, "UMass Boston"),
      scrapeUmassCampus(context, UMASS_DARTMOUTH_URL, "UMass Dartmouth"),
      scrapeUmassCampus(context, UMASS_LOWELL_URL, "UMass Lowell"),
    ]);

    const jobs = [
      ...cunyJobs,
      ...ctJobs,
      ...csuJobs,
      ...umassAmherst,
      ...umassBoston,
      ...umassDartmouth,
      ...umassLowell,
    ].sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    return {
      scrapedAt: new Date().toISOString(),
      count: jobs.length,
      jobs,
    };
  } finally {
    await browser.close();
  }
}

/* ================================================================= */
/* ============================== CUNY ============================== */
/* ================================================================= */

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
  return jobs.filter((j) => j.title && j.title !== "(No title found)");
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
        });
      }
      return out;
    }

    return out;
  });

  console.log(`CT Faculty/Teaching results scraped: ${ctJobs.length}`);
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

/* ================================================================= */
/* =============================== CSU =============================== */
/* ================================================================= */

async function scrapeCsuFaculty(context) {
  const page = await context.newPage();
  await page.goto(CSU_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

  await page.waitForSelector('a[href*="/job/"]', { timeout: 30_000 });

  const jobs = [];
  const seen = new Set();

  for (let safety = 0; safety < 80; safety++) {
    const jobAnchors = page.locator('a[href*="/job/"]');
    const n = await jobAnchors.count();

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
    await page.waitForSelector('a[href*="/job/"]', { timeout: 30_000 });
  }

  console.log(`CSU listing scraped: ${jobs.length}`);

  const detailMap = await fetchPhenomDetailsFromDetails(context, jobs.map((j) => j.url), 6);

  return jobs.map((j) => {
    const d = detailMap.get(j.url);
    return {
      ...j,
      college: j.college || d?.college || null,
      location: j.location || d?.location || null,
    };
  });
}

/* ================================================================= */
/* ============================== UMass ============================= */
/* ================================================================= */

async function scrapeUmassCampus(context, startUrl, campusName) {
  // single source ("UMass"), campus shown as pill via `college`
  return scrapePhenomFaculty(context, startUrl, "UMass", "Faculty – Full Time", campusName);
}

async function scrapePhenomFaculty(context, startUrl, sourceName, categoryLabel, campusName = null) {
  const page = await context.newPage();
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

  await page.waitForSelector('a[href*="/job/"], a[href*="/jobs/"]', { timeout: 30_000 }).catch(() => {});

  const jobs = [];
  const seen = new Set();

  for (let safety = 0; safety < 120; safety++) {
    const anchors = page.locator('a[href*="/job/"], a[href*="/jobs/"]');
    const n = await anchors.count();

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
        source: sourceName,            // "UMass"
        category: categoryLabel,
        college: campusName || null,   // "UMass Amherst" etc.
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
    await page.waitForSelector('a[href*="/job/"], a[href*="/jobs/"]', { timeout: 30_000 }).catch(() => {});
  }

  console.log(`${campusName || sourceName} listing scraped: ${jobs.length}`);

  const detailMap = await fetchPhenomDetailsFromDetails(context, jobs.map((j) => j.url), 6);

  return jobs.map((j) => {
    const d = detailMap.get(j.url);

    let college = j.college; // campus label
    const dept = d?.college || null;

    // append dept/org if present and not duplicative
    if (college && dept && dept.toLowerCase() !== college.toLowerCase()) {
      college = `${college} — ${dept}`;
    } else if (!college && dept) {
      college = dept;
    }

    return {
      ...j,
      college,
      location: j.location || d?.location || null,
    };
  });
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

// Used for CUNY detail pages (kept simple/stable)
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
          return ["college", "campus", "organization", "agency", "department", "company"].some((k) =>
            t.includes(k)
          );
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

      return {
        title: title || "(No title found)",
        description,
        college,
      };
    });

    return {
      title: job.title,
      description: job.description,
      college: job.college,
      url,
    };
  } finally {
    await page.close();
  }
}

// Shared detail enricher for CSU + UMass (Phenom-style job pages)
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
        await page.close();
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}
