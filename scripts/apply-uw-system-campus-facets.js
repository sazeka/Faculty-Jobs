#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const REPORT_PATH = path.join(ROOT, "generated", "uw-system-campus-facets-milestone.json");
const BASE_URL = "https://wisconsin.wd1.myworkdayjobs.com/UW_Comprehensives";
const SOURCE = "University of Wisconsin System";

const campuses = [
  ["University of Wisconsin-Eau Claire", "5adf054562b610142325d0db92c00000", "UWEAU University of Wisconsin Eau Claire"],
  ["University of Wisconsin-Green Bay", "5adf054562b610142325cf0d5f910000", "UWGBY University of Wisconsin Green Bay"],
  ["University of Wisconsin-La Crosse", "5adf054562b610142325cd40b1600000", "UWLAC University of Wisconsin La Crosse"],
  ["University of Wisconsin-Oshkosh", "5adf054562b610142325cb73e24d0000", "UWOSH University of Wisconsin Oshkosh"],
  ["University of Wisconsin-Parkside", "5adf054562b610142325bf73eae20000", "UWPKS University of Wisconsin Parkside"],
  ["University of Wisconsin-Platteville", "5adf054562b610142325c3a6f20a0000", "UWPLT University of Wisconsin Platteville"],
  ["University of Wisconsin-River Falls", "5adf054562b610142325c5738f2b0000", "UWRVF University of Wisconsin River Falls"],
  ["University of Wisconsin-Stevens Point", "5adf054562b610142325c7d9ca9e0000", "UWSTP University of Wisconsin Stevens Point"],
  ["University of Wisconsin-Stout", "5adf054562b610142325d2a8d9b90000", "UWSTO University of Wisconsin Stout"],
  ["University of Wisconsin-Superior", "5adf054562b610142325c9a6b8530000", "UWSUP University of Wisconsin Superior"],
  ["University of Wisconsin-System Administration", "5adf054562b610142325d4766ae70000", "UWSYS University of Wisconsin System Administration"],
  ["University of Wisconsin-Whitewater", "5adf054562b610142325d643b9a70000", "UWWTW University of Wisconsin Whitewater"],
].map(([name, facetId, descriptor]) => ({
  name,
  facetId,
  descriptor,
  career_url: `${BASE_URL}?Institution=${facetId}`,
}));

const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const overrideMap = new Map((overrides.overrides || []).map((item) => [item.name.toLowerCase(), item]));
const institutionMap = new Map((master.institutions || []).map((item) => [item.name.toLowerCase(), item]));
const now = new Date().toISOString();
const before = {
  covered: master.institutions.filter((item) => item.coverage_status === "covered").length,
  missing: master.institutions.filter((item) => item.coverage_status === "missing").length,
};

for (const item of campuses) {
  const notes = `Verified 2026-08-25 through the official University of Wisconsin Workday API: exact Institution facet ${item.facetId} (${item.descriptor}). The route retains the existing strict faculty-title and non-adjunct filters.`;
  const entry = {
    name: item.name,
    career_url: item.career_url,
    platform_type: "workday",
    coverage_source: SOURCE,
    notes,
  };
  const prior = overrideMap.get(item.name.toLowerCase());
  if (prior) Object.assign(prior, entry);
  else overrides.overrides.push(entry);

  const institution = institutionMap.get(item.name.toLowerCase());
  if (!institution) throw new Error(`Institution missing from master: ${item.name}`);
  institution.career_url = item.career_url;
  institution.platform_type = "workday";
  institution.coverage_source = SOURCE;
  institution.coverage_status = "covered";
  institution.verification_status = "healthy";
  institution.last_verified_at = now;
  institution.last_discovery_status = "shared_workday_institution_facet_validated";
  institution.last_discovery_confidence = 1;
  institution.notes = notes;
}

const after = {
  covered: master.institutions.filter((item) => item.coverage_status === "covered").length,
  missing: master.institutions.filter((item) => item.coverage_status === "missing").length,
};
overrides.updatedAt = now;
master.generatedAt = now;
master.counts.covered = after.covered;
master.counts.missing = after.missing;

fs.writeFileSync(OVERRIDES_PATH, `${JSON.stringify(overrides, null, 2)}\n`);
fs.writeFileSync(MASTER_PATH, `${JSON.stringify(master, null, 2)}\n`);
fs.writeFileSync(REPORT_PATH, `${JSON.stringify({
  generatedAt: now,
  boardUrl: BASE_URL,
  source: SOURCE,
  appliedCount: campuses.length,
  newlyCoveredCount: after.covered - before.covered,
  before,
  after,
  applied: campuses,
  heldForReview: [
    { name: "University of Wisconsin-Milwaukee Flex", reason: "No distinct Institution facet is exposed on the official board." },
    { name: "University of Wisconsin-Parkside Flex", reason: "No distinct Institution facet is exposed on the official board." },
  ],
  safeguards: {
    assignment: "One exact official Institution facet per campus; the broad system route is removed.",
    eligibility: "Existing strict faculty-title and non-adjunct filters remain unchanged.",
  },
}, null, 2)}\n`);
console.log(`Applied ${campuses.length} UW exact institution facets; ${after.covered - before.covered} newly covered.`);
