import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { scrapeAppOneRssAs, scrapeGenericJobPage } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated/new-york-arts-technology-colleges-validation.json");
const controls = [
  {
    name: "St. Francis College",
    url: "https://www.sfc.edu/why-sfc/careers-at-sfc",
    platformType: "generic",
    marker: /Careers at SFC|Faculty Positions/i,
    excludeTitleFilter: /Faculty Positions$/i,
  },
  {
    name: "The Cooper Union for the Advancement of Science and Art",
    url: "https://cooper.edu/work/employment-opportunities",
    platformType: "generic",
    marker: /Employment Opportunities|Posted on:/i,
    excludeTitleFilter: /^(?:Faculty-Student Senate|Faculty of Humanities & Social Sciences)$/i,
  },
  {
    name: "Villa Maria College",
    url: "https://www.villa.edu/about-us/employment-opportunities/",
    platformType: "generic",
    marker: /Employment Opportunities|Open Positions/i,
  },
  {
    name: "Vaughn College of Aeronautics and Technology",
    url: "https://client.hrservicesinc.com/downloads/rss/portals/22048.xml",
    officialSource: "https://www.vaughn.edu/about/work-at-vaughn/",
    platformType: "appone-rss",
    marker: /VAUGHN COLLEGE OF AERONAUTICS Jobs/i,
    excludeTitleFilter: /\b(?:CSTEP|current students only)\b/i,
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
try {
  const results = [];
  for (const control of controls) {
    const response = await context.request.get(control.url, { timeout: 45_000 });
    const body = await response.text();
    let jobs = control.platformType === "appone-rss"
      ? await scrapeAppOneRssAs(control.url, control.name, "NY", control.excludeTitleFilter)
      : await scrapeGenericJobPage(context, control.url, control.name, "NY");
    if (control.platformType === "generic" && control.excludeTitleFilter) {
      jobs = jobs.filter((job) => !control.excludeTitleFilter.test(job.title || ""));
    }
    const expectedHosts = control.platformType === "appone-rss"
      ? new Set(["www.appone.com"])
      : null;
    const invalid = jobs.filter((job) => {
      try {
        return job.college !== control.name || job.source !== "NY"
          || (expectedHosts && !expectedHosts.has(new URL(job.url).hostname));
      } catch { return true; }
    });
    results.push({
      name: control.name,
      url: control.url,
      officialSource: control.officialSource || control.url,
      platformType: control.platformType,
      sourceStatus: response.status(),
      healthySource: response.ok() && control.marker.test(body),
      currentFacultyJobCount: jobs.length,
      invalidJobCount: invalid.length,
      sampleTitles: jobs.slice(0, 20).map((job) => job.title),
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
  if (results.some((row) => !row.healthySource || row.currentFacultyJobCount < 1 || row.invalidJobCount)) process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
