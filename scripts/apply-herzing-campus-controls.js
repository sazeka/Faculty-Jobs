#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const REPORT_PATH = path.join(ROOT, "generated", "herzing-campus-controls-milestone.json");
const BOARD_URL = "https://recruiting2.ultipro.com/HER1009HRZ/JobBoard/267d2e37-abff-4559-8a18-a754503d3749";
const SOURCE = "Herzing University";

const campuses = [
  ["Herzing University-Akron", "c2d25b7f-450e-5167-ac35-7b90ffc3c832", "OH"],
  ["Herzing University-Atlanta", "d187b300-0705-5f7f-9755-716afbf78f98", "GA"],
  ["Herzing University-Birmingham", "6a99e2ad-12be-53fe-a016-57189e1b51d5", "AL"],
  ["Herzing University-Brookfield", "e6207fbe-c5a3-5b10-8297-0b0f81609bce", "WI"],
  ["Herzing University-Kenosha", "55541c66-4a71-5930-8d3b-cfe787b8ebcd", "WI"],
  ["Herzing University-Madison", "1ecc406d-feae-5da3-9538-23f825b73f43", "WI"],
  ["Herzing University-Minneapolis", "e1b5a67d-0540-50f9-8adb-b615d6704a01", "MN"],
  ["Herzing University-Nashville", "cf941be5-7919-5b32-9903-cbb8d0055b45", "TN"],
  ["Herzing University-New Orleans", "0381b4e8-5956-5022-90bb-4bd76d8b5711", "LA"],
  ["Herzing University-Orlando", "ced19389-0496-5e08-a96f-87f962eef3db", "FL"],
  ["Herzing University-Tampa", "f4b3b305-28a3-5e75-b34f-5144fa117671", "FL"],
].map(([name, locationId, state]) => ({
  name,
  locationId,
  state,
  platformType: "herzing-ukg",
  controlType: "exact_physical_location_id",
  url: BOARD_URL,
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
  const notes = `Verified 2026-08-25 on Herzing University's official UKG board: exact physical location ID ${item.locationId}. One shared-board pass assigns a posting only when this is its sole location; remote, multi-campus, and unknown locations fail closed.`;
  const entry = {
    name: item.name,
    career_url: BOARD_URL,
    platform_type: item.platformType,
    coverage_source: SOURCE,
    notes,
  };
  const prior = overrideMap.get(item.name.toLowerCase());
  if (prior) Object.assign(prior, entry);
  else overrides.overrides.push(entry);

  const institution = institutionMap.get(item.name.toLowerCase());
  if (!institution) throw new Error(`Institution missing from master: ${item.name}`);
  institution.career_url = BOARD_URL;
  institution.platform_type = item.platformType;
  institution.coverage_source = SOURCE;
  institution.coverage_status = "covered";
  institution.verification_status = "healthy";
  institution.last_verified_at = now;
  institution.last_discovery_status = "exact_shared_system_location_control_validated";
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
  boardUrl: BOARD_URL,
  source: SOURCE,
  appliedCount: campuses.length,
  newlyCoveredCount: after.covered - before.covered,
  before,
  after,
  applied: campuses,
  safeguards: {
    assignment: "Exactly one stable physical location ID must match; unknown, remote, and multi-location postings fail closed.",
    eligibility: "FullTime=true, JobCategoryName=Academics, and the existing strict faculty-title and non-adjunct safeguards.",
    crawlCount: 1,
  },
}, null, 2)}\n`);
console.log(`Applied ${campuses.length} Herzing exact location controls; ${after.covered - before.covered} newly covered.`);
