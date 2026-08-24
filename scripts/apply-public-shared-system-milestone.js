#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = path.join(ROOT, "data/institutions-master.json");
const OVERRIDES = path.join(ROOT, "data/career-url-overrides.json");
const REPORT = path.join(ROOT, "generated/public-shared-system-milestone-report.json");
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();
const LACCD_URL = "https://laccd.csod.com/ats/careersite/search.aspx?site=6&c=laccd";

const VERIFIED = [
  ["Los Angeles City College", "csod", LACCD_URL, "Los Angeles City College + Faculty - Full-Time"],
  ["Los Angeles Harbor College", "csod", LACCD_URL, "Los Angeles Harbor College + Faculty - Full-Time"],
  ["Los Angeles Pierce College", "csod", LACCD_URL, "Pierce College + Faculty - Full-Time"],
  ["Los Angeles Southwest College", "csod", LACCD_URL, "Los Angeles Southwest College + Faculty - Full-Time"],
  ["Los Angeles Trade Technical College", "csod", LACCD_URL, "Los Angeles Trade -Technical College + Faculty - Full-Time"],
  ["San Bernardino Community College District", "schooljobs", "https://www.schooljobs.com/careers/sbccd", "Institution-level district tenant + Academic Full-Time evidence"],
].map(([name, platform_type, career_url, scope]) => ({ name, platform_type, career_url, scope }));

function main() {
  const master = JSON.parse(fs.readFileSync(MASTER, "utf8"));
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES, "utf8"));
  const institutions = new Map(master.institutions.map((item) => [key(item.name), item]));
  const overrideMap = new Map((overrides.overrides || []).map((item) => [key(item.name), item]));
  const now = new Date().toISOString();
  const applied = [];

  for (const item of VERIFIED) {
    const institution = institutions.get(key(item.name));
    if (!institution) throw new Error(`Institution not found: ${item.name}`);
    if (institution.level !== "2-year" || institution.control !== "public") {
      throw new Error(`Expected a public two-year institution: ${item.name}`);
    }
    if (
      institution.coverage_status !== "missing" &&
      institution.last_discovery_status !== "public_shared_system_validated"
    ) {
      throw new Error(`Expected missing status before this milestone: ${item.name}`);
    }
    institution.career_url = item.career_url;
    institution.platform_type = item.platform_type;
    institution.coverage_source = null;
    institution.coverage_status = "covered";
    institution.last_discovery_status = "public_shared_system_validated";
    institution.last_discovery_confidence = 0.98;
    institution.last_checked_at = now;
    overrideMap.set(key(item.name), {
      ...(overrideMap.get(key(item.name)) || {}),
      name: item.name,
      homepage_url: institution.homepage_url,
      career_url: item.career_url,
      platform_type: item.platform_type,
      notes: `Official employee hiring source verified in the 2026-08-24 public shared-system milestone. Scope: ${item.scope}.`,
    });
    applied.push({ ...item, state: institution.state, control: institution.control });
  }

  master.generatedAt = now;
  master.counts.covered = master.institutions.filter((item) => item.coverage_status === "covered").length;
  master.counts.missing = master.institutions.filter((item) => item.coverage_status === "missing").length;
  overrides.updatedAt = now;
  overrides.overrides = [...overrideMap.values()].sort((a, b) => clean(a.name).localeCompare(clean(b.name)));
  fs.writeFileSync(MASTER, JSON.stringify(master, null, 2) + "\n");
  fs.writeFileSync(OVERRIDES, JSON.stringify(overrides, null, 2) + "\n");
  fs.writeFileSync(REPORT, JSON.stringify({
    generatedAt: now,
    reviewed: 7,
    accepted: applied.length,
    unresolved: [{
      name: "Little Big Horn College",
      state: "MT",
      reason: "The official site currently refuses connections and only an individual adjunct posting packet could be verified; no durable employee vacancy index was available.",
    }],
    applied,
  }, null, 2) + "\n");
  console.log(`Applied ${applied.length} verified public shared-system sources; 1 remains unresolved`);
}

main();
