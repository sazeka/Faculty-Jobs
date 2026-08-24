#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = path.join(ROOT, "data/institutions-master.json");
const OVERRIDES = path.join(ROOT, "data/career-url-overrides.json");
const REPORT = path.join(ROOT, "generated/shared-system-two-year-pass-report.json");
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();

const VERIFIED = [
  ["Riverside City College", "peopleadmin", "https://jobs.rccd.edu/postings/search?1541%5B%5D=2&query_organizational_tier_1_id%5B%5D=756&commit=Search", "RCCD full-time faculty + Riverside organizational-tier facets"],
  ["Norco College", "peopleadmin", "https://jobs.rccd.edu/postings/search?1541%5B%5D=2&query_organizational_tier_1_id%5B%5D=755&commit=Search", "RCCD full-time faculty + Norco organizational-tier facets"],
  ["San Bernardino Valley College", "schooljobs", "https://www.schooljobs.com/careers/sbccd", "SBCCD card-level campus filter"],
  ["Rowan College of South Jersey-Gloucester Campus", "schooljobs", "https://www.schooljobs.com/careers/rcsjedu", "official Gloucester-only NEOGOV board"],
  ["Rowan College of South Jersey-Cumberland Campus", "schooljobs", "https://www.schooljobs.com/careers/rcsjedu/promotionaljobs", "official Cumberland-only NEOGOV sub-board"],
  ["Hawaii Community College", "schooljobs", "https://www.schooljobs.com/careers/hawaiiedu?keywords=Hawai%27i%20Community%20College", "exact University of Hawaii job-card department marker"],
  ["Honolulu Community College", "schooljobs", "https://www.schooljobs.com/careers/hawaiiedu?keywords=Honolulu%20Community%20College", "exact University of Hawaii job-card department marker"],
  ["Kauai Community College", "schooljobs", "https://www.schooljobs.com/careers/hawaiiedu?keywords=Kaua%27i%20Community%20College", "exact University of Hawaii job-card department marker"],
  ["Leeward Community College", "schooljobs", "https://www.schooljobs.com/careers/hawaiiedu?keywords=Leeward%20Community%20College", "exact University of Hawaii job-card department marker"],
  ["Great Falls College Montana State University", "peopleadmin", "https://jobs.gfcmsu.edu/postings/search?sort=225+asc", "institution-specific PeopleAdmin tenant"],
  ["Helena College University of Montana", "generic", "https://helenacollege.edu/hr/job_opp.aspx", "official institution-specific employee openings page"],
  ["Nebraska College of Technical Agriculture", "peopleadmin", "https://employment.unl.edu/postings/search?query_position_type_id%5B%5D=2&query_organizational_tier_3_id%5B%5D=245&commit=Search", "University of Nebraska faculty + NCTA department facets"],
  ["Ohio State University Agricultural Technical Institute", "workday", "https://osu.wd1.myworkdayjobs.com/OSUCareers?locations=819c1ab743bd01b092af970065019db6&jobFamilyGroup=67612469e2ea01a29e348f105b01ff10", "Ohio State Academic + Wooster Campus Workday facets"],
].map(([name, platform_type, career_url, evidence]) => ({ name, platform_type, career_url, evidence }));

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
    if (institution.level !== "2-year") throw new Error(`Expected a two-year institution: ${item.name}`);
    institution.career_url = item.career_url;
    institution.platform_type = item.platform_type;
    institution.coverage_source = null;
    institution.coverage_status = "covered";
    institution.last_discovery_status = "shared_system_campus_validated";
    institution.last_discovery_confidence = 0.98;
    institution.last_checked_at = now;
    overrideMap.set(key(item.name), {
      ...(overrideMap.get(key(item.name)) || {}),
      name: item.name,
      homepage_url: institution.homepage_url,
      career_url: item.career_url,
      platform_type: item.platform_type,
      notes: `Verified 2026-08-24 shared-system pass: ${item.evidence}.`,
    });
    applied.push({ ...item, state: institution.state });
  }

  master.generatedAt = now;
  master.counts.covered = master.institutions.filter((item) => item.coverage_status === "covered").length;
  master.counts.missing = master.institutions.filter((item) => item.coverage_status === "missing").length;
  overrides.updatedAt = now;
  overrides.overrides = [...overrideMap.values()].sort((a, b) => clean(a.name).localeCompare(clean(b.name)));
  fs.writeFileSync(MASTER, JSON.stringify(master, null, 2) + "\n");
  fs.writeFileSync(OVERRIDES, JSON.stringify(overrides, null, 2) + "\n");
  fs.writeFileSync(REPORT, JSON.stringify({ generatedAt: now, reviewed: VERIFIED.length, accepted: applied.length, applied }, null, 2) + "\n");
  console.log(`Applied ${applied.length} safely scoped two-year sources`);
}

main();
