#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const write = (name, value) => fs.writeFileSync(path.join(ROOT, name), `${JSON.stringify(value, null, 2)}\n`);
const key = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
const REVIEW_DATE = "2026-08-31";

const DISCOVERY_FILES = [
  "generated/private-nonprofit-four-year-career-discovery-report.json",
  "generated/public-four-year-career-discovery-report.json",
];

const REPLACEMENTS = {
  "Le Moyne-Owen College": "https://loc.edu/student-life/career-services-2/",
  "New England College of Optometry": "https://www.neco.edu/jobs/",
  "Nichols College": "https://www.nichols.edu/offices/human-resources/",
  "Sacred Heart Major Seminary": "https://www.shms.edu/human-resources",
  "United States Military Academy": "https://www.usajobs.gov/Search/Results?l=West%20Point%2C%20New%20York",
  "William Peace University": "https://peace.edu/about/work-at-wpu/",
  "Winebrenner Theological Seminary": "https://winebrenner.edu/career-opportunities/",
  "Westminster Theological Seminary": "https://info.wts.edu/article/226-employment-opportunities",
};

const EXCLUSIONS = {
  "Lancaster Theological Seminary": {
    reason: "Excluded (2026-08-31): merged into Moravian University; Moravian is the surviving institution and operates the combined School of Theology.",
    sources: ["https://news.moravian.edu/2025/08/12/new-school-of-theology/"],
  },
  "Maryland University of Integrative Health": {
    reason: "Excluded (2026-08-31): merged into Notre Dame of Maryland University in 2025 and no longer exists as a separate institution.",
    sources: ["https://rtdw.ndm.edu/academics/integrative-health/soih-faqs"],
  },
  "Marymount Manhattan College": {
    reason: "Excluded (2026-08-31): the completed merger created Northeastern University-New York City; MMC no longer operates as a separate institution.",
    sources: ["https://news.northeastern.edu/marymount-manhattan-college-merger-faq/"],
  },
  "Memphis Theological Seminary": {
    reason: "Excluded (2026-08-31): the seminary concluded operations on July 31, 2026.",
    sources: ["https://memphisseminary.edu/faq/"],
  },
  "Northcentral University": {
    reason: "Excluded (2026-08-31): merged into National University in 2022 and no longer operates as a separate institution.",
    sources: ["https://www.nu.edu/national-and-northcentral-have-merged/"],
  },
  "Northpoint Bible College": {
    reason: "Excluded from public-hiring coverage (2026-08-31): the discovered page is an external ministry job board, and no institution-run employee openings page was found.",
    sources: ["https://northpoint.edu/ministry-and-job-opportunites/"],
  },
  "New York College of Health Professions": {
    reason: "Excluded from public-hiring coverage (2026-08-31): the official site provides only an HR inquiry channel and explicitly does not publish current vacancies.",
    sources: ["https://www.nycollege.edu/administration-faculty/"],
  },
  "Pennsylvania Institute of Technology": {
    reason: "Excluded from public-hiring coverage (2026-08-31): the discovered URL is a student-facing career article, and no institution-run employee openings page was found.",
    sources: ["https://www.pit.edu/"],
  },
  "Presidio Graduate School": {
    reason: "Excluded (2026-08-31): merged into the University of Redlands and no longer operates as a separate institution.",
    sources: ["https://www.redlands.edu/contentassets/4bf663358374408c9f7118de579906b1/redlands_presidents_report_fy2022-23-lowres.pdf"],
  },
  "Salus University": {
    reason: "Excluded (2026-08-31): fully merged into Drexel University and now operates as Drexel's Elkins Park Campus.",
    sources: ["https://drexel.edu/about/salus"],
  },
  "Siena Heights University": {
    reason: "Excluded (2026-08-31): the university closed after the 2025-2026 academic year.",
    sources: ["https://www.sienaheights.edu/who-we-are/university-news/"],
  },
  "St. Augustine College": {
    reason: "Excluded (2026-08-31): merged into Lewis University and no longer operates as a separate institution.",
    sources: ["https://www.lewisu.edu/publications/magazines/fall-2023/index.htm"],
  },
  "Woodbury University": {
    reason: "Excluded (2026-08-31): the 2026 merger made the University of Redlands the continuing institution; the campus now operates as University of Redlands-Los Angeles.",
    sources: ["https://www.redlands.edu/about/office-of-the-president/presidents-messages/2026/university-of-redlands-and-woodbury-university-complete-historic-merger"],
  },
  "World Mission University": {
    reason: "Excluded from public-hiring coverage (2026-08-31): the discovered URL is a federal gainful-employment disclosure, and no public employee openings page was found.",
    sources: ["https://wmu.edu/gainful-employment/"],
  },
};

function inferPlatform(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes("myworkdayjobs.com")) return "workday";
  if (value.includes("schooljobs.com")) return "schooljobs";
  if (value.includes("workforcenow.adp.com")) return "adp";
  if (value.includes("paycomonline.net")) return "paycom";
  if (value.includes("oraclecloud.com")) return "oracle-cx";
  // UltiPro is not implemented consistently across the state dispatchers;
  // retain its verified landing page and let the generic scraper handle it.
  return "generic";
}

