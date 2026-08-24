#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const DISCOVERY_PATH = path.join(ROOT, "generated", "career-discovery-report.json");
const CANDIDATES_PATH = path.join(ROOT, "generated", "promotion-candidates-next-100-two-year.json");
const REVIEW_PATH = path.join(ROOT, "generated", "next-100-two-year-deep-pass-report.json");

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();

const REJECTED_AUTOMATIC = new Map([
  ["Seminole State College", "The discovered Workday board covers all Oklahoma state agencies and has no verified college facet."],
  ["Jefferson Regional School of Nursing", "The discovered ADP board is hospital-wide and has no reliable nursing-school scope."],
  ["Riverside City College", "The discovered PeopleAdmin tenant is shared by the Riverside district and has no verified campus facet."],
  ["University of New Mexico-Gallup Campus", "The discovered URL is one CSOD requisition, not a durable campus job board."],
  ["University of Arkansas Community College Rich Mountain", "The unfiltered discovery was system-wide; replaced below with a verified hiring-company facet."],
]);

const UASYS = "https://uasys.wd5.myworkdayjobs.com/UASYS?hiringCompany=";
const CCSNH = "https://ccsnh.hrmdirect.com/employment/job-openings.php?search=true&cust_sort1=";

const VERIFIED = [
  // Arkansas: the University of Arkansas System tenant exposes stable hiring-company facets.
  ["NorthWest Arkansas Community College", "workday", "https://nwacc.wd1.myworkdayjobs.com/NWACC_External_Career_Site"],
  ["University of Arkansas-Pulaski Technical College", "workday", `${UASYS}720b21cbdf24017c59cf3b59c4010b07`],
  ["Phillips Community College of the University of Arkansas", "workday", `${UASYS}720b21cbdf2401858e792259c401c306`],
  ["University of Arkansas Community College-Morrilton", "workday", `${UASYS}720b21cbdf24019adc09f758c4011306`],
  ["University of Arkansas Community College-Batesville", "workday", `${UASYS}720b21cbdf24011c8d3b2559c401cf06`],
  ["University of Arkansas Community College Rich Mountain", "workday", `${UASYS}720b21cbdf2401ab0e02fb58c4011f06`],

  // California: independent official employee-employment pages/tenants only.
  ["San Joaquin Delta College", "generic", "https://www.deltacollege.edu/jobs-delta"],
  ["Monterey Peninsula College", "generic", "https://www.mpc.edu/about/human-resources/employment.html"],
  ["Mt San Antonio College", "peopleadmin", "https://hrjobs.mtsac.edu/postings/search"],
  ["Mt San Jacinto Community College District", "generic", "https://www.msjc.edu/humanresources/"],
  ["Sierra College", "generic", "https://www.sierracollege.edu/administration/human-resources/recruitment-employment-opportunities/"],

  // Illinois.
  ["Kankakee Community College", "schooljobs", "https://www.governmentjobs.com/careers/kankakeecc"],
  ["Spoon River College", "adp", "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=a1f9fed4-6d14-468e-b3ee-266b22902534&ccId=19000101_000001&type=MP&lang=en_US"],
  ["Illinois Central College", "generic", "https://icc.edu/employment-opportunities/"],
  ["John Wood Community College", "generic", "https://www.jwcc.edu/about/employment/"],
  ["Morton College", "generic", "https://www.morton.edu/human-resources"],
  ["Sauk Valley Community College", "generic", "https://www.svcc.edu/employees/opportunities/index.html"],
  ["Southeastern Illinois College", "generic", "https://sic.edu/employment/sic-positions/"],

  // Kansas.
  ["Independence Community College", "generic", "https://www.indycc.edu/human_resources/index.html"],
  ["Johnson County Community College", "generic", "https://www.jccc.edu/about/leadership-governance/administration/human-resources/"],
  ["Kansas City Kansas Community College", "generic", "https://kckcc.applicantstack.com/x/openings"],
  ["Manhattan Area Technical College", "generic", "https://manhattantech.edu/index.php/careers"],
  ["Neosho County Community College", "generic", "https://www.neosho.edu/HR"],
  ["Pratt Community College", "generic", "https://prattcc.edu/how-to-apply-2/"],

  // New Hampshire: HRMDirect's own location facet keeps every board campus-specific.
  ["River Valley Community College", "generic", `${CCSNH}19509`],
  ["Nashua Community College", "generic", `${CCSNH}19508`],
  ["NHTI-Concord's Community College", "generic", `${CCSNH}19507`],
  ["Manchester Community College", "generic", `${CCSNH}19506`],
  ["Great Bay Community College", "generic", `${CCSNH}19504`],
  ["White Mountains Community College", "generic", `${CCSNH}19510`],

  // New Jersey.
  ["Mercer County Community College", "schooljobs", "https://www.schooljobs.com/careers/mcccedu"],
  ["Rowan College at Burlington County", "schooljobs", "https://www.governmentjobs.com/careers/bccedu"],
  ["Sussex County Community College", "generic", "https://sussex.edu/about-sussex/jobs/"],

  // New Mexico.
  ["University of New Mexico-Gallup Campus", "generic", "https://www.gallup.unm.edu/hr/index.html"],
  ["University of New Mexico-Taos Campus", "generic", "https://taos.unm.edu/employment/"],
  ["University of New Mexico-Valencia County Campus", "generic", "https://valencia.unm.edu/campus-resources/human-resources/index.html"],
  ["New Mexico State University-Alamogordo", "generic", "https://alamogordo.nmsu.edu/business-office/human-resources.html"],
  ["New Mexico State University-Grants", "generic", "https://grants.nmsu.edu/webpages/itwebpage/humanresources.html"],
  ["New Mexico Junior College", "generic", "https://www.nmjc.edu/about/human_resources/index.aspx"],
  ["Santa Fe Community College", "generic", "https://www.sfcc.edu/employment-opportunities/"],

  // New York.
  ["Fulton-Montgomery Community College", "generic", "https://fmcc.edu/about-fmcc/employment-opportunities"],
  ["North Country Community College", "generic", "https://www.nccc.edu/about/human-resources/careers.html"],
  ["Monroe Community College", "generic", "https://www.monroecc.edu/depts/humres/"],
  ["Sullivan County Community College", "generic", "https://sunysullivan.isolvedhire.com/"],

  // North Carolina.
  ["Haywood Community College", "generic", "https://www.haywood.edu/human-resources/index.php"],
  ["Pamlico Community College", "generic", "https://pamlicocc.edu/employment/"],
  ["Rockingham Community College", "generic", "https://rockinghamcc.edu/about/employment/"],
  ["Rowan-Cabarrus Community College", "peopleadmin", "https://rcccjobs.com/postings/search"],
  ["Southeastern Community College (NC)", "generic", "https://sccnc.edu/about-scc/human-resources/jobs/"],
  ["Southwestern Community College (NC)", "generic", "https://www.southwesterncc.edu/jobs-scc"],
  ["Vance-Granville Community College", "generic", "https://www.vgcc.edu/hr/"],

  // Oklahoma.
  ["Northeastern Oklahoma A&M College", "generic", "https://jobs.okstate.edu/neo-a-m-home"],
  ["Northern Oklahoma College", "generic", "https://www.noc.edu/about-noc/employment-opportunities/"],
  ["Oklahoma City Community College", "peopleadmin", "https://www.occcjobs.com/postings/search"],
  ["Western Oklahoma State College", "generic", "https://jobs.wosc.edu/"],
].map(([name, platform_type, career_url]) => ({ name, platform_type, career_url, confidence: platform_type === "generic" ? 0.88 : 0.98 }));

