#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const write = (name, value) => fs.writeFileSync(path.join(ROOT, name), `${JSON.stringify(value, null, 2)}\n`);
const key = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
const REVIEW_DATE = "2026-08-31";

const VERIFIED = [
  { name: "Jefferson Regional School of Nursing", state: "AR", career_url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=542f7b59-1156-4a17-a729-f8cd9337acf6&ccId=19000101_000001&lang=en_US", platform_type: "adp" },
  { name: "RAND School of Public Policy", state: "CA", career_url: "https://www.rand.org/jobs", platform_type: "generic" },
  { name: "Skyline College", state: "CA", career_url: "https://jobs.smccd.edu/postings/search?535=5&commit=Search&query_organizational_tier_1_id=any&query_organizational_tier_2_id=any&sort=536+asc", platform_type: "generic" },
  { name: "The Colleges of Law at Santa Barbara", state: "CA", career_url: "https://www.collegesoflaw.edu/careers/", platform_type: "generic" },
  { name: "The Colleges of Law at Ventura", state: "CA", career_url: "https://www.collegesoflaw.edu/careers/", platform_type: "generic" },
  { name: "Palmer College of Chiropractic", state: "IA", career_url: "https://www.palmer.edu/work-for-palmer/", platform_type: "generic" },
  { name: "Meadville Theological School of Lombard College", state: "IL", career_url: "https://files.meadville.edu/files/resources/recruitment-and-admissions-specialist-job-descript.pdf", platform_type: "generic" },
  { name: "Principia College", state: "IL", career_url: "https://www.principia.edu/jobs", platform_type: "generic" },
  { name: "Trinity College of Nursing & Health Sciences", state: "IL", career_url: "https://www.trinitycollegeqc.edu/about-us/careers", platform_type: "generic" },
  { name: "Manhattan Christian College", state: "KS", career_url: "https://www.mccks.edu/about-mcc/at-mcc/careers-at-mcc/", platform_type: "generic" },
  { name: "MGH Institute of Health Professions", state: "MA", career_url: "https://www.massgeneral.org/careers/", platform_type: "generic" },
  { name: "Sattler College", state: "MA", career_url: "https://app.trinethire.com/companies/20243-sattler-college-inc/jobs", platform_type: "generic" },
  { name: "University System of Maryland", state: "MD", career_url: "https://www.usmd.edu/usm/employment/", platform_type: "generic" },
  { name: "University System of Maryland-Research Centers", state: "MD", career_url: "https://www.usmd.edu/usm/employment/", platform_type: "generic" },
  { name: "Washington Adventist University", state: "MD", career_url: "https://www.wau.edu/humanresources/", platform_type: "generic" },
  { name: "Minneapolis College of Art and Design", state: "MN", career_url: "https://www.mcad.edu/careers-at-mcad", platform_type: "generic" },
  { name: "Midwestern Baptist Theological Seminary", state: "MO", career_url: "https://www.mbts.edu/about/employment/", platform_type: "generic" },
  { name: "Missouri Valley College", state: "MO", career_url: "https://www.moval.edu/about/careers-at-mvc/", platform_type: "generic" },
  { name: "Nazarene Theological Seminary", state: "MO", career_url: "https://www.nts.edu/human-resources/", platform_type: "generic" },
  { name: "Southeast Missouri Hospital College of Nursing and Health Sciences", state: "MO", career_url: "https://www.sehcollege.edu/job-opportunities/", platform_type: "generic" },
  { name: "Manna University", state: "NC", career_url: "https://manna.edu/careers/", platform_type: "generic" },
  { name: "Mid-Atlantic Christian University", state: "NC", career_url: "https://www.macuniversity.edu/about-macu/careers/", platform_type: "generic" },
  { name: "Cochran School of Nursing", state: "NY", career_url: "https://riversidehealth.org/careers/", platform_type: "generic" },
  { name: "SUNY-System Office", state: "NY", career_url: "https://www.suny.edu/careers/employment/", platform_type: "generic" },
  { name: "The Juilliard School", state: "NY", career_url: "https://www.juilliard.edu/careers", platform_type: "generic" },
  { name: "Lorain County Community College", state: "OH", career_url: "https://ccyj.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs", platform_type: "oracle-cx" },
  { name: "Oklahoma Technical College", state: "OK", career_url: "https://communitycarecollege.edu/employment", platform_type: "generic" },
  { name: "Point Park University", state: "PA", career_url: "https://pointpark.applicantpro.com/jobs/", platform_type: "generic" },
  { name: "Trinity Anglican Seminary", state: "PA", career_url: "https://tas.edu/jobs", platform_type: "generic" },
  { name: "University of Valley Forge", state: "PA", career_url: "https://www.valleyforge.edu/employment/", platform_type: "generic" },
  { name: "Washington & Jefferson College", state: "PA", career_url: "https://www.washjeff.edu/careers/", platform_type: "generic" },
  { name: "Trevecca Nazarene University", state: "TN", career_url: "https://www.trevecca.edu/offices-services/current-job-opportunities", platform_type: "generic" },
  { name: "South Texas College of Law Houston", state: "TX", career_url: "https://stclh-careers.silkroad.com/Careers/EmploymentListings.html", platform_type: "generic" },
  { name: "University of Houston-Victoria", state: "TX", career_url: "https://www.uhv.edu/human-resources/", platform_type: "generic" },
  { name: "Randolph College", state: "VA", career_url: "https://www.randolphcollege.edu/humanresources/job-openings/", platform_type: "generic" },
  { name: "Sentara College of Health Sciences", state: "VA", career_url: "https://www.sentara.edu/about-us/careers-college", platform_type: "generic" },
  { name: "Vermont College of Fine Arts", state: "VT", career_url: "https://vcfa.edu/about/jobs-at-vcfa/", platform_type: "generic" },
  { name: "Lakeland University", state: "WI", career_url: "https://lakeland.applicantpro.com/jobsandemployment/location/", platform_type: "generic" },
  { name: "Ripon College", state: "WI", career_url: "https://www.ripon.edu/?post_type=job_listing", platform_type: "generic" },
  { name: "Wisconsin School of Professional Psychology", state: "WI", career_url: "https://www.wspp.edu/about-wspp/careers", platform_type: "generic" },
];

const EXCLUSIONS = {
  "International Baptist College and Seminary": "no institution-run public employee openings page was found after official-domain and targeted search review",
  "Grace Mission University": "the official job board is an external community board, not an employee hiring page, and no institution-run employee openings page was found",
  "Hypnosis Motivation Institute": "no institution-run public employee openings page was found after official-domain and targeted search review",
  "ICOHS College": "the official career pages are student and employer-partner services, not employee hiring pages, and no institution-run employee openings page was found",
  "Pontifical John Paul II Institute for Studies on Marriage and Family": "the official job-postings page serves students and alumni, not institutional hiring, and no separate employee openings page was found",
  "SABER College": "no institution-run public employee openings page was found after official-domain and targeted search review",
  "University of Florida-Online": "this IPEDS row is an online modality of the University of Florida rather than a separate employer; hiring is already represented by the University of Florida",
  "Generations College": "no institution-run public employee openings page was found after official-domain and targeted search review",
  "McCormick Theological Seminary": "the official job board lists outside employers for students and alumni, and no institution-run employee openings page was found",
  "Little Big Horn College": "the only verified hiring artifact was a single adjunct posting packet, not a durable institution-level employee openings source",
  "Hampshire College": "the Board of Trustees voted to permanently close the college following the fall 2026 semester",
  "Longy School of Music of Bard College": "no separate institution-run public employee openings page was found; the discovered job board serves students and alumni rather than Longy hiring",
  "St. Andrews University": "the institution permanently ceased operations on May 5, 2025",
  "Assumption College for Sisters": "no durable institution-run public employee openings page was found after official-domain and targeted search review",
  "Seminary Bnos Chaim": "no institution-run public employee openings page was found after official-domain and targeted search review",
  "American Academy McAllister Institute of Funeral Service": "the official site provides student placement services but no public employee openings page",
  "Bnos Zion Of Bobov Seminary": "no institution-run public employee openings page was found after official-domain and targeted search review",
  "New York Seminary": "no institution-run public employee openings page was found after official-domain and targeted search review",
  "Ohel Margulia Seminary": "no institution-run public employee openings page was found after official-domain and targeted search review",
  "Seminar L'moros Bais Yaakov": "no institution-run public employee openings page was found after official-domain and targeted search review",
  "Ohio Institute of Allied Health": "no institution-run public employee openings page was found after official-domain and targeted search review",
  "Pittsburgh Institute of Mortuary Science Inc": "the official jobs page serves students and alumni, not institutional hiring, and no employee openings page was found",
  "Pennsylvania State University-Penn State New Kensington": "the campus employment landing page points to Penn State's shared hiring system, but no exact New Kensington job facet was available for safe attribution",
  "University of Pittsburgh-Pittsburgh Campus": "the shared Pitt faculty page spans multiple campuses and no exact Pittsburgh-campus control was available for safe attribution",
  "Kairos University": "no institution-run public employee openings page was found after official-domain and targeted search review",
  "John A Gupton College": "no institution-run public employee openings page was found after official-domain and targeted search review",
  "University of Wisconsin-Milwaukee Flex": "this IPEDS row is an online delivery modality whose programs and employment belong to UW-Milwaukee, which is already represented",
  "University of Wisconsin-Parkside Flex": "this IPEDS row is an online delivery modality whose programs and employment belong to UW-Parkside, which is already represented",
  "Huntington Junior College": "the institution now operates as Amerion College at the same campus and federal school identity, so the former-name IPEDS row is not a separate employer",
};

const SPECIAL_SOURCES = {
  "Grace Mission University": ["https://gm.edu/job-board/"],
  "Pontifical John Paul II Institute for Studies on Marriage and Family": ["https://www.johnpaulii.edu/resources/job-postings/"],
  "University of Florida-Online": ["https://ufonline.ufl.edu/", "https://jobs.ufl.edu/"],
  "McCormick Theological Seminary": ["https://www.mccormick.edu/jobboard"],
  "Hampshire College": ["https://www.hampshire.edu/offices/office-president/closure-information"],
  "St. Andrews University": ["https://www.sa.edu/about/accreditation/"],
  "Pittsburgh Institute of Mortuary Science Inc": ["https://www.pims.edu/jobs/"],
  "Little Big Horn College": ["https://www.lbhc.edu/sites/default/files/lbhc/humanresources/HVAC_Adjunt_Intstructor_Packet.pdf"],
  "Pennsylvania State University-Penn State New Kensington": ["https://newkensington.psu.edu/employment"],
  "University of Pittsburgh-Pittsburgh Campus": ["https://www.join.pitt.edu/faculty-appointments"],
  "University of Wisconsin-Milwaukee Flex": ["https://flex.wisconsin.edu/degrees-programs/"],
  "University of Wisconsin-Parkside Flex": ["https://flex.wisconsin.edu/degrees-programs/"],
  "Huntington Junior College": ["https://amerion.edu/our-policies/consumer-information/"],
};

const STALE_POLICY_ROWS = [
  "Athenaeum of Ohio",
  "California College of ASU",
  "California State University-Chancellors Office",
  "Lawrence Memorial Hospital School of Nursing",
  "The Landing School",
  "Young Americans College of the Performing Arts",
];

function isEligible(inst, scope) {
  const level = key(inst.level);
  const control = key(inst.control);
  if ((scope.levelsIncluded || []).length && level && !scope.levelsIncluded.map(key).includes(level)) return false;
  if ((scope.excludeLevels || []).map(key).includes(level)) return false;
  if ((scope.excludeControls || []).map(key).includes(control)) return false;
  if (scope.target === "degree-granting" && inst.is_degree_granting === false) return false;
  return true;
}

function main() {
  const master = read("data/institutions-master.json");
  const overrides = read("data/career-url-overrides.json");
  const rules = read("data/policy-rules.json");
  const generatedExclusions = read("generated/policy-excluded-colleges.json");
  const excludedSet = new Set((generatedExclusions.colleges || []).map(key));
  const now = new Date().toISOString();
  const masterMap = new Map(master.institutions.map((row) => [key(row.name), row]));
  const overrideMap = new Map(overrides.overrides.map((row) => [key(row.name), row]));

  const verifiedNames = new Set(VERIFIED.map((row) => key(row.name)));
  const exclusionNames = new Set(Object.keys(EXCLUSIONS).map(key));
  if (VERIFIED.length + Object.keys(EXCLUSIONS).length !== 69) {
    throw new Error(`Closeout definitions account for ${VERIFIED.length + Object.keys(EXCLUSIONS).length}/69`);
  }
  const targetNames = new Set([...verifiedNames, ...exclusionNames]);
  const cohort = master.institutions.filter((row) => isEligible(row, rules.scope) && targetNames.has(key(row.name)));
  if (cohort.length !== 69) throw new Error(`Expected 69 closeout institutions, found ${cohort.length}`);
  for (const row of cohort) {
    if (!verifiedNames.has(key(row.name)) && !exclusionNames.has(key(row.name))) {
      throw new Error(`Unaccounted institution: ${row.name}`);
    }
  }

  for (const name of STALE_POLICY_ROWS) {
    const institution = masterMap.get(key(name));
    if (!institution || !excludedSet.has(key(name))) throw new Error(`Stale policy row not found in generated exclusions: ${name}`);
    Object.assign(institution, {
      coverage_status: "excluded_policy",
      last_checked_at: now,
      last_discovery_status: "normalized_existing_policy_exclusion",
    });
  }

  const verified = [];
  for (const candidate of VERIFIED) {
    const institution = masterMap.get(key(candidate.name));
    if (!institution || !cohort.some((row) => key(row.name) === key(candidate.name))) {
      throw new Error(`Verified institution missing from 69-row cohort: ${candidate.name}`);
    }
    const notes = `Official employee hiring source manually verified ${REVIEW_DATE} during the final 69-institution closeout.`;
    overrideMap.set(key(candidate.name), {
      ...(overrideMap.get(key(candidate.name)) || {}),
      name: candidate.name,
      homepage_url: institution.homepage_url,
      career_url: candidate.career_url,
      platform_type: candidate.platform_type,
      coverage_source: candidate.name,
      notes,
    });
    Object.assign(institution, {
      career_url: candidate.career_url,
      platform_type: candidate.platform_type,
      coverage_source: candidate.name,
      coverage_status: "covered",
      verification_status: "healthy",
      last_verified_at: now,
      last_checked_at: now,
      last_discovery_status: "official_employee_hiring_source_validated",
      last_discovery_confidence: 1,
      notes,
    });
    delete rules.institutionOverrides[candidate.name];
    verified.push({ ...candidate, homepage_url: institution.homepage_url });
  }

  const excluded = [];
  for (const [name, detail] of Object.entries(EXCLUSIONS)) {
    const institution = masterMap.get(key(name));
    if (!institution || !cohort.some((row) => key(row.name) === key(name))) {
      throw new Error(`Excluded institution missing from 69-row cohort: ${name}`);
    }
    const inactive = /close|ceased operations/.test(detail);
    const reason = `Excluded from public-hiring coverage (${REVIEW_DATE}): ${detail}.`;
    const sources = SPECIAL_SOURCES[name] || [institution.homepage_url].filter(Boolean);
    overrideMap.delete(key(name));
    rules.institutionOverrides[name] = { action: "exclude", reason, sources };
    Object.assign(institution, {
      coverage_status: "excluded_policy",
      verification_status: inactive ? "verified_inactive" : "verified_no_public_hiring_source",
      last_checked_at: now,
      last_discovery_status: inactive ? "policy_excluded_inactive" : "policy_excluded_after_manual_review",
      last_discovery_confidence: 1,
    });
    excluded.push({ name, state: institution.state, homepage_url: institution.homepage_url, reason, sources });
  }

  overrides.updatedAt = now;
  overrides.overrides = [...overrideMap.values()].sort((a, b) => key(a.name).localeCompare(key(b.name)));
  rules.lastReviewed = REVIEW_DATE;
  master.generatedAt = now;
  master.counts.covered = master.institutions.filter((row) => row.coverage_status === "covered").length;
  master.counts.missing = master.institutions.filter((row) => row.coverage_status === "missing").length;
  master.counts.excluded_policy = master.institutions.filter((row) => row.coverage_status === "excluded_policy").length;

  write("data/career-url-overrides.json", overrides);
  write("data/institutions-master.json", master);
  write("data/policy-rules.json", rules);
  write("generated/remaining-69-promotion-candidates.json", { generatedAt: now, items: verified });
  write("generated/remaining-69-closeout-report.json", {
    generatedAt: now,
    reviewDate: REVIEW_DATE,
    originalBatch: 69,
    accounted: verified.length + excluded.length,
    normalizedPriorPolicyRows: STALE_POLICY_ROWS,
    totals: { verified: verified.length, excluded: excluded.length, unresolved: 0 },
    verified,
    excluded,
  });
  console.log(`Remaining-69 closeout: verified=${verified.length}, excluded=${excluded.length}, unresolved=0; normalized=${STALE_POLICY_ROWS.length}`);
}

main();
