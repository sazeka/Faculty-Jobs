#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { scrapeWorkdayAs } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MILESTONE_PATH = path.join(ROOT, "generated", "uw-system-campus-facets-milestone.json");
const OUT_PATH = path.join(ROOT, "generated", "uw-system-campus-facets-validation.json");
const milestone = JSON.parse(fs.readFileSync(MILESTONE_PATH, "utf8"));
const endpoint = "https://wisconsin.wd1.myworkdayjobs.com/wday/cxs/wisconsin/UW_Comprehensives/jobs";

async function postJobs(appliedFacets, limit = 20) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appliedFacets, limit, offset: 0, searchText: "" }),
  });
  if (!response.ok) throw new Error(`Official Workday API returned HTTP ${response.status}`);
  return response.json();
}

const unfiltered = await postJobs({}, 1);
const institutionFacet = (unfiltered.facets || []).find((facet) => facet.facetParameter === "Institution");
const official = new Map((institutionFacet?.values || []).map((value) => [value.id, value]));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const validated = [];
try {
  for (const item of milestone.applied) {
    const control = official.get(item.facetId);
    if (!control) throw new Error(`${item.name}: official Institution facet ${item.facetId} is absent`);
    if (control.descriptor !== item.descriptor) {
      throw new Error(`${item.name}: descriptor changed to ${control.descriptor}`);
    }
    const response = await postJobs({ Institution: [item.facetId] });
    if (!Number.isFinite(Number(response.total))) throw new Error(`${item.name}: filtered response has no finite total`);
    const jobs = await scrapeWorkdayAs(context, item.career_url, item.name, "WI");
    if (jobs.some((job) => job.college !== item.name)) throw new Error(`${item.name}: production scraper crossed campus scope`);
    validated.push({
      name: item.name,
      facetId: item.facetId,
      officialDescriptor: control.descriptor,
      currentPostingCount: Number(response.total),
      currentFacultyPostingCount: jobs.length,
      sampleFacultyTitles: jobs.slice(0, 3).map((job) => job.title),
    });
  }
} finally {
  await context.close();
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  boardStatus: 200,
  officialInstitutionFacetCount: official.size,
  validatedCount: validated.length,
  allFacetIdsPresentInOfficialApi: validated.length === milestone.appliedCount,
  campusesWithCurrentPostings: validated.filter((item) => item.currentPostingCount > 0).length,
  campusesWithCurrentFacultyPostings: validated.filter((item) => item.currentFacultyPostingCount > 0).length,
  currentFacultyPostingCount: validated.reduce((sum, item) => sum + item.currentFacultyPostingCount, 0),
  validated,
};
if (!report.currentFacultyPostingCount) throw new Error("Focused UW production scrapes returned no current faculty jobs");
fs.writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Validated ${validated.length} UW Institution facets and ${report.currentFacultyPostingCount} current faculty postings.`);
