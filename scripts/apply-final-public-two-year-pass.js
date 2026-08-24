#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = path.join(ROOT, "data/institutions-master.json");
const OVERRIDES = path.join(ROOT, "data/career-url-overrides.json");
const REPORT = path.join(ROOT, "generated/final-public-two-year-pass-report.json");
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();

const VERIFIED = [
  ["Georgia State University-Perimeter College", "peopleadmin", "https://facultycareers.gsu.edu/postings/search?query_position_type_id%5B%5D=3&query_position_type_id%5B%5D=4&query_organizational_tier_2_id%5B%5D=429&commit=Search"],
  ["Grossmont College", "workday", "https://gcccd.wd1.myworkdayjobs.com/gcccdcareers?locations=ca95798f91ff0127dc8b3f75671b1cae"],
  ["Luzerne County Community College", "generic", "https://www.luzerne.edu/about/jobs/jobs.jsp"],
  ["Ohlone College", "schooljobs", "https://www.schooljobs.com/careers/ohlone"],
  ["Southwest Texas College", "swtx-employment", "https://www.swtxc.edu/about/employment-opportunities/"],
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
    if (institution.level !== "2-year" || institution.control !== "public") {
      throw new Error(`Expected a public two-year institution: ${item.name}`);
    }
    if (
      institution.coverage_status !== "missing" &&
      institution.last_discovery_status !== "final_public_two_year_hiring_page_validated"
    ) {
      throw new Error(`Expected missing status before this pass: ${item.name}`);
    }
    institution.career_url = item.career_url;
    institution.platform_type = item.platform_type;
    institution.coverage_source = null;
    institution.coverage_status = "covered";
    institution.last_discovery_status = "final_public_two_year_hiring_page_validated";
    institution.last_discovery_confidence = 0.98;
    institution.last_checked_at = now;
    overrideMap.set(key(item.name), {
      ...(overrideMap.get(key(item.name)) || {}),
      name: item.name,
      homepage_url: institution.homepage_url,
      career_url: item.career_url,
      platform_type: item.platform_type,
      notes: "Official institution-scoped employee hiring source verified in the 2026-08-24 final public two-year-colleges pass.",
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
  console.log(`Applied ${applied.length} verified public two-year hiring sources`);
}

main();
