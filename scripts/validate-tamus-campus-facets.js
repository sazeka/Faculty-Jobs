#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { scrapeWorkdayAs } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MILESTONE_PATH = path.join(ROOT, "generated", "tamus-campus-facets-milestone.json");
const OUT_PATH = path.join(ROOT, "generated", "tamus-campus-facets-validation.json");
const milestone = JSON.parse(fs.readFileSync(MILESTONE_PATH, "utf8"));
const endpoint = "https://tamus.wd1.myworkdayjobs.com/wday/cxs/tamus/System-wide_External/jobs";

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
const facets = new Map((unfiltered.facets || []).map((facet) => [facet.facetParameter, facet]));
const members = new Map((facets.get("hiringCompany")?.values || []).map((value) => [value.id, value]));
const workerTypes = new Map((facets.get("workerSubType")?.values || []).map((value) => [value.id, value]));
const timeTypes = new Map((facets.get("ztimeType")?.values || []).map((value) => [value.id, value]));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const validated = [];
try {
  for (const item of milestone.applied) {
    const member = members.get(item.memberId);
    if (!member || member.descriptor !== item.descriptor) throw new Error(`${item.name}: System Member control changed`);
    if (workerTypes.get(item.facultyId)?.descriptor !== "Faculty") throw new Error("Official Faculty control changed");
    if (timeTypes.get(item.fullTimeId)?.descriptor !== "Full time") throw new Error("Official Full-time control changed");
    const appliedFacets = {
      hiringCompany: [item.memberId],
      workerSubType: [item.facultyId],
      ztimeType: [item.fullTimeId],
    };
    const response = await postJobs(appliedFacets);
    if (!Number.isFinite(Number(response.total))) throw new Error(`${item.name}: filtered response has no finite total`);
    const jobs = await scrapeWorkdayAs(context, item.career_url, item.name, "TX");
    if (jobs.some((job) => job.college !== item.name)) throw new Error(`${item.name}: production scraper crossed member scope`);
    validated.push({
      name: item.name,
      memberId: item.memberId,
      officialDescriptor: member.descriptor,
      currentFullTimeFacultyFacetCount: Number(response.total),
      currentStrictFacultyPostingCount: jobs.length,
      sampleTitles: jobs.slice(0, 3).map((job) => job.title),
    });
  }
} finally {
  await context.close();
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  boardStatus: 200,
  validatedCount: validated.length,
  allControlsPresentInOfficialApi: validated.length === milestone.appliedCount,
  membersWithCurrentFacetPostings: validated.filter((item) => item.currentFullTimeFacultyFacetCount > 0).length,
  membersWithCurrentStrictFacultyPostings: validated.filter((item) => item.currentStrictFacultyPostingCount > 0).length,
  currentStrictFacultyPostingCount: validated.reduce((sum, item) => sum + item.currentStrictFacultyPostingCount, 0),
  validated,
};
if (!report.currentStrictFacultyPostingCount) throw new Error("Focused Texas A&M production scrapes returned no current faculty jobs");
fs.writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Validated ${validated.length} Texas A&M member controls and ${report.currentStrictFacultyPostingCount} current faculty postings.`);
