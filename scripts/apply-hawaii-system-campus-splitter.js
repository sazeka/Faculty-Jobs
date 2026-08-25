#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PATH = path.join(ROOT, "server.js");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const REPORT_PATH = path.join(ROOT, "generated", "hawaii-system-campus-splitter-milestone.json");
const BOARD_URL = "https://www.schooljobs.com/careers/hawaiiedu?keywords=faculty";

const campuses = [
  ["University of Hawaii at Hilo", "University of Hawai'i at Hilo"],
  ["University of Hawaii at Manoa", "University of Hawai'i at Manoa"],
  ["University of Hawaii Maui College", "University of Hawai'i Maui College"],
  ["University of Hawaii-West Oahu", "University of Hawai'i - West O'ahu"],
].map(([name, marker]) => ({
  name,
  source: "University of Hawaii System",
  platformType: "schooljobs-hawaii",
  controlType: "schooljobs_department_name",
  control: marker,
  descriptor: marker,
  url: BOARD_URL,
}));

let server = fs.readFileSync(SERVER_PATH, "utf8");
server = server.replace(
  '{ campus: "University of Hawaii System", type: "schooljobs", url: "https://www.schooljobs.com/careers/hawaiiedu?keywords=faculty" },',
  '{ campus: "University of Hawaii System", type: "schooljobs-hawaii", url: "https://www.schooljobs.com/careers/hawaiiedu?keywords=faculty" },',
);
for (const line of [
  '  { campus: "Hawaii Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/hawaiiedu?keywords=Hawai%27i%20Community%20College", contentFilter: "Hawai\'i Community College" },\n',
  '  { campus: "Honolulu Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/hawaiiedu?keywords=Honolulu%20Community%20College", contentFilter: "Honolulu Community College" },\n',
  '  { campus: "Kauai Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/hawaiiedu?keywords=Kaua%27i%20Community%20College", contentFilter: "Kaua\'i Community College" },\n',
  '  { campus: "Leeward Community College", type: "schooljobs", url: "https://www.schooljobs.com/careers/hawaiiedu?keywords=Leeward%20Community%20College", contentFilter: "Leeward Community College" },\n',
]) server = server.replace(line, "");
fs.writeFileSync(SERVER_PATH, server);

const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const overrideMap = new Map((overrides.overrides || []).map((item) => [item.name.toLowerCase(), item]));
const institutionMap = new Map((master.institutions || []).map((item) => [item.name.toLowerCase(), item]));
const now = new Date().toISOString();

for (const item of campuses) {
  const notes = `Verified 2026-08-25 on the official University of Hawai'i NEOGOV board: exact data-department-name prefix ${item.control}. One shared-board pass assigns only exact marker matches to this campus.`;
  const entry = {
    name: item.name,
    career_url: item.url,
    platform_type: item.platformType,
    coverage_source: item.source,
    notes,
  };
  const prior = overrideMap.get(item.name.toLowerCase());
  if (prior) Object.assign(prior, entry);
  else overrides.overrides.push(entry);

  const institution = institutionMap.get(item.name.toLowerCase());
  if (!institution) throw new Error(`Institution missing from master: ${item.name}`);
  institution.career_url = item.url;
  institution.platform_type = item.platformType;
  institution.coverage_source = item.source;
  institution.coverage_status = "covered";
  institution.verification_status = "healthy";
  institution.last_verified_at = now;
  institution.last_discovery_status = "exact_shared_system_campus_control_validated";
  institution.last_discovery_confidence = 1;
  if (!String(institution.notes || "").includes(`prefix ${item.control}`)) {
    institution.notes = `${String(institution.notes || "").trim()} ${notes}`.trim();
  }
}

const consolidated = [
  "University of Hawaii System",
  "Hawaii Community College",
  "Honolulu Community College",
  "Kauai Community College",
  "Leeward Community College",
];
for (const name of consolidated) {
  const notes = "Verified 2026-08-25: consolidated into one official University of Hawai'i NEOGOV board crawl; exact data-department-name controls preserve campus attribution.";
  const entry = {
    name,
    career_url: BOARD_URL,
    platform_type: "schooljobs-hawaii",
    coverage_source: "University of Hawaii System",
    notes,
  };
  const prior = overrideMap.get(name.toLowerCase());
  if (prior) Object.assign(prior, entry);
  else overrides.overrides.push(entry);

  const institution = institutionMap.get(name.toLowerCase());
  if (!institution) throw new Error(`Institution missing from master: ${name}`);
  institution.career_url = BOARD_URL;
  institution.platform_type = "schooljobs-hawaii";
  institution.coverage_source = "University of Hawaii System";
  institution.coverage_status = "covered";
  institution.verification_status = "healthy";
  institution.last_verified_at = now;
  if (!String(institution.notes || "").includes("consolidated into one official University of Hawai'i NEOGOV board crawl")) {
    institution.notes = `${String(institution.notes || "").trim()} ${notes}`.trim();
  }
}

overrides.updatedAt = now;
master.generatedAt = now;
master.counts.covered = master.institutions.filter((item) => item.coverage_status === "covered").length;
master.counts.missing = master.institutions.filter((item) => item.coverage_status === "missing").length;
fs.writeFileSync(OVERRIDES_PATH, `${JSON.stringify(overrides, null, 2)}\n`);
fs.writeFileSync(MASTER_PATH, `${JSON.stringify(master, null, 2)}\n`);
fs.writeFileSync(REPORT_PATH, `${JSON.stringify({
  generatedAt: now,
  boardUrl: BOARD_URL,
  appliedCount: campuses.length,
  applied: campuses,
  consolidatedExistingCampusRoutes: [
    "Hawaii Community College",
    "Honolulu Community College",
    "Kauai Community College",
    "Leeward Community College",
  ],
  heldByPolicy: {
    system: "University of Pittsburgh",
    reason: "Official faculty board is Oracle Taleo; retained under the existing platform-wide policy exclusion instead of scraping it.",
  },
}, null, 2)}\n`);
console.log(`Applied ${campuses.length} University of Hawai'i campus controls.`);
