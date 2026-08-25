import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  scrapeGenericJobPage,
  scrapeSouthwesternLawFacultyAs,
} from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated/california-specialized-universities-validation.json");

const controls = [
  {
    name: "Southwestern Law School",
    url: "https://www.swlaw.edu/employment-sw",
    officialSource: "https://www.swlaw.edu/employment-sw",
    platformType: "southwestern-law",
    expectedHost: "www.swlaw.edu",
    expectedPath: /^\/employment-sw\/[^/]+\/?$/,
    requiredBodyMarkers: [/Employment Opportunities/i, /Associate Professor of Law Doctrinal \(Tenure-Track\) Faculty/i],
    forbiddenTitles: [/Faculty, Administrators, and Trustees/i, /Faculty and Academic Services Coordinator/i, /^Adjunct Faculty$/i],
  },
  {
    name: "San Francisco Conservatory of Music",
    url: "https://recruiting.paylocity.com/recruiting/jobs/All/a77350b7-382e-4ebc-be83-5ce68f2b9d07/San-Francisco-Conservatory-of-Music",
    officialSource: "https://sfcm.edu/",
    platformType: "generic",
    expectedHost: "recruiting.paylocity.com",
    requiredBodyMarkers: [/San Francisco Conservatory of Music/i, /Job Opportunities/i],
  },
  {
    name: "Southern California Institute of Architecture",
    url: "https://www.sciarc.edu/institution/resources/careers",
    officialSource: "https://www.sciarc.edu/institution/resources/careers",
    platformType: "generic",
    expectedHost: "www.sciarc.edu",
    healthyZeroMarkers: [/Open Positions/i, /Academic Advisor/i, /Development Coordinator/i],
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
try {
  const results = [];
  for (const control of controls) {
    let sourceStatus = null;
    let body = "";
    let loadError = null;
    const evidencePage = await context.newPage();
    try {
      const response = await evidencePage.goto(control.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await evidencePage.waitForTimeout(1000);
      sourceStatus = response?.status() || null;
      body = await evidencePage.content();
    } catch (error) {
      loadError = error?.message || String(error);
    } finally {
      await evidencePage.close().catch(() => {});
    }

    let jobs = [];
    let scrapeError = null;
    try {
      jobs = control.platformType === "southwestern-law"
        ? await scrapeSouthwesternLawFacultyAs(context, control.url, control.name, "CA Private")
        : await scrapeGenericJobPage(context, control.url, control.name, "CA Private");
    } catch (error) {
      scrapeError = error?.message || String(error);
    }

    const invalid = jobs.filter((job) => {
      try {
        const parsed = new URL(job.url);
        return job.college !== control.name
          || job.source !== "CA Private"
          || parsed.hostname !== control.expectedHost
          || (control.expectedPath && !control.expectedPath.test(parsed.pathname));
      } catch {
        return true;
      }
    });
    const forbiddenTitleCount = jobs.filter((job) =>
      (control.forbiddenTitles || []).some((pattern) => pattern.test(job.title || ""))
    ).length;
    const requiredMarkersPresent = (control.requiredBodyMarkers || []).every((pattern) => pattern.test(body));
    const healthyZeroMarkersPresent = (control.healthyZeroMarkers || []).every((pattern) => pattern.test(body));
    const healthyZero = jobs.length === 0 && Boolean(control.healthyZeroMarkers) && healthyZeroMarkersPresent;
    const healthySource = sourceStatus >= 200 && sourceStatus < 400
      && !loadError && !scrapeError && requiredMarkersPresent
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
      currentFacultyJobCount: jobs.length,
      invalidJobCount: invalid.length,
      forbiddenTitleCount,
      sampleTitles: jobs.slice(0, 25).map((job) => job.title),
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
