#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = path.join(ROOT, "data/institutions-master.json");
const OVERRIDES = path.join(ROOT, "data/career-url-overrides.json");
const REPORT = path.join(ROOT, "generated/final-specialty-two-year-pass-report.json");
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();

const VERIFIED = [
  ["Hawaii Tokai International College", "dayforce", "https://www.dayforcehcm.com/api/HTIC/V1/JobFeeds"],
  ["Helms College", "paycom", "https://www.paycomonline.net/v4/ats/web.php/jobs?clientkey=CDA1B79B0620249447CBC9E755D51645"],
  ["Jacksonville College-Main Campus", "generic", "https://sites.google.com/jacksonville-college.edu/jchr/home"],
  ["Northern Maine Community College", "paycom", "https://www.paycomonline.net/v4/ats/web.php/jobs?clientkey=910231577C34180857BE4AB5F766DEF5"],
  ["Northshore Technical Community College", "generic", "https://www.northshorecollege.edu/resources/career-opportunities"],
  ["Northwest School of Wooden Boat Building", "generic", "https://nwswb.edu/employment/"],
  ["Rosedale Bible College", "generic", "https://rosedale.edu/hiring/"],
  ["Shorter College", "generic", "https://shortercollege.edu/careers/"],
  ["Ultimate Medical Academy", "generic", "https://job-boards.greenhouse.io/umaeducationinc/"],
  ["University of New Mexico-Los Alamos Campus", "csod", "https://unm.csod.com/ux/ats/careersite/18/home?c=unm&cfdd[0][id]=255&cfdd[0][options][0]=1915&cfdd[0][options][1]=1916&cfdd[0][options][2]=1917"],
  ["Waubonsee Community College", "csod", "https://waubonsee.csod.com/ux/ats/careersite/11/home?c=waubonsee"],
  ["York County Community College", "paycom", "https://www.paycomonline.net/v4/ats/web.php/jobs?clientkey=E6927E90DEBB918D88790AD51A36C462"],
].map(([name, platform_type, career_url]) => ({ name, platform_type, career_url }));

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
    if (
      institution.coverage_status !== "missing" &&
      institution.last_discovery_status !== "final_specialty_hiring_page_validated"
    ) {
      throw new Error(`Expected missing status before this pass: ${item.name}`);
    }
    institution.career_url = item.career_url;
    institution.platform_type = item.platform_type;
    institution.coverage_source = null;
    institution.coverage_status = "covered";
    institution.last_discovery_status = "final_specialty_hiring_page_validated";
    institution.last_discovery_confidence = 0.97;
    institution.last_checked_at = now;
    overrideMap.set(key(item.name), {
      ...(overrideMap.get(key(item.name)) || {}),
      name: item.name,
      homepage_url: institution.homepage_url,
      career_url: item.career_url,
      platform_type: item.platform_type,
      notes: "Official institution-scoped employee hiring source verified in the 2026-08-24 final specialty-colleges pass.",
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
  fs.writeFileSync(REPORT, JSON.stringify({ generatedAt: now, reviewed: VERIFIED.length, accepted: applied.length, applied }, null, 2) + "\n");
  console.log(`Applied ${applied.length} verified specialty two-year hiring sources`);
}

main();
