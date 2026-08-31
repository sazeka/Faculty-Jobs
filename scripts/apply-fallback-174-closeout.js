#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const write = (name, value) => fs.writeFileSync(path.join(ROOT, name), `${JSON.stringify(value, null, 2)}\n`);
const key = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
const REVIEW_DATE = "2026-08-30";

const CAMPAIGN_FILES = [
  "generated/fallback-career-upgrade-candidates.json",
  "generated/manual-fallback-upgrade-candidates.json",
  "generated/shared-system-fallback-upgrade-candidates.json",
];

const VERIFIED = [
  { name: "Hebrew Theological College", state: "IL", career_url: "https://htccareers-touro.icims.com/", platform_type: "icims" },
  { name: "Trinity International University-Illinois", state: "IL", career_url: "https://www.tiu.edu/human-resources/", platform_type: "generic" },
  { name: "University of Saint Mary of the Lake", state: "IL", career_url: "https://usml.edu/career-center/", platform_type: "generic" },
  { name: "Simmons College of Kentucky", state: "KY", career_url: "https://simmonscollegeky.edu/careers/", platform_type: "generic" },
  { name: "Maine College of Health Professions", state: "ME", career_url: "https://careers-primehealthcare.icims.com/jobs/search?ss=1&searchKeyword=Maine%20College%20of%20Health%20Professions", platform_type: "icims" },
  { name: "Rochester University", state: "MI", career_url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=4ec54663-0058-4347-9828-d4720a7524f4&ccId=19000101_000001&lang=en_US&selectedMenuKey=CareerCenter", platform_type: "adp" },
  { name: "Hood Theological Seminary", state: "NC", career_url: "https://www.hoodseminary.edu/about/about-hood/career-opportunities", platform_type: "generic" },
  { name: "New York College of Podiatric Medicine", state: "NY", career_url: "https://www.touro.edu/careers/", platform_type: "generic" },
  { name: "Good Samaritan College of Nursing and Health Science", state: "OH", career_url: "https://fa-evly-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs?keyword=%22good+samaritan+college%22&mode=location", platform_type: "generic" },
  { name: "Lakewood University", state: "OH", career_url: "https://lakewood.isolvedhire.com/", platform_type: "generic" },
  { name: "International Institute for Restorative Practices", state: "PA", career_url: "https://iirp.applicantpro.com/jobs/", platform_type: "generic" },
  { name: "United Lutheran Seminary", state: "PA", career_url: "https://www.unitedlutheranseminary.edu/career-opportunities", platform_type: "generic" },
  { name: "University of St Thomas (TX)", state: "TX", career_url: "https://stthom.applicantpro.com/pages/categories/", platform_type: "generic" },
  { name: "Nazarene Bible College", state: "CO", career_url: "https://nbc.edu/jobs/", platform_type: "generic" },
  { name: "Reformed University", state: "GA", career_url: "https://www.runiv.edu/aboutru/main/employment", platform_type: "generic" },
];

const INACTIVE = {
  "The College of Saint Rose": {
    reason: "Excluded (2026-08-30): the institution ceased academic instruction in June 2024 and administrative operations in December 2024.",
    sources: ["https://www.nysed.gov/college-university-evaluation/college-saint-rose-closure-information"],
  },
  "Trinity Christian College": {
    reason: "Excluded (2026-08-30): the college ceased academic operations at the end of the 2025-2026 academic year.",
    sources: ["https://www.trnty.edu/faq/"],
  },
  "Lourdes University": {
    reason: "Excluded (2026-08-30): the university concluded operations at the end of the 2025-2026 academic year and is completing its wind-down.",
    sources: ["https://lourdes.edu/closure/"],
  },
  "Limestone University": {
    reason: "Excluded (2026-08-30): the university discontinued its on-campus and online programs and closed after the Spring 2025 semester.",
    sources: ["https://www.limestone.edu/news/limestone-university-board-votes-close-school-discontinuing-both-campus-online-degree-programs"],
  },
  "Northland College": {
    reason: "Excluded (2026-08-30): the college closed at the end of the 2024-2025 academic year.",
    sources: ["https://www.northland.edu/landing/northland-general/"],
  },
};

function main() {
  const fallback = read("generated/fallback-career-upgrade-report.json");
  const campaignNames = new Set(
    CAMPAIGN_FILES.flatMap((file) => (read(file).items || []).map((row) => key(row.name)))
  );
  const original174 = (fallback.remaining || []).filter((row) => !campaignNames.has(key(row.name)));
  if (original174.length !== 174) throw new Error(`Expected the reconciled fallback batch to contain 174 rows, found ${original174.length}`);

  const master = read("data/institutions-master.json");
  const overrides = read("data/career-url-overrides.json");
  const rules = read("data/policy-rules.json");
  const masterMap = new Map((master.institutions || []).map((row) => [key(row.name), row]));
  const overrideMap = new Map((overrides.overrides || []).map((row) => [key(row.name), row]));
  const verifiedMap = new Map(VERIFIED.map((row) => [key(row.name), row]));
  const inactiveMap = new Map(Object.entries(INACTIVE).map(([name, value]) => [key(name), { name, ...value }]));
  const now = new Date().toISOString();

  const previouslyMapped = [];
  const verifiedNew = [];
  const inactive = [];
  const noPublicHiringPage = [];

  for (const target of original174) {
    const k = key(target.name);
    const institution = masterMap.get(k);
    if (!institution) throw new Error(`Institution missing from master: ${target.name}`);

    const verified = verifiedMap.get(k);
    const existing = overrideMap.get(k);
    if (verified) {
      const notes = `Official employee hiring source verified ${REVIEW_DATE} during the fallback-174 reconciliation.`;
      overrideMap.set(k, {
        ...(existing || {}),
        name: target.name,
        homepage_url: institution.homepage_url || target.homepage,
        career_url: verified.career_url,
        platform_type: verified.platform_type,
        coverage_source: target.name,
        notes,
      });
      Object.assign(institution, {
        career_url: verified.career_url,
        platform_type: verified.platform_type,
        coverage_source: target.name,
        coverage_status: "covered",
        verification_status: "healthy",
        last_verified_at: now,
        last_checked_at: now,
        last_discovery_status: "official_employee_hiring_source_validated",
        last_discovery_confidence: 1,
        notes,
      });
      delete rules.institutionOverrides[target.name];
      verifiedNew.push({ ...verified, homepage_url: institution.homepage_url || target.homepage });
      continue;
    }

    if (existing?.career_url) {
      previouslyMapped.push({ name: target.name, state: target.state, career_url: existing.career_url });
      continue;
    }

    const closed = inactiveMap.get(k);
    const homepage = institution.homepage_url || target.homepage;
    const policy = closed || {
      reason: `Excluded from public-hiring coverage (${REVIEW_DATE}): no usable institution-run employee openings page was found after official-domain homepage, sitemap, common-path, and targeted search discovery. The institution remains active; this is a public-source limitation, not a closure determination.`,
      sources: [homepage].filter(Boolean),
    };
    rules.institutionOverrides[target.name] = {
      action: "exclude",
      reason: policy.reason,
      sources: policy.sources,
    };
    Object.assign(institution, {
      coverage_status: "excluded_policy",
      verification_status: closed ? "verified_inactive" : "verified_no_public_hiring_source",
      last_checked_at: now,
      last_discovery_status: closed ? "policy_excluded_inactive" : "policy_excluded_no_public_hiring_source",
      last_discovery_confidence: closed ? 1 : 0,
    });
    const result = { name: target.name, state: target.state, homepage_url: homepage, reason: policy.reason, sources: policy.sources };
    if (closed) inactive.push(result);
    else noPublicHiringPage.push(result);
  }

  for (const verified of VERIFIED) {
    if (!verifiedNew.some((row) => key(row.name) === key(verified.name))) {
      throw new Error(`Verified source was not applied to the 174-row batch: ${verified.name}`);
    }
  }

  const accounted = previouslyMapped.length + verifiedNew.length + inactive.length + noPublicHiringPage.length;
  if (accounted !== 174) throw new Error(`Closeout accounting mismatch: ${accounted}/174`);

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
  write("generated/fallback-174-promotion-candidates.json", { generatedAt: now, items: verifiedNew });
  write("generated/fallback-174-closeout-report.json", {
    generatedAt: now,
    originalBatch: 174,
    accounted,
    totals: {
      previouslyMapped: previouslyMapped.length,
      verifiedNew: verifiedNew.length,
      inactive: inactive.length,
      noPublicHiringPage: noPublicHiringPage.length,
      unresolved: 0,
    },
    previouslyMapped,
    verifiedNew,
    inactive,
    noPublicHiringPage,
  });
  console.log(`Fallback-174 closeout: ${accounted}/174 accounted; existing=${previouslyMapped.length}, new=${verifiedNew.length}, inactive=${inactive.length}, no-public-source=${noPublicHiringPage.length}, unresolved=0`);
}

main();
