#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeDiscoveredCareerUrl } from "./lib/career-path-probe.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const DISCOVERY_PATH = path.join(ROOT, "generated", "career-discovery-report.json");
const BASELINE_PATH = path.join(ROOT, "generated", "two-year-coverage-pass-report.json");
const CANDIDATES_PATH = path.join(ROOT, "generated", "promotion-candidates-five-state-two-year.json");
const REVIEW_PATH = path.join(ROOT, "generated", "five-state-two-year-pass-report.json");

const STATES = new Set(["CA", "NC", "IL", "TX", "NY"]);
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();

const REJECTED_AUTOMATIC = new Map([
  ["Riverside City College", "The current RCCD applicant portal is district-wide and exposes no reliable campus facet."],
]);

const VERIFIED = [
  {
    name: "Madera Community College",
    career_url: "https://scccd.peopleadmin.com/postings/search?615%5B%5D=14&query_position_type_id%5B%5D=2&query_position_type_id%5B%5D=3&commit=Search",
    platform_type: "peopleadmin",
    coverage_source: "State Center Community College District",
  },
  {
    name: "Reedley College",
    career_url: "https://scccd.peopleadmin.com/postings/search?615%5B%5D=3&query_position_type_id%5B%5D=2&query_position_type_id%5B%5D=3&commit=Search",
    platform_type: "peopleadmin",
    coverage_source: "State Center Community College District",
  },
  {
    name: "Los Medanos College",
    career_url: "https://www.4cdcareers.net/postings/search?449%5B%5D=5&453%5B%5D=2&453%5B%5D=3&commit=Search",
    platform_type: "peopleadmin",
    coverage_source: "Contra Costa Community College District",
  },
  {
    name: "San Jose City College",
    career_url: "https://sjeccd.peopleadmin.com/postings/search?query=San+Jose+City+College&1333%5B%5D=1&1333%5B%5D=4&commit=Search",
    platform_type: "peopleadmin",
    coverage_source: "San Jose-Evergreen Community College District",
  },
  {
    name: "Fullerton College",
    career_url: "https://nocccd.peopleadmin.com/postings/search?query=Fullerton+College&query_position_type_id%5B%5D=2&commit=Search",
    platform_type: "peopleadmin",
    coverage_source: "North Orange County Community College District",
  },
  {
    name: "Orange Coast College",
    career_url: "https://www.schooljobs.com/careers/cccd/promotionaljobs",
    platform_type: "schooljobs",
    locationFilter: "Orange Coast College",
    coverage_source: "Coast Community College District",
  },
  {
    name: "Sacramento City College",
    career_url: "https://www.schooljobs.com/careers/losriosccd",
    platform_type: "schooljobs",
    locationFilter: "Sacramento City College",
    coverage_source: "Los Rios Community College District",
  },
  {
    name: "Saddleback College",
    career_url: "https://www.schooljobs.com/careers/socccd",
    platform_type: "schooljobs",
    locationFilter: "Saddleback",
    coverage_source: "South Orange County Community College District",
  },
  {
    name: "Irvine Valley College",
    career_url: "https://www.schooljobs.com/careers/socccd",
    platform_type: "schooljobs",
    locationFilter: "Irvine Valley",
    coverage_source: "South Orange County Community College District",
  },
  {
    name: "Ventura County Community College System Office",
    career_url: "https://www.schooljobs.com/careers/vcccd",
    platform_type: "schooljobs",
    locationFilter: "District Administrative Center",
    coverage_source: "Ventura County Community College District",
  },
  {
    name: "West Hills Community College District",
    career_url: "https://www.schooljobs.com/careers/whccd",
    platform_type: "schooljobs",
    locationFilter: "District Office",
    coverage_source: "West Hills Community College District",
  },
  { name: "Sandhills Community College", career_url: "https://www.schooljobs.com/careers/sandhills", platform_type: "schooljobs" },
  { name: "North Central Texas College", career_url: "https://employment.nctc.edu/", platform_type: "peopleadmin" },
  { name: "Isothermal Community College", career_url: "https://www.isothermal.edu/employees/human-resources/employment-opportunities.html", platform_type: "generic" },
  { name: "Howard College", career_url: "https://www.howardcollege.edu/careers.html", platform_type: "generic" },
  { name: "Paris Junior College", career_url: "https://www.parisjc.edu/hr/jobs/index.php", platform_type: "generic" },
  { name: "Tarrant County College District", career_url: "https://www.tccd.edu/community/employment/", platform_type: "generic" },
  { name: "Long Beach City College", career_url: "https://www.lbcc.edu/careers", platform_type: "generic" },
  { name: "John A Logan College", career_url: "https://www.jalc.edu/employment-opportunities/", platform_type: "generic" },
].map((item) => ({ ...item, confidence: item.coverage_source ? 0.99 : 0.85 }));

