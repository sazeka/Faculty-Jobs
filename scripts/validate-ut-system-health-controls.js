import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import {
  scrapePeopleSoftHrsBasic,
  scrapePhenomFacultyCategoryAs,
  scrapeSelectMindsFacultyAs,
} from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "generated", "ut-system-health-controls-validation.json");

const controls = [
  {
    name: "The University of Texas Permian Basin",
    type: "peoplesoft-hrs",
    url: "https://zahr-prd-candidate-ada.utshare.utsystem.edu/psc/ZAHRPRDADA/EMPLOYEE/UTZ_CG/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Action=U&FOCUS=Applicant&Page=HRS_APP_SCHJOB&SiteId=10",
    run: (context, item) => scrapePeopleSoftHrsBasic(context, item.url, item.name, "TX"),
  },
  {
    name: "The University of Texas System Office",
    type: "peoplesoft-hrs",
    url: "https://zahr-prd-candidate-ada.utshare.utsystem.edu/psp/ZAHRPRDADA/EMPLOYEE/HRMS/c/HRS_HRAM.HRS_APP_SCHJOB.GBL?Action=U&FOCUS=Applicant&Page=HRS_APP_SCHJOB&SiteId=8",
    run: (context, item) => scrapePeopleSoftHrsBasic(context, item.url, item.name, "TX"),
  },
  {
    name: "The University of Texas Health Science Center at Houston",
    type: "phenom-faculty-category",
    url: "https://careers.uth.tmc.edu/us/en/c/faculty-physicians-jobs",
    run: (context, item) => scrapePhenomFacultyCategoryAs(context, item.url, item.name, "TX"),
  },
  {
    name: "The University of Texas Health Science Center at San Antonio",
    type: "selectminds-faculty-search",
    url: "https://uthscsa.referrals.selectminds.com/faculty",
    run: (context, item) => scrapeSelectMindsFacultyAs(context, item.url, item.name, "TX", {
      clickSearch: true,
      requireCategory: "Faculty",
    }),
  },
  {
    name: "The University of Texas Medical Branch at Galveston",
    type: "selectminds-faculty-saved-search",
    url: "https://applyjobs.utmb.edu/landing-pages/79/jobs-matching-custom-search",
    run: (context, item) => scrapeSelectMindsFacultyAs(context, item.url, item.name, "TX", {
      requireTitleEvidence: true,
    }),
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
});

try {
  const results = [];
  for (const control of controls) {
    const jobs = await control.run(context, control);
    const expectedHost = new URL(control.url).hostname;
    const invalidJobs = jobs.filter((job) => {
      try {
        return job.college !== control.name || new URL(job.url).hostname !== expectedHost;
      } catch {
        return true;
      }
    });
    results.push({
      name: control.name,
      type: control.type,
      url: control.url,
      currentFacultyJobCount: jobs.length,
      invalidJobCount: invalidJobs.length,
      sampleTitles: jobs.slice(0, 5).map((job) => job.title),
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    validatedCount: results.length,
    allControlsReturnedSafely: results.every((result) => result.invalidJobCount === 0),
    controlsWithCurrentFacultyJobs: results.filter((result) => result.currentFacultyJobCount > 0).length,
    currentFacultyJobCount: results.reduce((sum, result) => sum + result.currentFacultyJobCount, 0),
    results,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (payload.validatedCount !== controls.length || !payload.allControlsReturnedSafely || payload.controlsWithCurrentFacultyJobs < 3) {
    process.exitCode = 1;
  }
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
