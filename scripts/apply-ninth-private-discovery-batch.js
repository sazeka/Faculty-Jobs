#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(value, null, 2)}\n`);
const generatedAt = "2026-08-28T18:00:00.000Z";

const promoted = [
  ["Taylor University", "https://www.schooljobs.com/careers/tayloredu?jobType%5B0%5D=Adjunct&jobType%5B1%5D=Full+Time+Faculty&jobType%5B2%5D=Full-Time&jobType%5B3%5D=Part-Time&sort=PostingDate%7CDescending", "schooljobs", 7, "The official Human Resources page links this exact faculty-filtered SchoolJobs search."],
  ["Texas College", "https://www.texascollege.edu/employment/336/apply/", "generic", 0, "The official college employment page publishes current employee vacancies."],
  ["Texas Wesleyan University", "https://txwes.peopleadmin.com/postings/search?1175=2&435=&commit=Search&query=&query_organizational_tier_3_id=any&query_v0_posted_at_date=", "peopleadmin", 1, "The institution-specific PeopleAdmin search is scoped to faculty positions."],
  ["The New England Conservatory of Music", "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?ccId=19000101_000001&cid=893844b7-6c2c-408f-a271-a61215b811f8&lang=en_US&selectedMenuKey=CareerCenter&source=CC2", "adp", 1, "The official conservatory employment page links this institution-specific ADP tenant."],
  ["The Southern Baptist Theological Seminary", "https://inside.sbts.edu/human-resources/employment/", "generic", 0, "The institution-owned Human Resources page is the seminary's employee vacancy source."],
  ["The Southwestern Baptist Theological Seminary", "https://swbts.edu/campus-life/offices/human-resources", "generic", 0, "The institution-owned Human Resources page is the seminary's employee vacancy source."],
  ["Thomas College", "https://recruiting.paylocity.com/recruiting/jobs/All/8755daac-bdc4-49b9-9a03-9f77f304512b/Thomas-College", "generic", 2, "The official college site links this institution-specific Paylocity board."],
  ["Thomas Jefferson University", "https://jeffersonhealth.wd5.myworkdayjobs.com/ThomasJeffersonExternal", "workday", 45, "The official university careers link resolves to this institution-specific Workday board; a faculty-title guard excludes clinical and staff roles."],
  ["Thomas M Cooley Law School", "https://cooley.edu/about/jobs", "generic", 0, "The law school's official jobs page is its durable employee vacancy source."],
  ["Thomas More University", "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?ccId=19000101_000001&cid=4f8993d7-7486-4f03-a125-59b813eb0331&lang=en_US", "adp", 0, "The official Human Resources page links this institution-specific ADP tenant."],
  ["Tougaloo College", "https://www.tougaloo.edu/about-tougaloo-college/jobs", "generic", 0, "The official college jobs page is the durable source for employee openings."],
  ["Toyota Technological Institute at Chicago", "https://www.ttic.edu/faculty-hiring/", "generic", 4, "The institution-owned faculty hiring page publishes current academic opportunities."],
  ["Trine University", "https://www.trine.edu/human-resources/careers/index.aspx", "generic", 35, "The official university careers page publishes current faculty openings."],
  ["Tusculum University", "https://www3.tusculum.edu/hr/employment-opportunities/", "generic", 9, "The official Human Resources page publishes current faculty opportunities."],
  ["Union Adventist University", "https://uau.edu/?p=21590", "generic", 0, "The institution-owned employment page is the university's vacancy source."],
  ["Union Commonwealth University", "https://www.unionky.edu/about/human-resources/employment-opportunities/faculty-positions", "generic", 1, "The official Human Resources site provides a dedicated faculty positions page."],
  ["University of Dallas", "https://udallas.edu/offices-services/human-resources/open-positions.php", "generic", 2, "The official Human Resources open-positions page publishes current faculty roles."],
  ["University of Indianapolis", "https://jobs.keldair.com/uindy", "generic", 9, "The official Human Resources page links this institution-specific Keldair applicant board."],
  ["University of Pikeville", "https://www.upike.edu/offices/human-resources/", "generic", 0, "The official Human Resources page is the university's employee vacancy source."],
  ["University of the Cumberlands", "https://www.ucumberlands.edu/about/work-us", "generic", 11, "The official Work With Us page links the university's current Workday openings."],
  ["Vanderbilt University", "https://ecsr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1", "oracle-cx", 0, "The official university careers flow resolves to this Vanderbilt Oracle Candidate Experience site."],
  ["Vermont Law and Graduate School", "https://www.vermontlaw.edu/employment", "generic", 0, "The official school employment page publishes its employee opportunities."],
  ["Virginia Union University", "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=be274061-0ec3-4842-99e1-78c183f80855&ccId=19000101_000001&lang=en_US", "adp", 6, "The official university employment page links this institution-specific ADP tenant."],
  ["Virginia Wesleyan University", "https://fa-ewic-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs", "oracle-cx", 7, "The official university careers page links this institution-specific Oracle board."],
  ["Viterbo University", "https://www.viterbo.edu/human-resources/job-announcements", "generic", 0, "The official Human Resources job-announcements page is the university's vacancy source."],
  ["Walla Walla University", "https://www.wallawalla.edu/human-resources/faculty-employment", "walla-walla-faculty", 5, "The official university site publishes a dedicated faculty-employment page."],
  ["Walsh College", "https://walshcollege.edu/about-us/careers/", "generic", 0, "The official college careers page is its employee vacancy source."],
  ["Walsh University", "https://www.walsh.edu/careers.html", "generic", 5, "The official careers page links the university's current Paycom postings."],
  ["Washington College", "https://www.washcoll.edu/people_departments/offices/human-resources/employment/index.php", "generic", 0, "The official Human Resources employment page is the college's vacancy source."],
  ["Webster University", "https://recruiting.adp.com/srccar/public/RTI.home?c=1180715&d=ExternalCareerSite", "adp", 0, "The official university Human Resources page links this institution-specific ADP board."],
  ["Western Governors University", "https://jobs.wgu.edu/academic-careers", "generic", 1, "The official WGU Academic Careers page publishes faculty and instructional roles."],
  ["Westminster College (PA)", "https://my.westminster.edu/ICS/Campus_Life/Campus_Groups/Human_Resources__Employment/Employment_Opportunities.jnz", "generic", 0, "The official college portal provides its employee employment-opportunities page."],
  ["Wheaton College", "https://fa-eukq-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1", "oracle-cx", 15, "The official college careers page links this institution-specific Oracle site."],
  ["Wheaton College (Massachusetts)", "https://jobs.wheatoncollege.edu/postings/search?365%5B%5D=3&commit=Search", "peopleadmin", 6, "The institution-specific PeopleAdmin search is scoped to faculty positions."],
  ["Wilkes University", "https://wilkesuniversitycareers.applicantpro.com/jobs", "generic", 1, "The official university careers page links this institution-specific ApplicantPro board."],
  ["William James College", "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?ccId=19000101_000001&cid=40dab9cd-14a1-4d29-b356-da8c9cb6fb6f&lang=en_US", "adp", 1, "The official college careers page links this institution-specific ADP tenant."],
  ["Wisconsin Lutheran College", "https://www.wlc.edu/about-wlc/offices-resources/human-resources/index.html", "wlc-faculty", 1, "The official Human Resources page publishes current faculty calls."],
  ["Xavier University", "https://xavier.wd108.myworkdayjobs.com/XavierCareers", "workday", 13, "The official university careers page links this institution-specific Workday board."],
].map(([name, url, platformType, publishedFacultyMatches, evidence]) => ({ name, url, platformType, publishedFacultyMatches, evidence }));

