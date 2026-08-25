import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { scrapeSouthernSystemVacancies, scrapeSouthernVacancyFeed } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated", "southern-university-system-validation.json");
const systemUrl = "https://www.sus.edu/news/category/position-vacancy-announcements";
const sunoUrl = "https://www.suno.edu/news/category/position-vacancy-announcements";
const controls = [
  { name: "Southern University and A & M College", url: systemUrl, platformType: "southern-system-vacancies" },
  { name: "Southern University Law Center", url: systemUrl, platformType: "southern-system-vacancies" },
  { name: "Southern University-Board and System", url: systemUrl, platformType: "southern-system-vacancies" },
  { name: "Southern University at New Orleans", url: sunoUrl, platformType: "southern-vacancies" },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
});

try {
  const sourceChecks = [];
  for (const url of [systemUrl, sunoUrl]) {
    const response = await context.request.get(url, { timeout: 45_000 });
    const body = await response.text();
    sourceChecks.push({
      url,
      status: response.status(),
      healthy: response.ok() && /Position Vacancy Announcements/i.test(body),
    });
  }

  const systemJobs = await scrapeSouthernSystemVacancies(context, systemUrl, "LA");
  const sunoJobs = await scrapeSouthernVacancyFeed(context, sunoUrl, "Southern University at New Orleans", "LA");
  const jobs = [...systemJobs, ...sunoJobs];
  const results = controls.map((control) => {
    const campusJobs = jobs.filter((job) => job.college === control.name);
    const expectedHost = new URL(control.url).hostname;
    const invalid = campusJobs.filter((job) => {
      try {
        return job.source !== "LA" || new URL(job.url).hostname !== expectedHost;
      } catch {
        return true;
      }
    });
    return {
      ...control,
      currentFacultyJobCount: campusJobs.length,
      invalidJobCount: invalid.length,
      sampleTitles: campusJobs.slice(0, 8).map((job) => job.title),
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    officialSources: [systemUrl, sunoUrl],
    scanCount: 2,
    validatedCount: results.length,
    currentFacultyJobCount: jobs.length,
    invalidJobCount: results.reduce((sum, result) => sum + result.invalidJobCount, 0),
    sourceChecks,
    results,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));

  const requiredLive = ["Southern University and A & M College", "Southern University at New Orleans"];
  if (
    payload.validatedCount !== controls.length ||
    payload.scanCount !== 2 ||
    payload.invalidJobCount !== 0 ||
    sourceChecks.some((check) => !check.healthy) ||
    requiredLive.some((name) => !results.find((result) => result.name === name)?.currentFacultyJobCount)
  ) process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
