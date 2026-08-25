#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const write = (name, value) => fs.writeFileSync(path.join(ROOT, name), JSON.stringify(value, null, 2) + "\n");
const key = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

const PIERCE_BOARD = "https://recruiting.paylocity.com/recruiting/jobs/All/aef0ebce-1684-4c34-9d19-5e97f0ed0071/Pierce-Mortuary-Colleges-Inc";

const VERIFIED = [
  {
    name: "Gupton Jones College of Funeral Service",
    career_url: PIERCE_BOARD,
    platform_type: "paylocity-shared",
    scope: "Exact Paylocity location = GUPTON-JONES",
    evidence: "The college's official Work With Us section links to the Pierce Mortuary Colleges board.",
  },
  {
    name: "Mid-America College of Funeral Service",
    career_url: PIERCE_BOARD,
    platform_type: "paylocity-shared",
    scope: "Exact Paylocity location = MID-AMERICA",
    evidence: "The shared official board currently carries a Mid-America full-time funeral-service instructor posting.",
  },
];

const UNRESOLVED = [
  {
    name: "American Academy McAllister Institute of Funeral Service",
    reason: "The official site exposes student career information, but no durable employee openings page or institution-scoped hiring board was verified.",
  },
  {
    name: "John A Gupton College",
    reason: "The official site and current catalog discuss graduate employment and employment policy, but expose no public employee openings source.",
  },
  {
    name: "Pittsburgh Institute of Mortuary Science Inc",
    reason: "The public PIMS jobs area is a referral board for students and alumni, not an employee hiring source for the institute.",
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
    institution.last_discovery_status = "funeral_service_scoped_source_validated";
    institution.last_discovery_confidence = 0.99;
    overrideMap.set(key(item.name), {
      ...(overrideMap.get(key(item.name)) || {}),
      name: item.name,
      homepage_url: institution.homepage_url,
      career_url: item.career_url,
      platform_type: item.platform_type,
      notes: `Official employee source verified 2026-08-24. ${item.scope}; sibling-college jobs are excluded. ${item.evidence}`,
    });
  }

  for (const item of UNRESOLVED) {
    const institution = institutions.get(key(item.name));
    if (!institution) throw new Error(`Missing institution: ${item.name}`);
    if (institution.coverage_status !== "missing") {
      throw new Error(`Expected unresolved institution to remain missing: ${item.name}`);
    }
    institution.last_checked_at = now;
    institution.last_discovery_status = "funeral_service_reviewed_unresolved";
    institution.last_discovery_confidence = 0;
  }

  master.generatedAt = now;
  master.counts.covered = master.institutions.filter((row) => row.coverage_status === "covered").length;
  master.counts.missing = master.institutions.filter((row) => row.coverage_status === "missing").length;
  overrides.updatedAt = now;
  overrides.overrides = [...overrideMap.values()].sort((a, b) => key(a.name).localeCompare(key(b.name)));

  write("data/institutions-master.json", master);
  write("data/career-url-overrides.json", overrides);
  write("generated/funeral-service-college-pass-report.json", {
    generatedAt: now,
    requestedMilestoneReviewed: 4,
    bonusSiblingReviewed: 1,
    reviewed: VERIFIED.length + UNRESOLVED.length,
    accepted: VERIFIED.length,
    unresolvedCount: UNRESOLVED.length,
    acceptedSources: VERIFIED,
    unresolved: UNRESOLVED,
  });
  console.log(`Funeral-service college pass: accepted ${VERIFIED.length}, unresolved ${UNRESOLVED.length}`);
}

main();
