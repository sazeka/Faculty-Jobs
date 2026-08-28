#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(value, null, 2)}\n`);
const generatedAt = "2026-08-28T21:00:00.000Z";

const promoted = [
  ["Marian University", "https://marian.rec.pro.ukg.net/MAR1500MNUI/JobBoard/fde73847-46d9-4c8a-924e-a28b5c630bfc/?o=postedDateDesc&q=", "ultipro-ukg", 21, "The official Human Resources page links this institution-specific UKG board."],
  ["Maryville University of Saint Louis", "https://www.maryville.edu/employment/", "generic", 1, "The official employment page exposes separate faculty/staff and adjunct application paths."],
  ["Meharry Medical College", "https://meharrymedicalcollege.wd12.myworkdayjobs.com/external", "workday", 15, "The official Working at Meharry page links this institution-specific Workday site."],
  ["Meredith College", "https://www.meredith.edu/human-resources/applying-for-a-position/", "generic", 0, "The official Human Resources application page links the college's current vacancy system."],
  ["Midland University", "https://www.paycomonline.net/v4/ats/web.php/portal/3971D0B7A1DB06DA25282DE787EC51E9/career-page", "paycom", 2, "The official university careers page links this institution-specific Paycom board."],
  ["Moravian University", "https://ibtsjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2", "oracle-cx", 11, "The official job-opportunities route resolves to this institution-specific Oracle site."],
  ["Mount Carmel College of Nursing", "https://www.mccn.edu/about/employment-opportunities", "generic", 0, "The college's official employment page explicitly covers nursing faculty opportunities."],
  ["Mount Marty University", "https://recruitingbypaycor.com/career/CareerHome.action?clientId=8a7883c68ab5129a018abce5b6dc034a", "generic", 1, "The official careers page links this institution-specific Paycor board."],
  ["Mount Mary University", "https://mtmary.applicantpro.com/jobs/", "generic", 1, "The official university site links this institution-specific ApplicantPro board."],
  ["Mount St. Mary's University", "https://msmu.wd1.myworkdayjobs.com/en-US/MSMU/", "workday", 4, "The official employment-opportunities page links this institution-specific Workday site."],
  ["Muhlenberg College", "https://muhlenberg.wd1.myworkdayjobs.com/MuhlenbergCareers", "workday", 3, "The official Human Resources page links this institution-specific Workday site."],
].map(([name, url, platformType, publishedFacultyMatches, evidence]) => ({ name, url, platformType, publishedFacultyMatches, evidence }));

const held = [
  {
    reason: "A parent health system, hospital, or partner institution operates the visible board, but no durable institution-level scope was verified.",
    names: ["Cochran School of Nursing", "Jefferson Regional School of Nursing", "Longy School of Music of Bard College", "Mayo Clinic College of Medicine and Science", "MGH Institute of Health Professions", "Mount Sinai Phillips School of Nursing"],
  },
  {
    reason: "No durable institution-owned public employee vacancy index was verified, or the available page could not be extracted without known false positives.",
    names: [
      "American Academy McAllister Institute of Funeral Service", "Assumption College for Sisters", "Bnos Zion Of Bobov Seminary", "Huntington Junior College", "Hypnosis Motivation Institute", "ICOHS College", "John A Gupton College", "Lakeland University", "Lakewood University", "Lancaster Theological Seminary", "Machzikei Hadath Rabbinical College", "Maranatha Baptist University", "Maryland University of Integrative Health", "Marymount Manhattan College", "Massachusetts School of Law", "Mechon L'hoyroa", "Memphis Theological Seminary", "Mesivta of Eastern Parkway-Yeshiva Zichron Meilech", "Mesivtha Tifereth Jerusalem of America", "Mid-America Christian University", "Mid-Atlantic Christian University", "Midwestern Baptist Theological Seminary", "Midwives College of Utah", "Milwaukee Institute of Art & Design", "Minneapolis College of Art and Design", "Mission University", "Missouri Baptist University", "Missouri Valley College",
    ],
  },
];

