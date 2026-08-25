#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { scrapeHerzingUkgAs, splitHerzingUkgLocation } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MILESTONE_PATH = path.join(ROOT, "generated", "herzing-campus-controls-milestone.json");
const OUT_PATH = path.join(ROOT, "generated", "herzing-campus-controls-validation.json");
const milestone = JSON.parse(fs.readFileSync(MILESTONE_PATH, "utf8"));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
  viewport: { width: 1280, height: 800 },
  locale: "en-US",
});

let boardStatus = null;
let opportunities = [];
let catalogLocations = [];
let catalogTotalCount = 0;
let jobs = [];
try {
  const page = await context.newPage();
  const response = await page.goto(milestone.boardUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  boardStatus = response?.status() ?? null;
  if (boardStatus !== 200) throw new Error(`Official board returned HTTP ${boardStatus}`);
  const raw = await page.evaluate(async () => {
    const root = location.pathname.replace(/\/$/, "");
    const opportunityResponse = await fetch(`${root}/JobBoardView/LoadSearchResults`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        opportunitySearch: {
          Top: 100,
          Skip: 0,
          QueryString: "",
          Filters: [4, 5, 6, 37].map((fieldName) => ({
            t: "TermsSearchFilterDto", fieldName, extra: null, values: [],
          })),
        },
        matchCriteria: {
          PreferredJobs: [], Educations: [], LicenseAndCertifications: [], Skills: [],
          hasNoLicenses: false, SkippedSkills: [],
        },
      }),
    });
    if (!opportunityResponse.ok) throw new Error(`Opportunity endpoint returned HTTP ${opportunityResponse.status}`);
    const opportunityPayload = await opportunityResponse.json();
    const locationResponse = await fetch(`${root}/JobBoardViewMore/ViewMorePhysicalLocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!locationResponse.ok) throw new Error(`Location endpoint returned HTTP ${locationResponse.status}`);
    const locationPayload = await locationResponse.json();
    return {
      opportunities: opportunityPayload.opportunities || [],
      catalogLocations: locationPayload.locations || [],
      catalogTotalCount: locationPayload.totalCount || 0,
    };
  });
  opportunities = raw.opportunities;
  catalogLocations = raw.catalogLocations;
  catalogTotalCount = raw.catalogTotalCount;
  await page.close();
  jobs = await scrapeHerzingUkgAs(context, milestone.boardUrl, "Herzing");
} finally {
  await context.close();
  await browser.close();
}

const expectedIds = milestone.applied.map((item) => item.locationId).sort();
const observedIds = new Set([
  ...catalogLocations.map((item) => item.Id),
  ...opportunities.flatMap((item) => item.Locations || []).map((item) => item.Id),
]);
const missingIds = expectedIds.filter((id) => !observedIds.has(id));
if (missingIds.length) throw new Error(`Official location controls missing: ${JSON.stringify(missingIds)}`);
if (!opportunities.length) throw new Error("Official Herzing endpoint returned no current opportunities");
if (!jobs.length) throw new Error("Focused Herzing scrape returned no current faculty jobs");
const unassignedOutput = jobs.filter((job) => !milestone.applied.some((item) => item.name === job.college));
if (unassignedOutput.length) throw new Error(`Unassigned output jobs: ${JSON.stringify(unassignedOutput)}`);

const eligibleBeforeCampusControl = opportunities.filter((item) =>
  item.FullTime === true &&
  item.JobCategoryName === "Academics" &&
  /professor|lecturer|instructor|\bfaculty\b|\badjunct\b|\bteaching\s+fellows?\b/i.test(item.Title || "") &&
  !/\bper\s*course\b|part[\s-]?time|parttime|\bpt\b|temporary|\btemp\b|\badministrator\b|\badministrative\b|\badmin\b/i.test(item.Title || "")
);
const rejectedByCampusControl = eligibleBeforeCampusControl.filter((item) => !splitHerzingUkgLocation(item));
const campusCounts = Object.fromEntries(
  milestone.applied.map((item) => [item.name, jobs.filter((job) => job.college === item.name).length]),
);
const report = {
  generatedAt: new Date().toISOString(),
  boardStatus,
  totalCurrentOpportunityCount: opportunities.length,
  catalogReturnedCount: catalogLocations.length,
  catalogTotalCount,
  expectedControlCount: expectedIds.length,
  validatedControlCount: expectedIds.length - missingIds.length,
  allControlsPresent: missingIds.length === 0,
  currentFacultyPostingCount: jobs.length,
  eligibleBeforeCampusControlCount: eligibleBeforeCampusControl.length,
  rejectedByCampusControlCount: rejectedByCampusControl.length,
  rejectedByCampusControl: rejectedByCampusControl.map((item) => ({
    title: item.Title,
    locationIds: (item.Locations || []).map((location) => location.Id),
    locationNames: (item.Locations || []).map((location) => location.LocalizedName || location.LocalizedDescription),
  })),
  unassignedOutputCount: unassignedOutput.length,
  campusCounts,
  sample: jobs.slice(0, 10).map((job) => ({
    title: job.title,
    college: job.college,
    location: job.location,
    postedDate: job.postedDate,
    url: job.url,
  })),
};
fs.writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Validated ${report.validatedControlCount} Herzing controls and ${jobs.length} current faculty postings.`);
