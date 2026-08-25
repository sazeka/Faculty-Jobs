import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { scrapeUmichCampusAs } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated", "umich-regional-campuses-validation.json");
const controls = [
  {
    name: "University of Michigan-Dearborn",
    location: "Dearborn Campus",
    url: "https://careers.umich.edu/search-jobs?career_interest=All&department=&field_job_modes_of_work_target_id=All&job_id=&position=All&regular_temporary=R&title=&work_location=1&page=0",
  },
  {
    name: "University of Michigan-Flint",
    location: "Flint Campus",
    url: "https://careers.umich.edu/search-jobs?career_interest=All&department=&field_job_modes_of_work_target_id=All&job_id=&position=All&regular_temporary=R&title=&work_location=2&page=0",
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
});

try {
  const results = [];
  for (const control of controls) {
    const jobs = await scrapeUmichCampusAs(context, control.url, control.name, "MI", control.location);
    const invalid = jobs.filter((job) => {
      try {
        return job.college !== control.name || job.location !== control.location || new URL(job.url).hostname !== "careers.umich.edu";
      } catch {
        return true;
      }
    });
    results.push({
      ...control,
      currentFacultyJobCount: jobs.length,
      invalidJobCount: invalid.length,
      sampleTitles: jobs.slice(0, 8).map((job) => job.title),
    });
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    officialSources: [
      "https://umdearborn.edu/human-resources/employment-recruitment",
      "https://www.umflint.edu/human-resources/employment/",
    ],
    validatedCount: results.length,
    currentFacultyJobCount: results.reduce((sum, result) => sum + result.currentFacultyJobCount, 0),
    invalidJobCount: results.reduce((sum, result) => sum + result.invalidJobCount, 0),
    results,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (payload.validatedCount !== controls.length || payload.invalidJobCount !== 0 || results.some((result) => result.currentFacultyJobCount < 1)) {
    process.exitCode = 1;
  }
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