const safeguards = [
  "Only institution-owned employee pages, institution-specific ATS tenants, or dedicated faculty vacancy pages were promoted.",
  "Faculty filters were preserved where the ATS exposes them, and broad boards received narrow title guards where required.",
  "Navigation labels, faculty-resource links, staff categories, and other non-vacancy matches observed during live probes were rejected.",
  "Closed, suspended, merged, stale, and specialty institutions without a durable public employee board remained unresolved."
];
const closed = new Set(["The College of Saint Rose", "Trinity Christian College", "University of Valley Forge", "Vermont College of Fine Arts", "Warner Pacific University", "Warner Pacific University Professional and Graduate Studies", "Woodbury University"]);
const promotedNames = new Set(promoted.map((row) => row.name));
const master = read("data/institutions-master.json");
const scopeRows = master.institutions.filter((row) => /^[T-Z]/i.test(row.name) && row.control === "private nonprofit" && (row.coverage_status === "missing" || promotedNames.has(row.name)));
if (scopeRows.length !== 142) throw new Error(`Expected 142 T-Z private-nonprofit controls, found ${scopeRows.length}`);
for (const control of promoted) if (!scopeRows.some((row) => row.name === control.name)) throw new Error(`Promoted control outside scope: ${control.name}`);
const heldNames = scopeRows.map((row) => row.name).filter((name) => !promotedNames.has(name));
const religiousPattern = /(?:Talmud|Yeshiv|Torah|Theological|Seminary|Bible College|School of Theology|Urshan|Veritas Baptist|World Mission|Visible Music)/i;
const held = [
  { reason: "The institution is closed, suspended, merged, or no longer a durable independent employer control.", names: heldNames.filter((name) => closed.has(name)) },
  { reason: "No durable institution-owned public employee vacancy index was verified for this specialized or religious institution.", names: heldNames.filter((name) => !closed.has(name) && religiousPattern.test(name)) },
  { reason: "An official page exists, but it is stale, student-facing, unscoped to the institution, or lacks a safely extractable employee vacancy index.", names: heldNames.filter((name) => !closed.has(name) && !religiousPattern.test(name)) },
].filter((group) => group.names.length);

