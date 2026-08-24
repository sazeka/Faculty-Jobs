#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const write = (name, value) => fs.writeFileSync(path.join(ROOT, name), JSON.stringify(value, null, 2) + "\n");
const key = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

const VERIFIED = [
  {
    name: "Saint Elizabeth College of Nursing",
    career_url: "https://careers.mvhealthsystem.org/search/?q=instructor&sortColumn=referencedate&sortDirection=desc",
    platform_type: "mvhs-successfactors",
    scope: "Exact Facility = COLLEGE OF NURSING",
  },
  {
    name: "St Joseph School of Nursing",
    career_url: "https://careers.covenanthealth.net/?keyword=instructor",
    platform_type: "covenant-health-search",
    scope: "Exact Department = SCHOOL OF NURSING",
  },
  {
    name: "St. Joseph's College of Nursing",
    career_url: "https://jobs.trinity-health.org/stjosephshealth/search-results?keywords=College%20of%20Nursing",
    platform_type: "trinity-health-search",
    scope: "Posting title contains College of Nursing",
  },
];

const UNRESOLVED = [
  {
    name: "Cochran School of Nursing",
    reason: "The school confirms St. John's Riverside Hospital as its parent, but no durable Cochran-specific hiring facet or employee openings page was found.",
  },
  {
    name: "Jefferson Regional School of Nursing",
    reason: "Jefferson Regional's ADP tenant remains hospital-wide and exposes no verified school-specific facet.",
  },
  {
    name: "Lawrence Memorial Hospital School of Nursing",
    reason: "The nursing program moved to Regis College in 2025; the former institution has no separate current hiring source, and the broad Regis board cannot be safely attributed to it.",
  },
];

function main() {
  const master = read("data/institutions-master.json");
  const overrides = read("data/career-url-overrides.json");
  const institutions = new Map(master.institutions.map((row) => [key(row.name), row]));
  const overrideMap = new Map((overrides.overrides || []).map((row) => [key(row.name), row]));
  const now = new Date().toISOString();

  for (const item of VERIFIED) {
    const institution = institutions.get(key(item.name));
    if (!institution) throw new Error(`Missing institution: ${item.name}`);
    institution.career_url = item.career_url;
    institution.platform_type = item.platform_type;
    institution.coverage_source = null;
    institution.coverage_status = "covered";
    institution.verification_status = "verified";
    institution.last_verified_at = now;
    institution.last_checked_at = now;
    institution.last_discovery_status = "hospital_affiliate_scoped_source_validated";
    institution.last_discovery_confidence = 0.99;
    overrideMap.set(key(item.name), {
      ...(overrideMap.get(key(item.name)) || {}),
      name: item.name,
      homepage_url: institution.homepage_url,
      career_url: item.career_url,
      platform_type: item.platform_type,
      notes: `Official parent-system employee source verified 2026-08-24. ${item.scope}; unrelated hospital jobs are excluded.`,
    });
  }

  for (const item of UNRESOLVED) {
    const institution = institutions.get(key(item.name));
    if (!institution) throw new Error(`Missing institution: ${item.name}`);
    if (institution.coverage_status !== "missing") {
      throw new Error(`Expected unresolved institution to remain missing: ${item.name}`);
    }
    institution.last_checked_at = now;
    institution.last_discovery_status = "hospital_affiliate_reviewed_unresolved";
    institution.last_discovery_confidence = 0;
  }

  master.generatedAt = now;
  master.counts.covered = master.institutions.filter((row) => row.coverage_status === "covered").length;
  master.counts.missing = master.institutions.filter((row) => row.coverage_status === "missing").length;
  overrides.updatedAt = now;
  overrides.overrides = [...overrideMap.values()].sort((a, b) => key(a.name).localeCompare(key(b.name)));

  write("data/institutions-master.json", master);
  write("data/career-url-overrides.json", overrides);
  write("generated/hospital-nursing-school-pass-report.json", {
    generatedAt: now,
    reviewed: VERIFIED.length + UNRESOLVED.length,
    accepted: VERIFIED.length,
    unresolvedCount: UNRESOLVED.length,
    acceptedSources: VERIFIED,
    unresolved: UNRESOLVED,
  });
  console.log(`Hospital nursing-school pass: accepted ${VERIFIED.length}, unresolved ${UNRESOLVED.length}`);
}

main();
