#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const write = (name, value) => fs.writeFileSync(path.join(ROOT, name), JSON.stringify(value, null, 2) + "\n");
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();

// These discovery hits are deliberately rejected: each is either a single
// requisition or a shared employer board without a durable college facet.
const REJECTED_AUTOMATIC = new Map([
  ["Mid-Plains Community College", "Discovery returned an unrelated hospital requisition; replaced with the college HR page."],
  ["Seminole State College", "Oklahoma's statewide Workday board has no verified Seminole State facet."],
  ["Jefferson Regional School of Nursing", "The ADP tenant is hospital-wide and has no nursing-school scope."],
  ["Riverside City College", "The PeopleAdmin tenant is district-wide and has no verified Riverside campus facet."],
]);

const V = (name, type, url) => ({ name, platform_type: type, career_url: url, confidence: type === "generic" ? 0.9 : 0.98 });
const VERIFIED = [
  V("West Virginia Northern Community College", "schooljobs", "https://www.schooljobs.com/careers/wvnccedu"),
  V("Harford Community College", "peopleadmin", "https://harford.peopleadmin.com/postings/search"),
  V("Iowa Central Community College", "schooljobs", "https://www.schooljobs.com/careers/iowacentral"),
  V("Southern Maine Community College", "generic", "https://www.smccme.edu/about/employment/"),
  V("Metropolitan Community College Area", "workday", "https://mccneb.wd5.myworkdayjobs.com/mccnebjobs"),
  V("Mineral Area College", "schooljobs", "https://www.schooljobs.com/careers/mineralarea"),
  V("River Parishes Community College", "schooljobs", "https://www.governmentjobs.com/careers/louisiana?department[0]=River%20Parishes%20Community%20College&sort=PositionTitle%7CAscending"),
  V("State Fair Community College", "schooljobs", "https://www.governmentjobs.com/careers/sfcc"),
  V("Howard Community College", "peopleadmin", "https://howardcc.peopleadmin.com/postings/search"),
  V("North Idaho College", "pageup", "https://careers.pageuppeople.com/1027/cw/en/listing"),
  V("Mid-Plains Community College", "generic", "https://mpcc.edu/faculty-staff/human-resources/employment-opportunities.php"),

  V("Mohave Community College", "generic", "https://www.mohave.edu/about/employee-services/"),
  V("Mount Wachusett Community College", "generic", "https://mwcc.edu/about/human-resources/jobs/"),
  V("Middlesex Community College", "generic", "https://www.middlesex.edu/humanresources/employment.html"),
  V("Greenfield Community College", "generic", "https://www.gcc.mass.edu/hr/careers/"),
  V("Roxbury Community College", "generic", "https://www.rcc.mass.edu/explore/work-at-rcc/"),
  V("Northern Essex Community College", "generic", "https://www.necc.mass.edu/employment/"),

  V("Lake Michigan College", "generic", "https://www.lakemichigancollege.edu/about/jobs"),
  V("West Shore Community College", "generic", "https://www.westshore.edu/employment/"),
  V("Muskegon Community College", "generic", "https://www.muskegoncc.edu/employment-opportunities/"),
  V("Kalamazoo Valley Community College", "peopleadmin", "https://jobs.kvcc.edu/postings/search"),

  V("Louisiana Delta Community College", "generic", "https://www.ladelta.edu/faculty-and-staff/human-resources/employment-opportunities/"),
  V("Southern University at Shreveport", "generic", "https://www.susla.edu/index.cfm?action=newsroom.category&categoryID=careers"),
  V("South Louisiana Community College", "generic", "https://www.solacc.edu/jobs"),

  V("Northwood Technical College", "generic", "https://www.northwoodtech.edu/about/careers/"),
  V("Southwest Wisconsin Technical College", "generic", "https://swtc.edu/about/job-opportunities"),
  V("Northeast Wisconsin Technical College", "generic", "https://www.nwtc.edu/about-nwtc/talent-and-culture/job-opportunities"),

  V("Oregon Coast Community College", "generic", "https://oregoncoast.edu/about/human-resources/employment-opportunities/"),
  V("Rogue Community College", "schooljobs", "https://www.governmentjobs.com/careers/roguecc"),
  V("Tillamook Bay Community College", "generic", "https://www.tillamookbaycc.edu/about-tbcc/jobs/"),
  V("Treasure Valley Community College", "generic", "https://www.tvcc.cc/hr/jobs.cfm"),
  V("Umpqua Community College", "generic", "https://umpqua.edu/about/governance-operations/human-resources/employment-opportunities/"),
  V("Linn-Benton Community College", "peopleadmin", "https://www.jobs.linnbenton.edu/postings/search"),

  V("Orleans Technical College", "generic", "https://orleanstech.edu/jobs-at-orleans/"),
  V("Northampton County Area Community College", "generic", "https://www.northampton.edu/about/working-at-ncc/employment-opportunities.html"),
  V("Thaddeus Stevens College of Technology", "generic", "https://www.stevenscollege.edu/about/careers/"),

  V("Northeast Community College", "generic", "https://northeast.edu/about-us/employment"),
  V("Metropolitan Community College-Kansas City", "peopleadmin", "https://jobs.mcckc.edu/postings/search"),
  V("Missouri State University-West Plains", "generic", "https://wp.missouristate.edu/EmploymentOpportunities/default.htm"),
  V("Jefferson College", "generic", "https://www.jeffco.edu/human-resources/"),

  V("Pellissippi State Community College", "generic", "https://www.pstcc.edu/hr/"),
  V("Southwest Tennessee Community College", "generic", "https://southwest.tn.edu/hr/jobs.php"),
  V("Nashville State Community College", "generic", "https://www.nscc.edu/faculty-staff/human-resources/job-opportunities.php"),
  V("Motlow State Community College", "generic", "https://www.motlow.edu/employees/hr/"),

  V("Panola College", "generic", "https://www.panola.edu/employment"),
  V("Victoria College", "generic", "https://www.victoriacollege.edu/BusinessCommunity/HumanResources"),

  V("Iowa Lakes Community College", "generic", "https://www.iowalakes.edu/employment/"),
  V("Indian Hills Community College", "generic", "https://www.indianhills.edu/about/employment.php"),
  V("North Iowa Area Community College", "generic", "https://www.niacc.edu/about/employment/"),

  V("Wor-Wic Community College", "generic", "https://www.worwic.edu/About-Wor-Wic/Employment"),
  V("Itawamba Community College", "generic", "https://www.iccms.edu/employment"),
].map((item) => item);