const validation = {
  generatedAt,
  scope: "All 142 unresolved private-nonprofit institutions in the alphabetical T through Z segments",
  reviewedCount: scopeRows.length,
  promotedCount: promoted.length,
  heldCount: heldNames.length,
  safeguards,
  liveChecks: promoted.map(({ name, publishedFacultyMatches }) => ({ name, publishedFacultyMatches })),
  promoted: promoted.map(({ publishedFacultyMatches, ...row }) => row),
  held,
};
write("generated/ninth-private-discovery-batch-validation.json", validation);

const overrides = read("data/career-url-overrides.json");
const overrideMap = new Map(overrides.overrides.map((row) => [row.name.toLowerCase(), row]));
const institutionMap = new Map(master.institutions.map((row) => [row.name.toLowerCase(), row]));
for (const control of promoted) {
  const notes = `Verified in the ninth private-nonprofit discovery batch on 2026-08-28. ${control.evidence}`;
  const replacement = { name: control.name, career_url: control.url, platform_type: control.platformType, coverage_source: control.name, notes };
  const prior = overrideMap.get(control.name.toLowerCase());
  if (prior) Object.assign(prior, replacement);
  else overrides.overrides.push(replacement);
  const institution = institutionMap.get(control.name.toLowerCase());
  if (!institution) throw new Error(`Institution missing from master: ${control.name}`);
  Object.assign(institution, {
    career_url: control.url, platform_type: control.platformType, coverage_source: control.name,
    coverage_status: "covered", verification_status: "healthy", last_verified_at: generatedAt,
    last_seen_job_count: control.publishedFacultyMatches, last_discovery_status: "official_scoped_source_validated",
    last_discovery_confidence: 1, last_discovery_attempt_at: generatedAt, notes,
  });
}
overrides.updatedAt = generatedAt;
master.generatedAt = generatedAt;
master.counts.covered = master.institutions.filter((row) => row.coverage_status === "covered").length;
master.counts.missing = master.institutions.filter((row) => row.coverage_status === "missing").length;
write("data/career-url-overrides.json", overrides);
write("data/institutions-master.json", master);
write("generated/ninth-private-discovery-batch-milestone.json", {
  generatedAt, scope: validation.scope, reviewedCount: validation.reviewedCount,
  appliedCount: validation.promotedCount, heldCount: validation.heldCount,
  newlyCoveredCount: validation.promotedCount, coveredAfter: master.counts.covered,
  missingAfter: master.counts.missing, safeguards,
});
console.log(`Applied ${promoted.length} sources; ${heldNames.length} held.`);