function main() {
  const master = read("data/institutions-master.json");
  const overrides = read("data/career-url-overrides.json");
  const rules = read("data/policy-rules.json");
  const discovery = DISCOVERY_FILES
    .filter((file) => fs.existsSync(path.join(ROOT, file)))
    .flatMap((file) => read(file).items || []);
  const discoveryMap = new Map(discovery.map((row) => [key(row.name), row]));
  const masterMap = new Map((master.institutions || []).map((row) => [key(row.name), row]));
  const overrideMap = new Map((overrides.overrides || []).map((row) => [key(row.name), row]));
  const exclusionMap = new Map(Object.entries(EXCLUSIONS).map(([name, value]) => [key(name), { name, ...value }]));
  const now = new Date().toISOString();
  const priorReportPath = path.join(ROOT, "generated/reviewed-99-closeout-report.json");
  const priorReport = fs.existsSync(priorReportPath) ? JSON.parse(fs.readFileSync(priorReportPath, "utf8")) : null;
  const priorNames = new Set(
    [...(priorReport?.verified || []), ...(priorReport?.excluded || [])].map((row) => key(row.name)),
  );
  const priorRowMap = new Map(
    [...(priorReport?.verified || []), ...(priorReport?.excluded || [])].map((row) => [key(row.name), row]),
  );

  const reviewRows = (master.institutions || [])
    .filter((row) => priorNames.size === 99
      ? priorNames.has(key(row.name))
      : row.level === "4-year" && row.coverage_status === "missing")
    .map((row) => {
      const prior = priorRowMap.get(key(row.name));
      return {
        institution: row,
        discovery: discoveryMap.get(key(row.name)) || {
          selected: {
            score: prior?.discovery_score ?? prior?.score,
            url: prior?.original_candidate_url ?? prior?.career_url ?? prior?.sources?.[0],
          },
        },
      };
    })
    .filter((row) => Number(row.discovery?.selected?.score || 0) >= 11)
    .sort((a, b) => Number(b.discovery.selected.score) - Number(a.discovery.selected.score) || a.institution.name.localeCompare(b.institution.name));

  if (reviewRows.length !== 99) throw new Error(`Expected 99 high/medium candidates, found ${reviewRows.length}`);

  const verified = [];
  const excluded = [];
  for (const { institution, discovery: found } of reviewRows) {
    const exclusion = exclusionMap.get(key(institution.name));
    if (exclusion) {
      rules.institutionOverrides[institution.name] = {
        action: "exclude",
        reason: exclusion.reason,
        sources: exclusion.sources,
      };
      Object.assign(institution, {
        coverage_status: "excluded_policy",
        verification_status: /merged|closed|concluded operations/.test(exclusion.reason) ? "verified_inactive" : "verified_no_public_hiring_source",
        last_checked_at: now,
        last_discovery_status: "policy_excluded_after_manual_review",
        last_discovery_confidence: 1,
      });
      excluded.push({ name: institution.name, state: institution.state, score: found.selected.score, ...exclusion });
      continue;
    }

    const careerUrl = REPLACEMENTS[institution.name] || found.selected.url;
    const platformType = inferPlatform(careerUrl);
    const note = `Official employee hiring source manually verified ${REVIEW_DATE} during the high/medium-confidence candidate review.`;
    overrideMap.set(key(institution.name), {
      ...(overrideMap.get(key(institution.name)) || {}),
      name: institution.name,
      homepage_url: institution.homepage_url,
      career_url: careerUrl,
      platform_type: platformType,
      coverage_source: institution.name,
      notes: note,
    });
    Object.assign(institution, {
      career_url: careerUrl,
      platform_type: platformType,
      coverage_source: institution.name,
      coverage_status: "covered",
      verification_status: "healthy",
      last_verified_at: now,
      last_checked_at: now,
      last_discovery_status: "official_employee_hiring_source_validated",
      last_discovery_confidence: 1,
      notes: note,
    });
    delete rules.institutionOverrides[institution.name];
    verified.push({
      name: institution.name,
      state: institution.state,
      homepage_url: institution.homepage_url,
      career_url: careerUrl,
      platform_type: platformType,
      discovery_score: found.selected.score,
      original_candidate_url: found.selected.url,
      replacement_applied: careerUrl !== found.selected.url,
    });
  }

  if (verified.length !== 85 || excluded.length !== 14) {
    throw new Error(`Review accounting mismatch: verified=${verified.length}, excluded=${excluded.length}`);
  }
  for (const name of Object.keys(EXCLUSIONS)) {
    if (!excluded.some((row) => key(row.name) === key(name))) throw new Error(`Exclusion not found in review batch: ${name}`);
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
  write("generated/reviewed-99-promotion-candidates.json", { generatedAt: now, items: verified });
  write("generated/reviewed-99-closeout-report.json", {
    generatedAt: now,
    reviewDate: REVIEW_DATE,
    reviewed: reviewRows.length,
    totals: {
      high_signal_reviewed: reviewRows.filter((row) => Number(row.discovery.selected.score) >= 15).length,
      medium_confidence_reviewed: reviewRows.filter((row) => Number(row.discovery.selected.score) < 15).length,
      verified: verified.length,
      excluded: excluded.length,
      unresolved: 0,
    },
    verified,
    excluded,
  });
  console.log(`Reviewed-99 closeout: verified=${verified.length}, excluded=${excluded.length}, unresolved=0`);
}

main();
