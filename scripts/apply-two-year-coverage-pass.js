#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const DISCOVERY_PATH = path.join(ROOT, "generated", "career-discovery-report.json");
const CANDIDATES_PATH = path.join(ROOT, "generated", "promotion-candidates-two-year-pass.json");
const REVIEW_PATH = path.join(ROOT, "generated", "two-year-coverage-pass-report.json");

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();

const REJECTED_DISCOVERIES = new Map([
  ["Midlands Technical College", "Student academic-and-career advising page; not an employee hiring source."],
]);

const REVIEWED_GATEWAYS = [
  ["Labette Community College", "https://www.labette.edu/hr/jobs/index.html"],
  ["McDowell Technical Community College", "https://www.mcdowelltech.edu/employment-opportunities"],
  ["North Arkansas College", "https://www.northark.edu/employment-opportunities/"],
  ["North Shore Community College", "https://www.northshore.edu/hr/employment.html"],
  ["Pennsylvania Highlands Community College", "https://www.pennhighlands.edu/about/hr/employment/"],
  ["Perry Technical Institute", "https://www.perrytech.edu/about/careers/"],
  ["Raritan Valley Community College", "https://www.raritanval.edu/employment-at-rvcc/"],
  ["Moreno Valley College", "https://www.mvc.edu/admin/careers.php"],
  ["Northeast Mississippi Community College", "https://www.nemcc.edu/employees/employment/index.html"],
  ["Portland Community College", "https://www.pcc.edu/hr/jobs/"],
  ["Massasoit Community College", "https://massasoit.edu/about/offices-priorities/human-resources/index.html"],
  ["Lewis and Clark Community College", "https://www.lc.edu/team-members/human-resources/index.html"],
  ["Marshalltown Community College", "https://www.iavalley.edu/join-our-team/index.html"],
  ["Milwaukee Area Technical College", "https://www.matc.edu/who-we-are/offices/human-resources/index.html"],
  ["New Mexico State University-Dona Ana", "https://dacc.nmsu.edu/hr/"],
  ["Northeast Texas Community College", "https://www.ntcc.edu/hr"],
  ["Northwest Louisiana Technical Community College", "https://www.nltcc.edu/human-resources/index"],
  ["Reading Area Community College", "https://www.racc.edu/about-racc/human-resources"],
].map(([name, career_url]) => ({ name, career_url, platform_type: "generic", confidence: 0.85 }));

const KCTCS = [
  ["Hazard Community and Technical College", "hazard-jobs"],
  ["Henderson Community College", "henderson-jobs"],
  ["Jefferson Community and Technical College", "jefferson-jobs"],
  ["Madisonville Community College", "madisonville-jobs"],
  ["Maysville Community and Technical College", "maysville-jobs"],
  ["Owensboro Community and Technical College", "owensboro-jobs"],
  ["Somerset Community College", "somerset-jobs"],
  ["Southcentral Kentucky Community and Technical College", "southcentral-jobs"],
  ["Southeast Kentucky Community & Technical College", "southeast-jobs"],
  ["West Kentucky Community and Technical College", "westky-jobs"],
].map(([name, slug]) => ({
  name,
  career_url: `https://careers.kctcs.edu/jobs/search/${slug}`,
  platform_type: "pageup",
  coverage_source: "Kentucky Community and Technical College System",
  confidence: 0.98,
}));

const MINNESOTA_STATE = [
  ["Century College", "a7c1912089511000d545c6af0ef50001"],
  ["Northwest Technical College", "a7c1912089511000d545de1d40250000"],
  ["Pine Technical & Community College", "a7c1912089511000d545e552307f0000"],
].map(([name, institutionId]) => ({
  name,
  career_url: `https://minnstate.wd115.myworkdayjobs.com/Minnesota_State_Careers?Institution=${institutionId}`,
  platform_type: "workday",
  coverage_source: "Minnesota State System",
  confidence: 0.99,
}));

const VCCS_IDS = [
  ["Germanna Community College", "7876"],
  ["Laurel Ridge Community College", "7880"],
  ["Mountain Empire Community College", "7881"],
  ["New River Community College", "7890"],
  ["Patrick & Henry Community College", "7892"],
  ["Paul D Camp Community College", "7891"],
  ["Piedmont Virginia Community College", "7893"],
  ["Southside Virginia Community College", "7883"],
  ["Virginia Highlands Community College", "7894"],
  ["Virginia Peninsula Community College", "7887"],
  ["Virginia Western Community College", "7895"],
];
const VCCS = VCCS_IDS.map(([name, collegeId]) => ({
  name,
  career_url: `https://jobs.vccs.edu/postings/search?query_organizational_tier_1_id%5B%5D=${collegeId}&query_position_type_id%5B%5D=9&commit=Search`,
  platform_type: "peopleadmin",
  coverage_source: "Virginia Community College System",
  confidence: 0.99,
}));