const safeguards = [
  "Only institution-owned employee pages, institution-specific ATS tenants, or official pages linking those sources were promoted.",
  "Every promoted board was checked live through the production parser; current faculty-title counts may legitimately be zero.",
  "Shared health-system boards were held unless institution-level attribution could be proved.",
  "Missouri Valley College was held because the current generic parser returns a known navigation false positive alongside its real adjunct page.",
];

const reviewedNames = [...promoted.map((row) => row.name), ...held.flatMap((group) => group.names)];
if (reviewedNames.length !== 45 || new Set(reviewedNames).size !== 45) throw new Error(`Expected 45 unique controls, found ${reviewedNames.length}/${new Set(reviewedNames).size}`);

const master = read("data/institutions-master.json");
const institutionMap = new Map(master.institutions.map((row) => [row.name.toLowerCase(), row]));
for (const name of reviewedNames) {
  const row = institutionMap.get(name.toLowerCase());
  if (!row) throw new Error(`Institution missing from master: ${name}`);
  if (row.control !== "private nonprofit") throw new Error(`Control outside private nonprofit scope: ${name}`);
}

const validation = {
  generatedAt,
  scope: "The 45 private-nonprofit institutions not resolved by the prior alphabetical discovery batches",
  reviewedCount: reviewedNames.length,
  promotedCount: promoted.length,
  heldCount: reviewedNames.length - promoted.length,
  safeguards,
  liveChecks: promoted.map(({ name, publishedFacultyMatches }) => ({ name, publishedFacultyMatches })),
  promoted: promoted.map(({ publishedFacultyMatches, ...row }) => row),
  held,
};
write("generated/tenth-private-discovery-batch-validation.json", validation);

const overrides = read("data/career-url-overrides.json");
const overrideMap = new Map(overrides.overrides.map((row) => [row.name.toLowerCase(), row]));
const coveredBefore = master.institutions.filter((row) => row.coverage_status === "covered").length;
for (const control of promoted) {
  const notes = `Verified in the tenth private-nonprofit discovery batch on 2026-08-28. ${control.evidence}`;
  const replacement = { name: control.name, career_url: control.url, platform_type: control.platformType, coverage_source: control.name, notes };
  const prior = overrideMap.get(control.name.toLowerCase());
  if (prior) Object.assign(prior, replacement);
  else overrides.overrides.push(replacement);
  Object.assign(institutionMap.get(control.name.toLowerCase()), {
    career_url: control.url,
    platform_type: control.platformType,
    coverage_source: control.name,
    coverage_status: "covered",
    verification_status: "healthy",
    last_verified_at: generatedAt,
    last_seen_job_count: control.publishedFacultyMatches,
    last_discovery_status: "official_scoped_source_validated",
    last_discovery_confidence: 1,
    last_discovery_attempt_at: generatedAt,
    notes,
  });
}

overrides.updatedAt = generatedAt;
master.generatedAt = generatedAt;
master.counts.covered = master.institutions.filter((row) => row.coverage_status === "covered").length;
master.counts.missing = master.institutions.filter((row) => row.coverage_status === "missing").length;
write("data/career-url-overrides.json", overrides);
write("data/institutions-master.json", master);
write("generated/tenth-private-discovery-batch-milestone.json", {
  generatedAt,
  scope: validation.scope,
  reviewedCount: validation.reviewedCount,
  appliedCount: validation.promotedCount,
  heldCount: validation.heldCount,
  newlyCoveredCount: master.counts.covered - coveredBefore,
  coveredAfter: master.counts.covered,
  missingAfter: master.counts.missing,
  safeguards,
});

console.log(`Applied ${promoted.length} sources; ${master.counts.covered - coveredBefore} newly covered; ${validation.heldCount} held.`);