function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
  const discovery = JSON.parse(fs.readFileSync(DISCOVERY_PATH, "utf8"));
  const targetKeys = new Set((discovery.results || []).map((item) => key(item.name)));
  if (Number(discovery.scanned) !== 100 || targetKeys.size !== 100) {
    throw new Error(`Expected exactly 100 discovery targets; scanned=${discovery.scanned}, unique=${targetKeys.size}`);
  }

  const institutions = new Map((master.institutions || []).map((item) => [key(item.name), item]));
  const discoveryByName = new Map((discovery.results || []).map((item) => [key(item.name), item]));
  const accepted = new Map();
  for (const item of VERIFIED) {
    if (!targetKeys.has(key(item.name))) throw new Error(`Verified institution outside target set: ${item.name}`);
    accepted.set(key(item.name), { ...item, evidence: "manually verified official employee hiring source" });
  }

  const existingOverrides = new Map((overrides.overrides || []).map((item) => [key(item.name), item]));
  const applied = [];
  const unresolved = [];
  for (const target of discovery.results || []) {
    const institution = institutions.get(key(target.name));
    if (!institution) throw new Error(`Institution missing from master: ${target.name}`);
    const item = accepted.get(key(target.name));
    if (item) {
      institution.career_url = item.career_url;
      institution.platform_type = item.platform_type;
      institution.coverage_source = null;
      institution.last_discovery_status = "next_100_two_year_validated";
      institution.last_discovery_confidence = item.confidence;
      institution.last_checked_at = new Date().toISOString();
      existingOverrides.set(key(item.name), {
        ...(existingOverrides.get(key(item.name)) || {}),
        name: item.name,
        homepage_url: institution.homepage_url,
        career_url: item.career_url,
        platform_type: item.platform_type,
        notes: `Reviewed in the 2026-08-24 next-100 two-year deep pass; ${item.evidence}.`,
      });
      applied.push(item);
    } else {
      // Undo any unreviewed URL written by discovery -- especially shared-system
      // boards and individual requisitions that are not durable institution sources.
      institution.career_url = null;
      institution.platform_type = null;
      institution.coverage_source = null;
      institution.last_discovery_status = REJECTED_AUTOMATIC.has(target.name)
        ? "next_100_two_year_rejected_unscoped"
        : "next_100_two_year_unresolved";
      institution.last_discovery_confidence = 0;
      existingOverrides.delete(key(target.name));
      unresolved.push({
        name: target.name,
        state: target.state,
        reason: REJECTED_AUTOMATIC.get(target.name) || "No sufficiently reliable institution-scoped employee hiring source found.",
        discoveryStatus: discoveryByName.get(key(target.name))?.status || null,
      });
    }
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
      score: item.confidence,
      source: "next-100 two-year deep coverage pass",
    };
  });

  fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n");
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2) + "\n");
  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), count: candidates.length, items: candidates }, null, 2) + "\n");
  fs.writeFileSync(REVIEW_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    scanned: targetKeys.size,
    accepted: applied.length,
    unresolvedCount: unresolved.length,
    acceptedByState: Object.fromEntries([...new Set((discovery.results || []).map((item) => item.state))].sort().map((state) => [state, applied.filter((item) => institutions.get(key(item.name))?.state === state).length])),
    rejected: [...REJECTED_AUTOMATIC].map(([name, reason]) => ({ name, reason })),
    unresolved,
  }, null, 2) + "\n");
  console.log(`Reviewed ${targetKeys.size}: accepted ${applied.length}, unresolved ${unresolved.length}`);
}

main();
