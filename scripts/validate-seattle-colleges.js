import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import {
  scrapePeopleSoftFluidAs,
  splitSeattleCollegesCampus,
} from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated", "seattle-colleges-validation.json");
const CAREER_URL = "https://hcprd.ctclink.us/psc/tam/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?FOCUS=Applicant&SiteId=060";
const CAMPUSES = [
  "North Seattle College",
  "Seattle Central College",
  "South Seattle College",
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
});

try {
  const raw = await scrapePeopleSoftFluidAs(context, CAREER_URL, "Seattle Colleges", "WA");
  const mapped = raw.map(splitSeattleCollegesCampus).filter(Boolean);
  const expectedHost = new URL(CAREER_URL).hostname;
  const invalid = mapped.filter((job) => {
    try {
      return !CAMPUSES.includes(job.college) || new URL(job.url).hostname !== expectedHost;
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
    };
  });
  const payload = {
    generatedAt: new Date().toISOString(),
    officialSource: "https://www.seattlecolleges.edu/careers-seattle-colleges",
    careerUrl: CAREER_URL,
    siteId: "060",
    rawQualifyingJobCount: raw.length,
    mappedFacultyJobCount: mapped.length,
    ambiguousQualifyingJobCount: raw.length - mapped.length,
    invalidJobCount: invalid.length,
    validatedCount: results.length,
    results,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (payload.invalidJobCount !== 0 || payload.validatedCount !== CAMPUSES.length || payload.mappedFacultyJobCount < 1) {
    process.exitCode = 1;
  }
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