function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
  const discovery = JSON.parse(fs.readFileSync(DISCOVERY_PATH, "utf8"));
  const institutions = new Map((master.institutions || []).map((item) => [key(item.name), item]));
  const discoveryByName = new Map((discovery.results || []).map((item) => [key(item.name), item]));

  const twoYearMissing = (master.institutions || []).filter(
    (item) => key(item.coverage_status) === "missing" && key(item.level) === "2-year",
  );
  if (twoYearMissing.length !== 343 || Number(discovery.scanned) !== 343) {
    throw new Error(`Expected the complete 343-institution pass; master=${twoYearMissing.length}, discovery=${discovery.scanned}`);
  }

  const accepted = new Map();
  for (const result of discovery.results || []) {
    if (result.status !== "discovered" || REJECTED_DISCOVERIES.has(result.name)) continue;
    accepted.set(key(result.name), {
      name: result.name,
      career_url: result.career_url,
      platform_type: result.platform_type || "generic",
      confidence: Number(result.confidence || 0.65),
      evidence: "automatic identity and employee-hiring evidence validation",
    });
  }

  for (const item of [...REVIEWED_GATEWAYS, ...KCTCS, ...MINNESOTA_STATE, ...VCCS]) {
    accepted.set(key(item.name), {
      ...item,
      evidence: item.coverage_source
        ? `official campus-scoped ${item.coverage_source} source`
        : "manual review of official-domain employee hiring evidence",
    });
  }

  accepted.set(key("Kentucky Community and Technical College System"), {
    name: "Kentucky Community and Technical College System",
    career_url: "https://careers.kctcs.edu/jobs/search",
    platform_type: "pageup",
    coverage_source: "Kentucky Community and Technical College System",
    confidence: 0.99,
    evidence: "official system-wide career source with campus facets",
    sharedOnly: true,
  });

  const existingOverrides = new Map((overrides.overrides || []).map((item) => [key(item.name), item]));
  const applied = [];
  for (const item of accepted.values()) {
    const institution = institutions.get(key(item.name));
    if (!institution) throw new Error(`Institution missing from master: ${item.name}`);
    institution.career_url = item.career_url;
    institution.platform_type = item.platform_type;
    institution.coverage_source = item.coverage_source || null;
    institution.last_discovery_status = "two_year_pass_validated";
    institution.last_discovery_confidence = item.confidence;
    institution.last_checked_at = new Date().toISOString();

    existingOverrides.set(key(item.name), {
      ...(existingOverrides.get(key(item.name)) || {}),
      name: item.name,
      homepage_url: institution.homepage_url,
      career_url: item.career_url,
      platform_type: item.platform_type,
      ...(item.coverage_source ? { coverage_source: item.coverage_source } : {}),
      notes: `Reviewed in the complete 2026-08-24 two-year coverage pass; ${item.evidence}.`,
    });
    applied.push(item);
  }

  const rejected = [];
  for (const [name, reason] of REJECTED_DISCOVERIES) {
    const institution = institutions.get(key(name));
    if (!institution) continue;
    institution.career_url = null;
    institution.platform_type = null;
    institution.coverage_source = null;
    institution.last_discovery_status = "two_year_pass_rejected_non_employee";
    institution.last_discovery_confidence = 0;
    rejected.push({ name, reason });
  }

  const unresolved = [];
  for (const institution of twoYearMissing) {
    if (accepted.has(key(institution.name)) || REJECTED_DISCOVERIES.has(institution.name)) continue;
    institution.career_url = null;
    institution.platform_type = null;
    institution.coverage_source = null;
    institution.last_discovery_status = "two_year_pass_unresolved";
    institution.last_discovery_confidence = Number(discoveryByName.get(key(institution.name))?.confidence || 0);
    unresolved.push({
      name: institution.name,
      state: institution.state || null,
      priorStatus: discoveryByName.get(key(institution.name))?.status || null,
    });
  }

  master.generatedAt = new Date().toISOString();
  overrides.updatedAt = new Date().toISOString();
  overrides.overrides = [...existingOverrides.values()].sort((a, b) => clean(a.name).localeCompare(clean(b.name)));

  const candidates = applied
    .filter((item) => !item.sharedOnly)
    .map((item) => {
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
        source: "complete two-year coverage pass",
      };
    });

  fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n");
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2) + "\n");
  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), count: candidates.length, items: candidates }, null, 2) + "\n");
  fs.writeFileSync(REVIEW_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    scanned: twoYearMissing.length,
    accepted: applied.length,
    configuredCandidates: candidates.length,
    rejected,
    unresolvedCount: unresolved.length,
    unresolved,
  }, null, 2) + "\n");
  console.log(`Reviewed ${twoYearMissing.length}: accepted ${applied.length}, rejected ${rejected.length}, unresolved ${unresolved.length}`);
  console.log(`Wrote ${path.relative(ROOT, CANDIDATES_PATH)} (${candidates.length} configured candidates)`);
}

main();
