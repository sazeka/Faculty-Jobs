#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const write = (name, value) => fs.writeFileSync(path.join(ROOT, name), JSON.stringify(value, null, 2) + "\n");
const key = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

const VERIFIED = [
  {
    name: "William R Moore College of Technology",
    career_url: "https://www.mooretech.edu/news",
    platform_type: "mooretech-news",
    evidence: "The official news feed publishes current faculty and instructor hiring announcements as durable detail links.",
  },
];

const EXCLUDED = [
  {
    name: "Young Americans College of the Performing Arts",
    reason: "Excluded (2026-08-24): the college formally closed after the Spring 2025 term and voluntarily withdrew accreditation; it is no longer an active degree-granting hiring institution.",
    sources: ["https://accjc.org/wp-content/uploads/The-Young-Americans-College-of-the-Performing-Action-Letters.pdf"],
  },
  {
    name: "The Landing School",
    reason: "Excluded (2026-08-24): the Board ceased all 2026-27 academic programs, stopped accepting applications, and reported that a proposed acquisition was not viable. Excluded from the active degree-granting target while operations remain ceased.",
    sources: ["https://www.landingschool.edu/ongoing-updates-the-landing-school"],
  },
  {
    name: "Lawrence Memorial Hospital School of Nursing",
    reason: "Excluded (2026-08-24): the school no longer admits students and closed its nursing program in 2025 when the AS curriculum moved to Regis College; it is no longer an independently hiring degree-granting school.",
    sources: ["https://catalog.regiscollege.edu/catalog/academics/associate-degree-programs-partnership"],
  },
];

const ACTIVE_UNRESOLVED = [
  { name: "Hypnosis Motivation Institute", group: "career_technical", reason: "Official faculty directory verified, but no public employee openings source was found." },
  { name: "ICOHS College", group: "career_technical", reason: "Official careers content is student/alumni placement; no employee hiring source was found." },
  { name: "SABER College", group: "career_technical", reason: "Official careers content is student placement; no employee hiring source was found." },
  { name: "Generations College", group: "career_technical", reason: "Official careers and student-employment pages are student-facing; no employee hiring source was found." },
  { name: "Ohio Institute of Allied Health", group: "career_technical", reason: "Current jobs appear only on an unlinked third-party employer page; the official site exposes no employee source." },
  { name: "Clary Sage College", group: "career_technical", reason: "Verified as a Community Care College branch campus, but no durable campus-scoped employee facet was found." },
  { name: "Oklahoma Technical College", group: "career_technical", reason: "Verified as a Community Care College branch campus, but no durable campus-scoped employee facet was found." },
  { name: "Huntington Junior College", group: "career_technical", reason: "The institution now presents itself as Amerion College, but the official site exposes no employee openings source." },
  { name: "Assumption College for Sisters", group: "seminary", reason: "Active accreditation was reaffirmed in 2025, but no public employee openings source was found." },
  { name: "Seminary Bnos Chaim", group: "seminary", reason: "Current accreditation and degree authority verified; no public employee openings source was found." },
  { name: "Bnos Zion Of Bobov Seminary", group: "seminary", reason: "Current accreditation through 2035 verified; no public employee openings source was found." },
  { name: "New York Seminary", group: "seminary", reason: "Current institutional listing verified; no public employee openings source was found." },
  { name: "Ohel Margulia Seminary", group: "seminary", reason: "Current accreditation through 2033 verified; no public employee openings source was found." },
  { name: "Seminar L'moros Bais Yaakov", group: "seminary", reason: "Current accreditation through 2035 verified; no public employee openings source was found." },
  { name: "Jefferson Regional School of Nursing", group: "affiliate", reason: "Active accredited nursing school verified; the parent hospital board exposes no school-specific employee facet." },
  { name: "Cochran School of Nursing", group: "affiliate", reason: "Active registration, accreditation, and student applications verified; the parent hospital exposes no school-specific employee facet." },
  { name: "American Academy McAllister Institute of Funeral Service", group: "affiliate", reason: "Active institution verified; no employee openings source was found." },
  { name: "Pittsburgh Institute of Mortuary Science Inc", group: "affiliate", reason: "Active institution verified; the public jobs board serves students and alumni rather than institute hiring." },
  { name: "John A Gupton College", group: "affiliate", reason: "Active institution verified; no employee openings source was found." },
];

