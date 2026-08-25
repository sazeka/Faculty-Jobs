import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  scrapeGenericJobPage,
  scrapeLifeWestCaliforniaAs,
  scrapeVanguardFacultyAs,
} from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated/california-faith-health-universities-validation.json");
const controls = [
  {
    name: "Vanguard University of Southern California",
    url: "https://www.vanguard.edu/resources/human-resources/vu-careers",
    officialSource: "https://www.vanguard.edu/resources/human-resources/vu-careers",
    platformType: "vanguard",
    expectedHost: "recruiting.myapps.paychex.com",
    expectedPath: /^\/appone\/MainInfoReq\.asp$/i,
    requiredBodyMarkers: [/Our job board is updated regularly/i, /Employment Type/i, /Adjunct Faculty/i],
    requiredTitleMarker: /\bfaculty\b|\bprofessor\b|\binstructor\b/i,
    forbiddenTitles: [/Faculty Services/i, /Admissions Counselor/i, /Student Success Coordinator/i],
  },
  {
    name: "Life Chiropractic College West",
    url: "https://lifewest.edu/careers",
    officialSource: "https://lifewest.edu/careers",
    platformType: "life-west-ca",
    expectedHost: "www.paycomonline.net",
    requiredBodyMarkers: [/Current Openings/i, /Life West California/i, /Life West Nebraska/i],
    requiredTitleMarker: /\(\s*Hayward,\s*CA\s*\)\s*$/i,
    forbiddenTitles: [/Bellevue,\s*NE/i],
  },
  {
    name: "Hope International University",
    url: "https://www.hiu.edu/about-hiu/human-resources/hiu-career-opportunities/",
    officialSource: "https://www.hiu.edu/about-hiu/human-resources/hiu-career-opportunities/",
    platformType: "generic",
    expectedHost: "www.hiu.edu",
    healthyZeroMarkers: [/HIU Career Opportunities/i, /Custodian/i, /Campus Safety Officer/i, /Financial Aid Counselor/i],
  },
  {
    name: "San Diego Christian College",
    url: "https://sdcc.edu/employment/",
    officialSource: "https://sdcc.edu/employment/",
    platformType: "generic",
    expectedHost: "sdcc.edu",
    healthyZeroMarkers: [/CURRENT EMPLOYMENT OPPORTUNITIES/i, /complete the online application/i, /hr@sdcc\.edu/i],
    requiredFrameMarker: /paycomonline\.net\/v4\/ats\/web\.php\/jobs\?clientkey=C71D31B2FA8ECC6AF172DC9B28FC014A/i,
  },
  {
    name: "Westminster Theological Seminary in California",
    url: "https://www.wscal.edu/employment/",
    officialSource: "https://www.wscal.edu/employment/",
    platformType: "generic",
    expectedHost: "www.wscal.edu",
    healthyZeroMarkers: [/Employment\s+Opportunities/i, /Current Openings/i, /search and selection process of qualified applicants/i],
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
try {
  const results = [];
  for (const control of controls) {
    let sourceStatus = null;
    let body = "";
    let frameUrls = [];
    let loadError = null;
    const evidencePage = await context.newPage();
    try {
      const response = await evidencePage.goto(control.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await evidencePage.waitForTimeout(2500);
      sourceStatus = response?.status() || null;
      body = await evidencePage.locator("body").innerText().catch(() => "");
      frameUrls = await evidencePage.locator("iframe").evaluateAll((frames) => frames.map((frame) => frame.src));
    } catch (error) {
      loadError = error?.message || String(error);
    } finally {
      await evidencePage.close().catch(() => {});
    }

    let jobs = [];
    let scrapeError = null;
    try {
      if (control.platformType === "vanguard") jobs = await scrapeVanguardFacultyAs(context, control.url, control.name, "CA Private");
      if (control.platformType === "life-west-ca") jobs = await scrapeLifeWestCaliforniaAs(context, control.url, control.name, "CA Private");
      if (control.platformType === "generic") jobs = await scrapeGenericJobPage(context, control.url, control.name, "CA Private");
    } catch (error) {
      scrapeError = error?.message || String(error);
    }

    const invalid = jobs.filter((job) => {
      try {
        const parsed = new URL(job.url);
        return job.college !== control.name
          || job.source !== "CA Private"
          || parsed.hostname !== control.expectedHost
          || (control.expectedPath && !control.expectedPath.test(parsed.pathname))
          || (control.requiredTitleMarker && !control.requiredTitleMarker.test(job.title || ""));
      } catch {
        return true;
      }
    });
    const forbiddenTitleCount = jobs.filter((job) =>
      (control.forbiddenTitles || []).some((pattern) => pattern.test(job.title || ""))
    ).length;
    const requiredMarkersPresent = (control.requiredBodyMarkers || []).every((pattern) => pattern.test(body));
    const healthyZeroMarkersPresent = (control.healthyZeroMarkers || []).every((pattern) => pattern.test(body));
    const requiredFramePresent = !control.requiredFrameMarker || frameUrls.some((url) => control.requiredFrameMarker.test(url));
    const healthyZero = jobs.length === 0 && Boolean(control.healthyZeroMarkers)
      && healthyZeroMarkersPresent && requiredFramePresent;
    const healthySource = sourceStatus >= 200 && sourceStatus < 400
      && !loadError && !scrapeError && requiredMarkersPresent && requiredFramePresent
      && invalid.length === 0 && forbiddenTitleCount === 0
      && (jobs.length > 0 || healthyZero);

    results.push({
      name: control.name,
      url: control.url,
      officialSource: control.officialSource,
      platformType: control.platformType,
      expectedHost: control.expectedHost,
      sourceStatus,
      loadError,
      scrapeError,
      healthySource,
      healthyZero,
      requiredMarkersPresent,
      healthyZeroMarkersPresent,
      requiredFramePresent,
      currentFacultyJobCount: jobs.length,
      invalidJobCount: invalid.length,
      forbiddenTitleCount,
      sampleTitles: jobs.slice(0, 40).map((job) => job.title),
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    validatedCount: results.length,
    currentFacultyJobCount: results.reduce((sum, row) => sum + row.currentFacultyJobCount, 0),
    invalidJobCount: results.reduce((sum, row) => sum + row.invalidJobCount, 0),
    forbiddenTitleCount: results.reduce((sum, row) => sum + row.forbiddenTitleCount, 0),
    results,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (results.some((row) => !row.healthySource)) process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
