import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { scrapePageUpAs, scrapeWorkdayRequiredFacetsAs } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated", "lsu-exact-controls-validation.json");
const controls = [
  {
    name: "Louisiana State University-Alexandria",
    url: "https://lsu.wd1.myworkdayjobs.com/LSU?hiringCompany=7a9995fc77aa101f333e7b1c1f7228b5&workerSubType=7a9995fc77aa101fcf3b27f556ddb30b&timeType=e73b4240f6b9101d9904209ae3608beb",
    officialPage: "https://www.lsua.edu/about/job-opportunities/",
    platformType: "workday-required-facets",
    requiredMarkers: ["hiringCompany", "workerSubType", "timeType"],
    scrape: scrapeWorkdayRequiredFacetsAs,
  },
  {
    name: "Louisiana State University Health Sciences Center-New Orleans",
    url: "https://careers.lsuhsc.edu/jobs/search?category_uids%5B%5D=df2c5db8a34fb1e5184495ac918184df&employment_type_uids%5B%5D=9290c84c437e451fd084a786a6367d37",
    officialPage: "https://www.lsuhsc.edu/administration/hrm/talentacquisition.aspx",
    platformType: "pageup",
    requiredMarkers: ["category_uids[]", "employment_type_uids[]"],
    scrape: scrapePageUpAs,
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
});

try {
  const results = [];
  for (const control of controls) {
    const parsed = new URL(control.url);
    const missingMarkers = control.requiredMarkers.filter((key) => !parsed.searchParams.has(key));
    const jobs = await control.scrape(context, control.url, control.name, "LA");
    const invalid = jobs.filter((job) => {
      try {
        return job.college !== control.name || job.source !== "LA" || new URL(job.url).hostname !== parsed.hostname;
      } catch {
        return true;
      }
    });
    results.push({
      name: control.name,
      url: control.url,
      officialPage: control.officialPage,
      platformType: control.platformType,
      requiredMarkers: control.requiredMarkers,
      missingMarkerCount: missingMarkers.length,
      currentFacultyJobCount: jobs.length,
      invalidJobCount: invalid.length,
      sampleTitles: jobs.slice(0, 8).map((job) => job.title),
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    validatedCount: results.length,
    currentFacultyJobCount: results.reduce((sum, result) => sum + result.currentFacultyJobCount, 0),
    invalidJobCount: results.reduce((sum, result) => sum + result.invalidJobCount, 0),
    missingMarkerCount: results.reduce((sum, result) => sum + result.missingMarkerCount, 0),
    results,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (
    payload.validatedCount !== controls.length ||
    payload.invalidJobCount !== 0 ||
    payload.missingMarkerCount !== 0 ||
    results.some((result) => result.currentFacultyJobCount < 1)
  ) process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