function main() {
  const master = read("data/institutions-master.json");
  const overrides = read("data/career-url-overrides.json");
  const rules = read("data/policy-rules.json");
  const institutions = new Map(master.institutions.map((row) => [key(row.name), row]));
  const overrideMap = new Map((overrides.overrides || []).map((row) => [key(row.name), row]));
  const now = new Date().toISOString();

  for (const item of VERIFIED) {
    const institution = institutions.get(key(item.name));
    if (!institution) throw new Error(`Missing institution: ${item.name}`);
    institution.career_url = item.career_url;
    institution.platform_type = item.platform_type;
    institution.coverage_source = null;
    institution.coverage_status = "covered";
    institution.verification_status = "verified";
    institution.last_verified_at = now;
    institution.last_checked_at = now;
    institution.last_discovery_status = "private_specialty_source_validated";
    institution.last_discovery_confidence = 0.99;
    overrideMap.set(key(item.name), {
      ...(overrideMap.get(key(item.name)) || {}),
      name: item.name,
      homepage_url: institution.homepage_url,
      career_url: item.career_url,
      platform_type: item.platform_type,
      notes: `Official employee source verified 2026-08-24. ${item.evidence}`,
    });
  }

  for (const item of EXCLUDED) {
    const institution = institutions.get(key(item.name));
    if (!institution) throw new Error(`Missing institution: ${item.name}`);
    institution.last_checked_at = now;
    institution.verification_status = "verified_inactive";
    institution.last_discovery_status = "policy_excluded_inactive";
    institution.last_discovery_confidence = 1;
    const priorNotes = String(institution.notes || "").replace(/\s+/g, " ").trim();
    institution.notes = priorNotes.includes(item.reason) ? priorNotes : `${priorNotes} ${item.reason}`.trim();
    rules.institutionOverrides[item.name] = { action: "exclude", reason: item.reason, sources: item.sources };
  }

  for (const item of ACTIVE_UNRESOLVED) {
    const institution = institutions.get(key(item.name));
    if (!institution) throw new Error(`Missing institution: ${item.name}`);
    if (institution.coverage_status !== "missing") throw new Error(`Expected active institution to remain missing: ${item.name}`);
    institution.last_checked_at = now;
    institution.last_discovery_status = `${item.group}_status_reviewed_unresolved`;
    institution.last_discovery_confidence = 0;
  }

  const amerion = institutions.get(key("Huntington Junior College"));
  amerion.aliases = [...new Set([...(amerion.aliases || []), "Amerion College"])];
  amerion.homepage_url = "https://amerion.edu/";
  const amerionNote = "Institution now operates publicly as Amerion College; the IPEDS canonical name is retained for identity continuity.";
  const priorAmerionNotes = String(amerion.notes || "").replace(/\s+/g, " ").trim();
  amerion.notes = priorAmerionNotes.includes(amerionNote) ? priorAmerionNotes : `${priorAmerionNotes} ${amerionNote}`.trim();

  master.generatedAt = now;
  master.counts.covered = master.institutions.filter((row) => row.coverage_status === "covered").length;
  master.counts.missing = master.institutions.filter((row) => row.coverage_status === "missing").length;
  overrides.updatedAt = now;
  overrides.overrides = [...overrideMap.values()].sort((a, b) => key(a.name).localeCompare(key(b.name)));
  rules.lastReviewed = "2026-08-24";

  write("data/institutions-master.json", master);
  write("data/career-url-overrides.json", overrides);
  fs.writeFileSync(
    path.join(ROOT, "data/policy-rules.json"),
    JSON.stringify(rules, null, 2).replace(/—/g, "\\u2014") + "\n"
  );
  write("generated/private-specialty-closeout-report.json", {
    generatedAt: now,
    careerTechnicalReviewed: 11,
    seminariesAndAffiliatesReviewed: 12,
    reviewed: VERIFIED.length + EXCLUDED.length + ACTIVE_UNRESOLVED.length,
    accepted: VERIFIED.length,
    excluded: EXCLUDED.length,
    activeUnresolved: ACTIVE_UNRESOLVED.length,
    acceptedSources: VERIFIED,
    policyExclusions: EXCLUDED,
    unresolved: ACTIVE_UNRESOLVED,
  });
  console.log(`Private specialty closeout: accepted ${VERIFIED.length}, excluded ${EXCLUDED.length}, active unresolved ${ACTIVE_UNRESOLVED.length}`);
}

main();