function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
  const discovery = JSON.parse(fs.readFileSync(DISCOVERY_PATH, "utf8"));
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  const institutions = new Map((master.institutions || []).map((item) => [key(item.name), item]));
  const discoveryByName = new Map((discovery.results || []).map((item) => [key(item.name), item]));
  const targets = (baseline.unresolved || []).filter((item) => STATES.has(clean(item.state)));
  if (targets.length !== 100 || Number(discovery.scanned) !== 100) {
    throw new Error(`Expected exactly 100 five-state targets; baseline=${targets.length}, discovery=${discovery.scanned}`);
  }

  const targetNames = new Set(targets.map((item) => key(item.name)));
  const accepted = new Map();
  for (const result of discovery.results || []) {
    if (!targetNames.has(key(result.name)) || result.status !== "discovered" || REJECTED_AUTOMATIC.has(result.name)) continue;
    accepted.set(key(result.name), {
      name: result.name,
      career_url: canonicalizeDiscoveredCareerUrl(result.career_url),
      platform_type: result.platform_type,
      confidence: Number(result.confidence || 0.65),
      evidence: "validated employee-hiring portal linked from an official institution page",
    });
  }
  for (const item of VERIFIED) {
    if (!targetNames.has(key(item.name))) throw new Error(`Verified institution is outside the 100-target set: ${item.name}`);
    accepted.set(key(item.name), {
      ...item,
      evidence: item.coverage_source
        ? `campus-scoped official ${item.coverage_source} hiring source`
        : "manually verified official employee hiring gateway",
    });
  }

  const existingOverrides = new Map((overrides.overrides || []).map((item) => [key(item.name), item]));
  const applied = [];
  for (const item of accepted.values()) {
    const institution = institutions.get(key(item.name));
    if (!institution) throw new Error(`Institution missing from master: ${item.name}`);
    institution.career_url = item.career_url;
    institution.platform_type = item.platform_type;
    institution.coverage_source = item.coverage_source || null;
    institution.last_discovery_status = "five_state_two_year_validated";
    institution.last_discovery_confidence = item.confidence;
    institution.last_checked_at = new Date().toISOString();
    existingOverrides.set(key(item.name), {
      ...(existingOverrides.get(key(item.name)) || {}),
      name: item.name,
      homepage_url: institution.homepage_url,
      career_url: item.career_url,
      platform_type: item.platform_type,
      ...(item.coverage_source ? { coverage_source: item.coverage_source } : {}),
      notes: `Reviewed in the 2026-08-24 five-state two-year pass; ${item.evidence}.`,
    });
    applied.push(item);
  }

  const unresolved = [];
  for (const target of targets) {
    if (accepted.has(key(target.name))) continue;
    const institution = institutions.get(key(target.name));
    if (!institution) throw new Error(`Target institution missing from master: ${target.name}`);
    institution.career_url = null;
    institution.platform_type = null;
    institution.coverage_source = null;
    institution.last_discovery_status = REJECTED_AUTOMATIC.has(target.name)
      ? "five_state_two_year_rejected_unscoped"
      : "five_state_two_year_unresolved";
    institution.last_discovery_confidence = 0;
    unresolved.push({
      name: target.name,
      state: target.state,
      reason: REJECTED_AUTOMATIC.get(target.name) || "No sufficiently reliable employee hiring source found.",
      discoveryStatus: discoveryByName.get(key(target.name))?.status || null,
    });
  }

  master.generatedAt = new Date().toISOString();
  overrides.updatedAt = new Date().toISOString();
  overrides.overrides = [...existingOverrides.values()].sort((a, b) => clean(a.name).localeCompare(clean(b.name)));
  const candidates = applied.map((item) => {
    const institution = institutions.get(key(item.name));
    return {
      unitid: institution.unitid || null,
      name: item.name,
      state: institution.state,
      level: institution.level,
      control: institution.control,
      platform_type: item.platform_type,
      career_url: item.career_url,
      ...(item.locationFilter ? { locationFilter: item.locationFilter } : {}),
      score: item.confidence,
      source: "five-state two-year coverage pass",
    };
  });

  fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n");
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2) + "\n");
  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), count: candidates.length, items: candidates }, null, 2) + "\n");
  fs.writeFileSync(REVIEW_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    scanned: targets.length,
    accepted: applied.length,
    unresolvedCount: unresolved.length,
    acceptedByState: Object.fromEntries([...STATES].sort().map((state) => [state, applied.filter((item) => institutions.get(key(item.name))?.state === state).length])),
    unresolvedByState: Object.fromEntries([...STATES].sort().map((state) => [state, unresolved.filter((item) => item.state === state).length])),
    unresolved,
  }, null, 2) + "\n");
  console.log(`Reviewed ${targets.length}: accepted ${applied.length}, unresolved ${unresolved.length}`);
}

main();
