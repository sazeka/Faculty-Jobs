import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { scrapeSchoolJobsAs } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated", "ul-system-administration-validation.json");
const name = "University of Louisiana-System Administration";
const url = "https://www.governmentjobs.com/careers/louisiana?department%5B0%5D=HED-Bd%20Supervisors%20U%20of%20LA%20Sys&sort=PostingDate%7CDescending";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
});

try {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);
  const body = await page.locator("body").innerText();
  const jobs = await scrapeSchoolJobsAs(context, url, name, "LA");
  const invalid = jobs.filter((job) => {
    try {
      return job.college !== name || job.source !== "LA" || new URL(job.url).hostname !== "www.governmentjobs.com";
    } catch {
      return true;
    }
  });
  const payload = {
    generatedAt: new Date().toISOString(),
    name,
    url,
    platformType: "schooljobs",
    exactDepartmentFilter: new URL(url).searchParams.get("department[0]"),
    healthySource: /(?:\d+\s+jobs? found|No jobs at this time)/i.test(body),
    explicitNoOpenings: /No jobs at this time/i.test(body),
    currentFacultyJobCount: jobs.length,
    invalidJobCount: invalid.length,
    sampleTitles: jobs.slice(0, 8).map((job) => job.title),
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (
    payload.exactDepartmentFilter !== "HED-Bd Supervisors U of LA Sys" ||
    !payload.healthySource ||
    payload.invalidJobCount !== 0
  ) process.exitCode = 1;
  await page.close().catch(() => {});
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
