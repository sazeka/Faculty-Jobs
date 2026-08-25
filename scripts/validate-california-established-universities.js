import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  scrapeAcademicJobsOnlineAs,
  scrapeGenericJobPage,
  scrapePeopleAdminAs,
  scrapeWorkdayAs,
} from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated/california-established-universities-validation.json");
const controls = [
  {
    name: "Pitzer College",
    url: "https://academicjobsonline.org/ajo/Pitzer%20College/Office%20of%20the%20Dean%20of%20Faculty",
    officialSource: "https://www.pitzer.edu/offices/human-resources/working-at-pitzer",
    platformType: "academicjobsonline",
    expectedHost: "academicjobsonline.org",
  },
  {
    name: "University of La Verne",
    url: "https://laverne.peopleadmin.com/postings/search?query_position_type_id%5B%5D=2&commit=Search",
    officialSource: "https://www.laverne.edu/hr/",
    platformType: "peopleadmin",
    expectedHost: "laverne.peopleadmin.com",
  },
  {
    name: "University of San Francisco",
    url: "https://usfca.wd5.myworkdayjobs.com/USF_Full-Time_Faculty",
    officialSource: "https://www.usfca.edu/hr",
    platformType: "workday",
    expectedHost: "usfca.wd5.myworkdayjobs.com",
  },
  {
    name: "Western University of Health Sciences",
    url: "https://jobs.westernu.edu/postings/search?query_position_type_id%5B%5D=2&2711%5B%5D=1&commit=Search",
    officialSource: "https://jobs.westernu.edu/",
    platformType: "peopleadmin",
    expectedHost: "jobs.westernu.edu",
    requiredBodyMarkers: [/selected="selected" value="2">Faculty/i, /selected="selected" value="1">California/i],
    forbiddenBodyMarkers: [/selected="selected" value="2">Oregon/i],
  },
  {
    name: "Westmont College",
    url: "https://www.westmont.edu/office-provost/open-positions",
    officialSource: "https://www.westmont.edu/human-resources/prospective-employees",
    platformType: "generic",
    expectedHost: "www.westmont.edu",
    healthyZeroMarker: /How to Apply for Faculty Positions/i,
  },
  {
    name: "Samuel Merritt University",
    url: "https://samuelmerritt.wd1.myworkdayjobs.com/smucareers?jobFamily=354364828a5e010b8f2897b83ce40000",
    officialSource: "https://www.samuelmerritt.edu/careers",
    platformType: "workday",
    expectedHost: "samuelmerritt.wd1.myworkdayjobs.com",
    excludeTitleFilter: /\b(?:associate dean|simulation educator)\b/i,
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
    let scrapeError = null;
    try {
      if (control.platformType === "academicjobsonline") jobs = await scrapeAcademicJobsOnlineAs(context, control.url, control.name, "CA Private");
      if (control.platformType === "peopleadmin") jobs = await scrapePeopleAdminAs(context, control.url, control.name, "CA Private");
      if (control.platformType === "workday") jobs = await scrapeWorkdayAs(context, control.url, control.name, "CA Private");
      if (control.platformType === "generic") jobs = await scrapeGenericJobPage(context, control.url, control.name, "CA Private");
    } catch (error) {
      scrapeError = error?.message || String(error);
    }
    if (control.excludeTitleFilter) jobs = jobs.filter((job) => !control.excludeTitleFilter.test(job.title || ""));
    const invalid = jobs.filter((job) => {
      try {
        return job.college !== control.name || job.source !== "CA Private" || new URL(job.url).hostname !== control.expectedHost;
      } catch {
        return true;
      }
    });
    const requiredMarkersPresent = (control.requiredBodyMarkers || []).every((marker) => marker.test(body));
    const forbiddenMarkersAbsent = (control.forbiddenBodyMarkers || []).every((marker) => !marker.test(body));
    const healthyZero = jobs.length === 0 && control.healthyZeroMarker?.test(body);
    results.push({
      name: control.name,
      url: control.url,
      officialSource: control.officialSource,
      platformType: control.platformType,
      expectedHost: control.expectedHost,
      sourceStatus,
      scrapeError,
      healthySource: sourceStatus >= 200 && sourceStatus < 400
        && requiredMarkersPresent && forbiddenMarkersAbsent
        && invalid.length === 0 && (jobs.length > 0 || healthyZero),
      healthyZero: Boolean(healthyZero),
      requiredMarkersPresent,
      forbiddenMarkersAbsent,
      currentFacultyJobCount: jobs.length,
      invalidJobCount: invalid.length,
      sampleTitles: jobs.slice(0, 25).map((job) => job.title),
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
  if (results.some((row) => !row.healthySource || row.invalidJobCount)) process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
