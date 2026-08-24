#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = path.join(ROOT, "data/institutions-master.json");
const OVERRIDES = path.join(ROOT, "data/career-url-overrides.json");
const REPORT = path.join(ROOT, "generated/official-hiring-page-two-year-pass-report.json");
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();

const VERIFIED = [
  ["Pima Community College", "https://www.schooljobs.com/careers/pimacc", "schooljobs"],
  ["White Earth Tribal and Community College", "https://www.wetcc.edu/employment-careers/"],
  ["Little Priest Tribal College", "https://www.littlepriest.edu/human-resources/"],
  ["Lakeshore Technical College", "https://careers.lakeshore.edu/jobs"],
  ["Moraine Park Technical College", "https://www.morainepark.edu/experience-mptc/jobs-and-careers/"],
  ["Waukesha County Technical College", "https://www.wctc.edu/WCTC/WCTC-Jobs"],
  ["Western Technical College", "https://www.westerntc.edu/work-at-western"],
  ["North Central Michigan College", "https://www.ncmich.edu/about-us/our-team/join-our-team.html"],
  ["CAAN Academy of Nursing", "https://www.caanacademy.org/employment-opportunities"],
  ["Illinois Valley Community College", "https://www.applitrack.com/ivcc/onlineapp/default.aspx?Category=Faculty+Full-Time", "applitrack"],
  ["Southern West Virginia Community and Technical College", "https://www.southernwv.edu/facultystaff/human-resources/"],
  ["Kilgore College", "https://www.kilgore.edu/additional-resources/human-resources/"],
  ["Ranger College", "https://www.rangercollege.edu/about-us/human-resources/index.php"],
  ["Hagerstown Community College", "https://www.hagerstowncc.edu/human-resources"],
  ["Richard Bland College", "https://www.jobs.virginia.gov/jobs/search?query=Richard+Bland+College"],
  ["Southside College of Health Sciences", "https://www.schs.edu/employment-opportunities"],
  ["Mississippi Delta Community College", "https://www.msdelta.edu/human-resources/employment-opportunities.php"],
  ["Southwest Mississippi Community College", "https://www.smcc.edu/employment-opportunities/"],
  ["Nunez Community College", "https://www.nunez.edu/careers"],
  ["State Technical College of Missouri", "https://statetechmo.edu/human-resources/"],
  ["Tennessee Board of Regents", "https://www.tbr.edu/hr/employment-opportunities"],
].map(([name, career_url, platform_type = "generic"]) => ({ name, career_url, platform_type }));

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
      institution.last_discovery_status !== "official_employee_hiring_page_validated"
    ) {
      throw new Error(`Expected missing status before this pass: ${item.name}`);
    }
    institution.career_url = item.career_url;
    institution.platform_type = item.platform_type;
    institution.coverage_source = null;
    institution.coverage_status = "covered";
    institution.last_discovery_status = "official_employee_hiring_page_validated";
    institution.last_discovery_confidence = 0.95;
    institution.last_checked_at = now;
    overrideMap.set(key(item.name), {
      ...(overrideMap.get(key(item.name)) || {}),
      name: item.name,
      homepage_url: institution.homepage_url,
      career_url: item.career_url,
      platform_type: item.platform_type,
      notes: "Official institution-scoped employee hiring page verified in the 2026-08-24 remaining two-year deep pass.",
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
  console.log(`Applied ${applied.length} verified official employee hiring pages`);
}

main();
