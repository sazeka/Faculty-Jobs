import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { scrapePageUpAs, splitOklahomaStateCampus } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated", "okstate-system-validation.json");
const CAREER_URL = "https://jobs.okstate.edu/jobs/search/search-page-oklahoma-state?page=1&employment_type_uids%5B%5D=369d5b24d91990b57f28e9ebbee41ffa&employment_type_uids%5B%5D=5c5da7ec2907fcbb8822ceda56aa53d0&query=";
const CAMPUSES = [
  "Oklahoma State University",
  "Oklahoma State University Center for Health Sciences",
  "Oklahoma State University Institute of Technology",
  "Oklahoma State University-Oklahoma City",
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
});

try {
  const raw = await scrapePageUpAs(context, CAREER_URL, "Oklahoma State University System", "OK");
  const mapped = raw.map(splitOklahomaStateCampus).filter(Boolean);
  const expectedHost = new URL(CAREER_URL).hostname;
  const invalid = mapped.filter((job) => {
    try {
      return !CAMPUSES.includes(job.college) || new URL(job.url).hostname !== expectedHost || !job.department;
    } catch {
      return true;
    }
  });
  const results = CAMPUSES.map((name) => {
    const jobs = mapped.filter((job) => job.college === name);
    return {
      name,
      currentFacultyJobCount: jobs.length,
      sampleTitles: jobs.slice(0, 5).map((job) => job.title),
      departmentMarkers: [...new Set(jobs.map((job) => job.department))].slice(0, 8),
    };
  });
  const payload = {
    generatedAt: new Date().toISOString(),
    officialSource: "https://jobs.okstate.edu/",
    careerUrl: CAREER_URL,
    rawQualifyingJobCount: raw.length,
    mappedFacultyJobCount: mapped.length,
    ambiguousQualifyingJobCount: raw.length - mapped.length,
    invalidJobCount: invalid.length,
    validatedCount: results.length,
    results,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (payload.invalidJobCount !== 0 || payload.ambiguousQualifyingJobCount !== 0 || results.some((result) => result.currentFacultyJobCount < 1)) {
    process.exitCode = 1;
  }
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
