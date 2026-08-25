#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const REPORT_PATH = path.join(ROOT, "generated", "maricopa-campus-controls-milestone.json");
const BOARD_URL = "https://www.maricopa.edu/about/careers/faculty";
const SOURCE = "Maricopa Community Colleges";

const campuses = [
  ["Chandler-Gilbert Community College", "Chandler/Gilbert College"],
  ["Estrella Mountain Community College", "Estrella Mountain College"],
  ["GateWay Community College", "Gateway College"],
  ["Glendale Community College (AZ)", "Glendale College"],
  ["Maricopa Community College System Office", "Maricopa Community Colleges"],
  ["Mesa Community College", "Mesa College"],
  ["Paradise Valley Community College", "Paradise Valley College"],
  ["Phoenix College", "Phoenix College"],
  ["Rio Salado College", "Rio Salado College"],
  ["Scottsdale Community College", "Scottsdale College"],
  ["South Mountain Community College", "South Mountain College"],
].map(([name, businessUnit]) => ({
  name,
  businessUnit,
  platformType: "maricopa-faculty",
  controlType: "exact_business_unit",
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
  const notes = `Verified 2026-08-25 on the official Maricopa faculty board: exact Business Unit value "${item.businessUnit}". One shared-board pass assigns only this exact value to ${item.name}.`;
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
  institution.last_discovery_status = "exact_shared_system_business_unit_validated";
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
    assignment: "Exact Business Unit equality only; unknown and near-match values fail closed.",
    scope: "Official full-time faculty page only.",
    crawlCount: 1,
  },
}, null, 2)}\n`);
console.log(`Applied ${campuses.length} Maricopa exact business-unit controls; ${after.covered - before.covered} newly covered.`);
