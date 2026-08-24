#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = path.join(ROOT, "data/institutions-master.json");
const OVERRIDES = path.join(ROOT, "data/career-url-overrides.json");
const REPORT = path.join(ROOT, "generated/public-two-year-hiring-pass-report.json");
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();

const VERIFIED = [
  ["Passaic County Community College", "adp", "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=40423bb9-2cb3-4ea1-a606-660bd59b0d8d&ccId=19000101_000001&lang=en_US"],
  ["Lancaster County Career and Technology Center", "applitrack", "https://www.applitrack.com/lancasterctc/onlineapp/default.aspx?all=1"],
  ["Montgomery Community College", "generic", "https://www.montgomery.edu/about-mcc/employment/"],
  ["Western Piedmont Community College", "generic", "https://www.wpcc.edu/employment/"],
  ["Wilson Community College", "generic", "https://www.wilsoncc.edu/about-us/human-resources/"],
  ["Orangeburg Calhoun Technical College", "generic", "https://www.octech.edu/about/human-resources/"],
  ["Tohono O'odham Community College", "generic", "https://www.tocc.edu/human-resources-employment"],
  ["North Dakota State College of Science", "generic", "https://ndscs.edu/about/join-our-team/"],
  ["Mitchell Technical College", "generic", "https://www.mitchelltech.edu/careers/"],
  ["Southeast Community College Area", "generic", "https://www.southeast.edu/about/other-scc-departments/hr/index.php"],
  ["Northern Wyoming Community College District", "generic", "https://www.sheridan.edu/student-services/hr/"],
  ["Hocking College", "generic", "https://www.hocking.edu/careers"],
  ["Southern State Community College", "generic", "https://www.sscc.edu/hr/work-at-sscc.shtml"],
  ["Southwestern Indian Polytechnic Institute", "generic", "https://www.sipi.edu/apps/pages/humanresources"],
  ["Saginaw Chippewa Tribal College", "generic", "https://www.sagchip.edu/employment"],
  ["Moraine Valley Community College", "peopleadmin", "https://jobs.morainevalley.edu/"],
  ["Mountwest Community and Technical College", "generic", "https://www.mctc.edu/hr/"],
  ["Texas State Technical College", "generic", "https://www.tstc.edu/work-at-tstc/"],
  ["Mississippi Community College Board", "generic", "https://www.mccb.edu/hr/employment"],
  ["Northwest Mississippi Community College", "generic", "https://www.northwestms.edu/l/faculty-and-staff/hr"],
  ["Garden City Community College", "paycom", "https://www.paycomonline.net/v4/ats/web.php/portal/EDDDA7ABD200C6844CF6CF5EFE35BD11/career-page"],
  ["Salina Area Technical College", "generic", "https://salinatech.edu/hr/current-openings/"],
  ["Wichita State University-Campus of Applied Sciences and Technology", "generic", "https://wsutech.edu/jobs/"],
  ["Seminole State College", "generic", "https://www.sscok.edu/about-ssc/hr-employment/index.html"],
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
    if (institution.control !== "public") throw new Error(`Expected a public institution: ${item.name}`);
    if (
      institution.coverage_status !== "missing" &&
      institution.last_discovery_status !== "public_official_hiring_page_validated"
    ) {
      throw new Error(`Expected missing status before this pass: ${item.name}`);
    }
    institution.career_url = item.career_url;
    institution.platform_type = item.platform_type;
    institution.coverage_source = null;
    institution.coverage_status = "covered";
    institution.last_discovery_status = "public_official_hiring_page_validated";
    institution.last_discovery_confidence = 0.97;
    institution.last_checked_at = now;
    overrideMap.set(key(item.name), {
      ...(overrideMap.get(key(item.name)) || {}),
      name: item.name,
      homepage_url: institution.homepage_url,
      career_url: item.career_url,
      platform_type: item.platform_type,
      notes: "Official institution-scoped employee hiring source verified in the 2026-08-24 remaining-public-colleges pass.",
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
  console.log(`Applied ${applied.length} verified public two-year hiring sources`);
}

main();