function main() {
  const master = read("data/institutions-master.json");
  const overrides = read("data/career-url-overrides.json");
  const discovery = read("generated/career-discovery-report.json");
  const targets = discovery.results || [];
  const targetKeys = new Set(targets.map((item) => key(item.name)));
  if (Number(discovery.scanned) !== 161 || targetKeys.size !== 161) {
    throw new Error(`Expected exactly 161 targets; scanned=${discovery.scanned}, unique=${targetKeys.size}`);
  }

  const institutions = new Map(master.institutions.map((item) => [key(item.name), item]));
  const accepted = new Map();
  const skippedMappings = [];
  for (const item of VERIFIED) {
    if (!targetKeys.has(key(item.name))) { skippedMappings.push(item.name); continue; }
    accepted.set(key(item.name), item);
  }
  const overrideMap = new Map((overrides.overrides || []).map((item) => [key(item.name), item]));
  const applied = [];
  const unresolved = [];
  const now = new Date().toISOString();
  for (const target of targets) {
    const institution = institutions.get(key(target.name));
    if (!institution) throw new Error(`Missing master institution: ${target.name}`);
    const item = accepted.get(key(target.name));
    if (item) {
      institution.career_url = item.career_url;
      institution.platform_type = item.platform_type;
      institution.coverage_source = null;
      institution.coverage_status = "covered";
      institution.last_discovery_status = "final_two_year_validated";
      institution.last_discovery_confidence = item.confidence;
      institution.last_checked_at = now;
      overrideMap.set(key(item.name), {
        ...(overrideMap.get(key(item.name)) || {}), name: item.name,
        homepage_url: institution.homepage_url, career_url: item.career_url,
        platform_type: item.platform_type,
        notes: "Official institution-scoped employee hiring source, verified in the 2026-08-24 final two-year closeout.",
      });
      applied.push(item);
    } else {
      institution.career_url = null;
      institution.platform_type = null;
      institution.coverage_source = null;
      institution.coverage_status = "missing";
      institution.last_discovery_status = REJECTED_AUTOMATIC.has(target.name) ? "final_two_year_rejected_unscoped" : "final_two_year_reviewed_unresolved";
      institution.last_discovery_confidence = 0;
      institution.last_checked_at = now;
      overrideMap.delete(key(target.name));
      unresolved.push({ name: target.name, state: target.state, reason: REJECTED_AUTOMATIC.get(target.name) || "No reliable institution-scoped employee hiring source was verified." });
    }
  }

  overrides.updatedAt = now;
  overrides.overrides = [...overrideMap.values()].sort((a, b) => clean(a.name).localeCompare(clean(b.name)));
  master.generatedAt = now;
  master.counts.covered = master.institutions.filter((item) => item.coverage_status === "covered").length;
  master.counts.missing = master.institutions.filter((item) => item.coverage_status === "missing").length;
  const candidates = applied.map((item) => {
    const institution = institutions.get(key(item.name));
    return { unitid: institution.unitid || null, name: item.name, state: institution.state, level: institution.level, control: institution.control, platform_type: item.platform_type, career_url: item.career_url, score: item.confidence, source: "final two-year closeout" };
  });
  write("data/institutions-master.json", master);
  write("data/career-url-overrides.json", overrides);
  write("generated/promotion-candidates-final-two-year.json", { generatedAt: now, count: candidates.length, items: candidates });
  write("generated/final-two-year-closeout-report.json", { generatedAt: now, scanned: 161, accepted: applied.length, unresolvedCount: unresolved.length, rejectedAutomatic: [...REJECTED_AUTOMATIC].map(([name, reason]) => ({ name, reason })), skippedMappings, unresolved });
  console.log(`Reviewed 161: accepted ${applied.length}, unresolved ${unresolved.length}, skipped mappings ${skippedMappings.length}`);
  if (skippedMappings.length) console.log(`Skipped (not in this frozen batch): ${skippedMappings.join("; ")}`);
}

main();
