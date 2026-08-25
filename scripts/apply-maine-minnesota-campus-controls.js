#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PATH = path.join(ROOT, "server.js");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const REPORT_PATH = path.join(ROOT, "generated", "maine-minnesota-campus-control-milestone.json");
const ORACLE_BASE = "https://fa-ewca-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs";
const ORACLE_FACULTY_CATEGORY = "300000014335735";
const UMN_URL = "https://hr.myu.umn.edu/psc/hrprd/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL&ACTION=U&FOCUS=Applicant&SiteId=1";

const maine = [
  ["University of Maine at Farmington", "300000014113586", "University of Maine at Farmington"],
  ["University of Maine at Fort Kent", "300000014113599", "University of Maine at Fort Kent"],
  ["University of Maine at Presque Isle", "300000014113651", "University of Maine at Presque Isle"],
  ["University of Maine-System Central Office", "300000014113664", "Governance and University Services"],
].map(([name, control, descriptor]) => {
  const url = `${ORACLE_BASE}?lastSelectedFacet=ORGANIZATIONS&selectedOrganizationsFacet=${control}&selectedCategoriesFacet=${ORACLE_FACULTY_CATEGORY}`;
  return { name, source: "University of Maine System", platformType: "oracle-cloud-api", controlType: "oracle_organization", control, descriptor, url };
});

const minnesota = [
  ["University of Minnesota-Crookston", "Crookston"],
  ["University of Minnesota-Duluth", "Duluth"],
  ["University of Minnesota-Morris", "Morris"],
  ["University of Minnesota-Rochester", "Rochester"],
].map(([name, control]) => ({
  name,
  source: "University of Minnesota",
  platformType: "peoplesoft",
  controlType: "peoplesoft_location",
  control,
  descriptor: control,
  url: UMN_URL,
}));

let server = fs.readFileSync(SERVER_PATH, "utf8");
if (!server.includes(`campus: ${JSON.stringify(maine[0].name)}`)) {
  const marker = '  {\n    campus: "University of Maine System",';
  const index = server.indexOf(marker);
  if (index < 0) throw new Error("Could not find University of Maine System insertion marker");
  const configs = maine.map((item) => `  { campus: ${JSON.stringify(item.name)}, type: "oracle-cloud-api", url: ${JSON.stringify(item.url)} },`).join("\n");
  server = `${server.slice(0, index)}${configs}\n${server.slice(index)}`;
}

if (!server.includes('if (type === "oracle-cloud-api") return await scrapeOracleCloudApi(url, campus, "ME");')) {
  const marker = '        if (type === "oracle-cx") return await scrapeOracleCxAs(context, url, campus, "ME");';
  if (!server.includes(marker)) throw new Error("Could not find Maine Oracle dispatcher marker");
  server = server.replace(marker, `${marker}\n        if (type === "oracle-cloud-api") return await scrapeOracleCloudApi(url, campus, "ME");`);
}

if (!server.includes('.map(splitUmnCampus)\n    .map(splitMinnStateSystemCollege)')) {
  const marker = '    .flatMap((x) => (Array.isArray(x) ? x : []))\n    .map(splitMinnStateSystemCollege);';
  if (!server.includes(marker)) throw new Error("Could not find Minnesota attribution pipeline marker");
  server = server.replace(marker, '    .flatMap((x) => (Array.isArray(x) ? x : []))\n    .map(splitUmnCampus)\n    .map(splitMinnStateSystemCollege);');
}

if (!server.includes('export function splitUmnCampus(job)')) {
  const marker = '/* ============================== ND ============================== */';
  const splitter = `export function splitUmnCampus(job) {
  if (clean(job?.college) !== "University of Minnesota") return job;
  const campusByLocation = {
    crookston: "University of Minnesota-Crookston",
    duluth: "University of Minnesota-Duluth",
    morris: "University of Minnesota-Morris",
    rochester: "University of Minnesota-Rochester",
  };
  const campus = campusByLocation[clean(job?.location).toLowerCase()];
  return campus ? { ...job, college: campus } : job;
}

`;
  if (!server.includes(marker)) throw new Error("Could not find Minnesota splitter insertion marker");
  server = server.replace(marker, `${splitter}${marker}`);
}

const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const overrideMap = new Map((overrides.overrides || []).map((item) => [item.name.toLowerCase(), item]));
const institutionMap = new Map((master.institutions || []).map((item) => [item.name.toLowerCase(), item]));
const applied = [];
const now = new Date().toISOString();

for (const item of [...maine, ...minnesota]) {
  const notes = item.controlType === "oracle_organization"
    ? `Verified 2026-08-25 through the official University of Maine System Oracle recruiting API: exact organization facet ${item.control} (${item.descriptor}), combined with the official Faculty category facet ${ORACLE_FACULTY_CATEGORY}.`
    : `Verified 2026-08-25 through the official University of Minnesota PeopleSoft feed: job rows expose the exact campus location ${item.control}; the shared scraper maps only that exact location to this institution.`;
  const entry = {
    name: item.name,
    career_url: item.url,
    platform_type: item.platformType,
    coverage_source: item.source,
    notes,
  };
  const prior = overrideMap.get(item.name.toLowerCase());
  if (prior) Object.assign(prior, entry);
  else {
    overrides.overrides.push(entry);
    overrideMap.set(item.name.toLowerCase(), entry);
  }

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
  if (!String(institution.notes || "").includes(`${item.controlType === "oracle_organization" ? "organization facet" : "exact campus location"} ${item.control}`)) {
    institution.notes = `${String(institution.notes || "").trim()} ${notes}`.trim();
  }
  applied.push(item);
}

overrides.updatedAt = now;
master.generatedAt = now;
master.counts.covered = master.institutions.filter((item) => item.coverage_status === "covered").length;
master.counts.missing = master.institutions.filter((item) => item.coverage_status === "missing").length;
fs.writeFileSync(SERVER_PATH, server);
fs.writeFileSync(OVERRIDES_PATH, `${JSON.stringify(overrides, null, 2)}\n`);
fs.writeFileSync(MASTER_PATH, `${JSON.stringify(master, null, 2)}\n`);
fs.writeFileSync(REPORT_PATH, `${JSON.stringify({
  generatedAt: now,
  oracleFacultyCategory: ORACLE_FACULTY_CATEGORY,
  appliedCount: applied.length,
  applied,
  deferredForEfficientSplitter: [
    { system: "University of Hawaii System", campuses: 4, reason: "Exact NEOGOV department markers verified; implement one shared-board campus splitter instead of four additional full-board scrapes." },
    { system: "University of Pittsburgh", campuses: 4, reason: "Exact Taleo city facets verified for current jobs; implement one faculty-board splitter and preserve zero-post campus handling." },
  ],
}, null, 2)}\n`);

console.log(`Applied ${applied.length} Maine and Minnesota campus controls.`);
