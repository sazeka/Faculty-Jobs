import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import {
  scrapeGenericJobPage,
  scrapeOracleCloudApi,
  scrapePeopleAdminAs,
  scrapeWorkdayAs,
} from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated", "new-york-mainstream-colleges-validation.json");

const controls = [
  {
    name: "Houghton University",
    url: "https://www.houghton.edu/employment/faculty-openings/",
    platformType: "generic",
    healthyMarker: /Faculty Openings|Current Faculty Positions/i,
    officialSource: "https://www.houghton.edu/employment/faculty-openings/",
    excludeTitleFilter: /^Faculty Application$/i,
    requireCurrentFacultyJobs: true,
  },
  {
    name: "Skidmore College",
    url: "https://eodq.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs",
    platformType: "oracle-cloud-api",
    officialSource: "https://www.skidmore.edu/hr/index.php",
    requireRawBoardJobs: true,
  },
  {
    name: "Vassar College",
    url: "https://vassar.wd1.myworkdayjobs.com/en-US/Vassar-External?jobFamilyGroup=71e2c39500161003e7c502c9a45f8212",
    platformType: "workday",
    officialSource: "https://offices.vassar.edu/dean-of-the-faculty/positions/",
    requireCurrentFacultyJobs: true,
  },
  {
    name: "St Lawrence University",
    url: "https://employment.stlawu.edu/postings/search?435=&commit=Search&query=&query_position_type_id%5B%5D=2&query_v0_posted_at_date=",
    platformType: "peopleadmin",
    healthyMarker: /Search Postings|Position Type/i,
    officialSource: "https://employment.stlawu.edu/",
  },
  {
    name: "St. John Fisher University",
    url: "https://jobs.sjf.edu/postings/search?435=&commit=Search&query=&query_organizational_tier_3_id=any&query_position_type_id=3&query_v0_posted_at_date=&utf8=%E2%9C%93",
    platformType: "peopleadmin",
    healthyMarker: /Search Postings|Position Type/i,
    officialSource: "https://jobs.sjf.edu/",
    requireCurrentFacultyJobs: true,
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
});

try {
  const results = [];
  for (const control of controls) {
    const response = await context.request.get(control.url, { timeout: 45_000 });
    const body = await response.text();
    let jobs;
    if (control.platformType === "peopleadmin") {
      jobs = await scrapePeopleAdminAs(context, control.url, control.name, "NY");
    } else if (control.platformType === "workday") {
      jobs = await scrapeWorkdayAs(context, control.url, control.name, "NY");
    } else if (control.platformType === "oracle-cloud-api") {
      jobs = await scrapeOracleCloudApi(control.url, control.name, "NY");
    } else {
      jobs = await scrapeGenericJobPage(context, control.url, control.name, "NY");
    }
    if (control.excludeTitleFilter) {
      jobs = jobs.filter((job) => !control.excludeTitleFilter.test(job.title || ""));
    }

    let rawBoardJobCount = null;
    if (control.platformType === "oracle-cloud-api") {
      const source = new URL(control.url);
      const site = source.pathname.match(/\/sites\/([^/]+)/i)?.[1];
      const finder = `findReqs;siteNumber=${site},limit=25,offset=0,sortBy=POSTING_DATES_DESC`;
      const apiUrl = `${source.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&finder=${encodeURIComponent(finder)}`;
      const apiResponse = await context.request.get(apiUrl, { timeout: 45_000 });
      const apiPayload = apiResponse.ok() ? await apiResponse.json() : null;
      rawBoardJobCount = Number(apiPayload?.items?.[0]?.TotalJobsCount);
      if (!Number.isFinite(rawBoardJobCount)) rawBoardJobCount = null;
    }

    const expectedHost = new URL(control.url).hostname;
    const invalid = jobs.filter((job) => {
      try {
        return job.college !== control.name || job.source !== "NY" || new URL(job.url).hostname !== expectedHost;
      } catch {
        return true;
      }
    });
    const markerHealthy = control.healthyMarker ? control.healthyMarker.test(body) : true;
    results.push({
      name: control.name,
      url: control.url,
      platformType: control.platformType,
      officialSource: control.officialSource,
      sourceStatus: response.status(),
      healthySource: response.ok() && markerHealthy,
      currentFacultyJobCount: jobs.length,
      rawBoardJobCount,
      invalidJobCount: invalid.length,
      sampleTitles: jobs.slice(0, 8).map((job) => job.title),
      requireCurrentFacultyJobs: Boolean(control.requireCurrentFacultyJobs),
      requireRawBoardJobs: Boolean(control.requireRawBoardJobs),
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    validatedCount: results.length,
    currentFacultyJobCount: results.reduce((sum, result) => sum + result.currentFacultyJobCount, 0),
    invalidJobCount: results.reduce((sum, result) => sum + result.invalidJobCount, 0),
    results,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (
    payload.validatedCount !== controls.length ||
    payload.invalidJobCount !== 0 ||
    results.some((result) => !result.healthySource) ||
    results.some((result) => result.requireCurrentFacultyJobs && result.currentFacultyJobCount < 1) ||
    results.some((result) => result.requireRawBoardJobs && !(result.rawBoardJobCount > 0))
  ) process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
