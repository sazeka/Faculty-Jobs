import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  scrapeGenericJobPage,
  scrapeOracleCloudApi,
  scrapeStBernardsFacultyAs,
} from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated/new-york-specialized-colleges-validation.json");
const controls = [
  {
    name: "Hebrew Union College-Jewish Institute of Religion",
    url: "https://recruiting.paylocity.com/recruiting/jobs/All/727c7840-07f6-4cdf-b2dc-29819ba3b3ca/Hebrew-Union-College",
    officialSource: "https://huc.edu/about-huc/careers-at-huc/",
    platformType: "generic",
    expectedHost: "recruiting.paylocity.com",
  },
  {
    name: "Wagner College",
    url: "https://fa-exad-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs",
    platformType: "oracle-cloud-api",
    expectedHost: "fa-exad-saasfaprod1.fa.ocs.oraclecloud.com",
  },
  {
    name: "St Bernard's School of Theology and Ministry",
    url: "https://stbernards.edu/job-postings",
    platformType: "stbernards-faculty",
    expectedHost: "stbernards.edu",
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
try {
  const results = [];
  for (const control of controls) {
    let sourceStatus = null;
    let body = "";
    try {
      const response = await context.request.get(control.url, { timeout: 45_000 });
      sourceStatus = response.status();
      body = await response.text();
    } catch {}
    let jobs = [];
    if (control.platformType === "generic") jobs = await scrapeGenericJobPage(context, control.url, control.name, "NY");
    if (control.platformType === "oracle-cloud-api") jobs = await scrapeOracleCloudApi(control.url, control.name, "NY");
    if (control.platformType === "stbernards-faculty") jobs = await scrapeStBernardsFacultyAs(context, control.url, control.name, "NY");
    let rawBoardJobCount = null;
    if (control.platformType === "generic") {
      const page = await context.newPage();
      try {
        await page.goto(control.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(3000);
        rawBoardJobCount = await page.locator('a[href*="/Recruiting/Jobs/Details/"]').count();
      } finally {
        await page.close().catch(() => {});
      }
    }
    const invalid = jobs.filter((job) => {
      try {
        return job.college !== control.name || job.source !== "NY" || new URL(job.url).hostname !== control.expectedHost;
      } catch { return true; }
    });
    const markerHealthy = control.platformType === "generic"
      ? /Hebrew Union College - Job Opportunities|727c7840-07f6-4cdf-b2dc-29819ba3b3ca/i.test(body)
      : control.platformType === "stbernards-faculty"
        ? /St\. Bernard's Faculty Search\s+Visiting Faculty Position \(Open Rank\)/i.test(body)
        : jobs.length > 0;
    results.push({
      name: control.name,
      url: control.url,
      officialSource: control.officialSource || control.url,
      platformType: control.platformType,
      sourceStatus,
      healthySource: (sourceStatus == null || (sourceStatus >= 200 && sourceStatus < 400)) && markerHealthy,
      rawBoardJobCount,
      currentFacultyJobCount: jobs.length,
      invalidJobCount: invalid.length,
      sampleTitles: jobs.slice(0, 15).map((job) => job.title),
    });
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    validatedCount: results.length,
    currentFacultyJobCount: results.reduce((sum, row) => sum + row.currentFacultyJobCount, 0),
    invalidJobCount: results.reduce((sum, row) => sum + row.invalidJobCount, 0),
    results,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  const huc = results.find((row) => row.name.startsWith("Hebrew Union"));
  if (results.some((row) => !row.healthySource || row.invalidJobCount) || !huc || huc.rawBoardJobCount < 1
    || results.filter((row) => row !== huc).some((row) => row.currentFacultyJobCount < 1)) process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
