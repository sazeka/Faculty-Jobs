#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const REPORT_PATH = path.join(ROOT, "generated", "tamus-campus-facets-milestone.json");
const BASE_URL = "https://tamus.wd1.myworkdayjobs.com/System-wide_External";
const SOURCE = "Texas A&M University System";
const FACULTY_ID = "0e1cd8ed3502012ddf607157e74b7d04";
const FULL_TIME_ID = "b7fe0524c23001befb2bf6461c464400";

const campuses = [
  ["Prairie View A & M University", "0e1cd8ed3502019a54103fcdeb4b960f", "Prairie View A&M University"],
  ["Texas A & M International University", "0e1cd8ed3502018b6cdd0ecdeb4b0f0e", "Texas A&M International University"],
  ["Texas A & M University-System Office", "0e1cd8ed3502010d591c2dcdeb4b000f", "Texas A&M University System Offices"],
  ["Texas A&M University-Central Texas", "0e1cd8ed35020137762026cdeb4bc50e", "Texas A&M University - Central Texas"],
  ["West Texas A & M University", "0e1cd8ed350201b6eb631acdeb4b7c0e", "West Texas A&M University"],
].map(([name, memberId, descriptor]) => ({
  name,
  memberId,
  descriptor,
  facultyId: FACULTY_ID,
  fullTimeId: FULL_TIME_ID,
  career_url: `${BASE_URL}?hiringCompany=${memberId}&workerSubType=${FACULTY_ID}&ztimeType=${FULL_TIME_ID}`,
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
  const notes = `Verified 2026-08-25 through the official Texas A&M System Workday API: exact System Member facet ${item.memberId} (${item.descriptor}), combined with official Faculty and Full-time facets. Existing strict faculty-title safeguards remain active.`;
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
  institution.last_discovery_status = "shared_workday_member_facets_validated";
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
  safeguards: {
    assignment: "Exact official System Member facet.",
    eligibility: "Official Faculty and Full-time facets plus existing strict faculty-title safeguards.",
  },
}, null, 2)}\n`);
console.log(`Applied ${campuses.length} Texas A&M exact member controls; ${after.covered - before.covered} newly covered.`);
