import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { scrapePageUpAs, scrapeWorkdayAs } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated/california-mainstream-universities-validation.json");
const controls = [
  {
    name: "Loyola Marymount University",
    url: "https://lmu.wd1.myworkdayjobs.com/Careers?jobFamilyGroup=203baa23bdff01ca267c14ea190e2e97",
    officialSource: "https://academics.lmu.edu/joinourfaculty/",
    platformType: "workday",
    expectedHost: "lmu.wd1.myworkdayjobs.com",
  },
  {
    name: "Pepperdine University",
    url: "https://jobs.pepperdine.edu/jobs/search?dropdown_field_1_uids%5B%5D=6ca14a4d12d8dc1eb17fa054d2411e33&dropdown_field_3_uids%5B%5D=dcaa7a03ab89b8b42952f428d59046b3&page=1&query=",
    officialSource: "https://seaver.pepperdine.edu/about/administration/dean/facultyemployment/",
    platformType: "pageup",
    expectedHost: "jobs.pepperdine.edu",
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
try {
  const results = [];
  for (const control of controls) {
    const jobs = control.platformType === "workday"
      ? await scrapeWorkdayAs(context, control.url, control.name, "CA Private")
      : await scrapePageUpAs(context, control.url, control.name, "CA Private");
    const invalid = jobs.filter((job) => {
      try {
        return job.college !== control.name
          || job.source !== "CA Private"
          || new URL(job.url).hostname !== control.expectedHost;
      } catch {
        return true;
      }
    });
    results.push({
      name: control.name,
      url: control.url,
      officialSource: control.officialSource,
      platformType: control.platformType,
      expectedHost: control.expectedHost,
      healthySource: jobs.length > 0 && invalid.length === 0,
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
