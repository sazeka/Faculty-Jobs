import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { scrapeGenericJobPage, scrapePeopleAdminAs } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated", "louisiana-independent-colleges-validation.json");
const controls = [
  {
    name: "New Orleans Baptist Theological Seminary",
    url: "https://www.nobts.edu/human-resources/job-openings.html",
    platformType: "generic",
    healthyMarker: /Job Openings|Employment Application/i,
  },
  {
    name: "Saint Joseph Seminary College",
    url: "https://www.sjasc.edu/employment-opportunities",
    platformType: "generic",
    healthyMarker: /not currently hiring/i,
    excludeTitleFilter: /^Faculty Members$/i,
  },
  {
    name: "University of Holy Cross",
    url: "https://uhcno.edu/hr/jobs/index.php",
    platformType: "generic",
    healthyMarker: /Current Employment Opportunities/i,
    requireCurrentFacultyJobs: true,
  },
  {
    name: "Xavier University of Louisiana",
    url: "https://jobs.xula.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_position_type_id%5B%5D=3&commit=Search",
    platformType: "peopleadmin",
    healthyMarker: /Search Postings|Position Type/i,
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
    let jobs = control.platformType === "peopleadmin"
      ? await scrapePeopleAdminAs(context, control.url, control.name, "LA")
      : await scrapeGenericJobPage(context, control.url, control.name, "LA");
    if (control.excludeTitleFilter) jobs = jobs.filter((job) => !control.excludeTitleFilter.test(job.title || ""));

    const expectedHost = new URL(control.url).hostname;
    const invalid = jobs.filter((job) => {
      try {
        return job.college !== control.name || job.source !== "LA" || new URL(job.url).hostname !== expectedHost;
      } catch {
        return true;
      }
    });
    results.push({
      name: control.name,
      url: control.url,
      platformType: control.platformType,
      sourceStatus: response.status(),
      healthySource: response.ok() && control.healthyMarker.test(body),
      explicitNoOpenings: /not currently hiring/i.test(body),
      currentFacultyJobCount: jobs.length,
      invalidJobCount: invalid.length,
      sampleTitles: jobs.slice(0, 8).map((job) => job.title),
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
    results.some((result) => result.requireCurrentFacultyJobs && result.currentFacultyJobCount < 1) ||
    results.find((result) => result.name === "Saint Joseph Seminary College")?.currentFacultyJobCount !== 0
  ) process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
