import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { scrapePeopleAdminAs, scrapeWorkdayAs } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated", "louisiana-official-boards-validation.json");
const controls = [
  {
    name: "Nicholls State University",
    url: "https://jobs.nicholls.edu/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&1667%5B%5D=3&commit=Search",
    platformType: "peopleadmin",
    officialPage: "https://www.nicholls.edu/human-resources/",
    scrape: scrapePeopleAdminAs,
  },
  {
    name: "University of New Orleans",
    url: "https://ulsuno.wd1.myworkdayjobs.com/UniversityOfNewOrleans",
    platformType: "workday",
    officialPage: "https://www.lsuneworleans.edu/careers",
    scrape: scrapeWorkdayAs,
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
});

try {
  const results = [];
  for (const control of controls) {
    const jobs = await control.scrape(context, control.url, control.name, "LA");
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
      officialPage: control.officialPage,
      platformType: control.platformType,
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
