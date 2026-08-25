import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import {
  scrapeExactHireAs,
  scrapeGenericJobPage,
} from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated", "new-york-independent-colleges-validation.json");

const controls = [
  {
    name: "Manhattan School of Music",
    url: "https://www.msmnyc.edu/about/employment-at-msm/",
    platformType: "generic",
    healthyMarker: /Employment at MSM|Available Administrative and Faculty Positions/i,
    excludeTitleFilter: /^(?:Faculty Overview|Faculty in the News|College Faculty Emeriti)$|Instructional Designer/i,
    requireCurrentFacultyJobs: true,
  },
  {
    name: "Manhattanville University",
    url: "https://mville.exacthire.com/All_Open_Jobs_at_All_Locations?jobs=%5B%5D",
    platformType: "exacthire",
    officialSource: "https://www.mville.edu/offices/human-resources/human-resources.php",
    requireCurrentFacultyJobs: true,
  },
  {
    name: "Northeast College of Health Sciences",
    url: "https://www.northeastcollege.edu/employment-opportunities",
    platformType: "generic",
    healthyMarker: /Employment Opportunities|Positions Available at Northeast/i,
    requireCurrentFacultyJobs: true,
  },
  {
    name: "New York School of Interior Design",
    url: "https://www.nysid.edu/work-at-nysid",
    platformType: "generic",
    healthyMarker: /Work at NYSID|Current Job Openings/i,
  },
  {
    name: "New York Academy of Art",
    url: "https://nyaa.edu/about/employment/",
    platformType: "generic",
    healthyMarker: /Careers|EQUAL OPPORTUNITY EMPLOYMENT/i,
    excludeTitleFilter: /^CS Faculty$/i,
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
});

try {
  const results = [];
  for (const control of controls) {
    let sourceStatus = null;
    let body = "";
    try {
      const response = await context.request.get(control.url, { timeout: 45_000 });
      sourceStatus = response.status();
      body = await response.text();
    } catch {
      // The production adapter remains authoritative for JS/WAF-hosted boards.
    }

    let jobs;
    if (control.platformType === "exacthire") {
      jobs = await scrapeExactHireAs(context, control.url, control.name, "NY");
    } else {
      jobs = await scrapeGenericJobPage(context, control.url, control.name, "NY");
    }
    if (control.excludeTitleFilter) {
      jobs = jobs.filter((job) => !control.excludeTitleFilter.test(job.title || ""));
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
    const responseHealthy = sourceStatus != null && sourceStatus >= 200 && sourceStatus < 400;
    const healthySource = (responseHealthy && markerHealthy) || jobs.length > 0;
    results.push({
      name: control.name,
      url: control.url,
      platformType: control.platformType,
      officialSource: control.officialSource || control.url,
      sourceStatus,
      healthySource,
      currentFacultyJobCount: jobs.length,
      invalidJobCount: invalid.length,
      sampleTitles: jobs.slice(0, 10).map((job) => job.title),
      requireCurrentFacultyJobs: Boolean(control.requireCurrentFacultyJobs),
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
    results.some((result) => result.requireCurrentFacultyJobs && result.currentFacultyJobCount < 1)
  ) process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
