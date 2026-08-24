#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeDiscoveredCareerUrl } from "./lib/career-path-probe.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const DISCOVERY_PATH = path.join(ROOT, "generated", "career-discovery-report.json");
const CANDIDATES_PATH = path.join(ROOT, "generated", "promotion-candidates-ten-state-two-year.json");
const REVIEW_PATH = path.join(ROOT, "generated", "ten-state-two-year-pass-report.json");
const STATES = new Set(["AL", "AR", "KS", "MA", "MI", "NJ", "NM", "PA", "SC", "WI"]);

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();

const REJECTED_AUTOMATIC = new Map([
  ["University of New Mexico-Gallup Campus", "Discovery found one CSOD requisition, not a campus-scoped hiring board."],
  ["University of Arkansas Community College Rich Mountain", "The linked Workday board covers the full University of Arkansas System without a verified campus facet."],
  ["Jefferson Regional School of Nursing", "The linked ADP board is hospital-wide and lacks reliable school or faculty scoping."],
]);

const VERIFIED = [
  { name: "Glen Oaks Community College", career_url: "https://www.glenoaks.edu/about-gocc/college-operations/human-resources/jobs/index.php", platform_type: "generic" },
  { name: "Gogebic Community College", career_url: "https://gogebic.edu/aboutus/HR/index.html", platform_type: "generic" },
  { name: "Kellogg Community College", career_url: "https://kellogg.edu/about/departments/hr/employment-opportunities/", platform_type: "generic" },
  { name: "St Clair County Community College", career_url: "https://sc4.edu/about/careers-at-sc4/", platform_type: "generic" },
  { name: "Wayne County Community College District", career_url: "https://www.wcccd.edu/divisions/human-resources/jobs-at-wcccd", platform_type: "generic" },
  { name: "Highland Community College (KS)", career_url: "https://www.highlandcc.edu/abouthcc/human-resources/", platform_type: "generic" },
  { name: "Johnson College", career_url: "https://johnson.edu/human-resources/", platform_type: "generic" },
  { name: "H Councill Trenholm State Community College", career_url: "https://www.trenholmstate.edu/about-tscc/administration/human-resources/", platform_type: "generic" },
  { name: "Reid State Technical College", career_url: "https://www.reidstate.edu/employment", platform_type: "generic" },
  { name: "Midlands Technical College", career_url: "https://www.governmentjobs.com/careers/sc/midlandstech", platform_type: "schooljobs" },
  { name: "Northeastern Technical College", career_url: "https://www.governmentjobs.com/careers/sc/netc", platform_type: "schooljobs" },
  { name: "Tri-County Technical College", career_url: "https://www.schooljobs.com/careers/tctc", platform_type: "schooljobs" },
  { name: "Technical College of the Lowcountry", career_url: "https://www.governmentjobs.com/careers/sc/tcl", platform_type: "schooljobs" },
  { name: "Williamsburg Technical College", career_url: "https://www.governmentjobs.com/careers/sc/wiltech", platform_type: "schooljobs" },
].map((item) => ({ ...item, confidence: item.platform_type === "schooljobs" ? 0.98 : 0.85 }));

function main() {
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
  const discovery = JSON.parse(fs.readFileSync(DISCOVERY_PATH, "utf8"));
  const targets = (master.institutions || []).filter(
    (item) => key(item.coverage_status) === "missing" && key(item.level) === "2-year" && STATES.has(clean(item.state)),
  );
  if (targets.length !== 96 || Number(discovery.scanned) !== 96) {
    throw new Error(`Expected exactly 96 ten-state targets; master=${targets.length}, discovery=${discovery.scanned}`);
  }

  const institutions = new Map((master.institutions || []).map((item) => [key(item.name), item]));
  const targetNames = new Set(targets.map((item) => key(item.name)));
  const discoveryByName = new Map((discovery.results || []).map((item) => [key(item.name), item]));
  const accepted = new Map();

  for (const result of discovery.results || []) {
    if (!targetNames.has(key(result.name)) || result.status !== "discovered" || REJECTED_AUTOMATIC.has(result.name)) continue;
    let careerUrl = canonicalizeDiscoveredCareerUrl(result.career_url);
    if (/^http:\/\//i.test(careerUrl)) careerUrl = careerUrl.replace(/^http:/i, "https:");
    accepted.set(key(result.name), {
      name: result.name,
      career_url: careerUrl,
      platform_type: result.platform_type,
      confidence: Number(result.confidence || 0.65),
      evidence: "validated employee-hiring portal linked from an official institution page",
    });
  }
  for (const item of VERIFIED) {
    if (!targetNames.has(key(item.name))) throw new Error(`Verified institution outside target set: ${item.name}`);
    accepted.set(key(item.name), { ...item, evidence: "manually verified official employee hiring source" });
  }

  const existingOverrides = new Map((overrides.overrides || []).map((item) => [key(item.name), item]));
  const applied = [];
  for (const item of accepted.values()) {
    const institution = institutions.get(key(item.name));
    if (!institution) throw new Error(`Institution missing from master: ${item.name}`);
    institution.career_url = item.career_url;
    institution.platform_type = item.platform_type;
    institution.coverage_source = null;
    institution.last_discovery_status = "ten_state_two_year_validated";
    institution.last_discovery_confidence = item.confidence;
    institution.last_checked_at = new Date().toISOString();
    existingOverrides.set(key(item.name), {
      ...(existingOverrides.get(key(item.name)) || {}),
      name: item.name,
      homepage_url: institution.homepage_url,
      career_url: item.career_url,
      platform_type: item.platform_type,
      notes: `Reviewed in the 2026-08-24 ten-state two-year pass; ${item.evidence}.`,
    });
    applied.push(item);
  }

  const unresolved = [];
  for (const institution of targets) {
    if (accepted.has(key(institution.name))) continue;
    institution.career_url = null;
    institution.platform_type = null;
    institution.coverage_source = null;
    institution.last_discovery_status = REJECTED_AUTOMATIC.has(institution.name)
      ? "ten_state_two_year_rejected_unscoped"
      : "ten_state_two_year_unresolved";
    institution.last_discovery_confidence = 0;
    unresolved.push({
      name: institution.name,
      state: institution.state,
      reason: REJECTED_AUTOMATIC.get(institution.name) || "No sufficiently reliable employee hiring source found.",
      discoveryStatus: discoveryByName.get(key(institution.name))?.status || null,
    });
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
      source: "ten-state two-year coverage pass",
    };
  });

  fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n");
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2) + "\n");
  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), count: candidates.length, items: candidates }, null, 2) + "\n");
  fs.writeFileSync(REVIEW_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    scanned: targets.length,
    accepted: applied.length,
    unresolvedCount: unresolved.length,
    acceptedByState: Object.fromEntries([...STATES].sort().map((state) => [state, applied.filter((item) => institutions.get(key(item.name))?.state === state).length])),
    unresolvedByState: Object.fromEntries([...STATES].sort().map((state) => [state, unresolved.filter((item) => item.state === state).length])),
    rejected: [...REJECTED_AUTOMATIC].map(([name, reason]) => ({ name, reason })),
    unresolved,
  }, null, 2) + "\n");
  console.log(`Reviewed ${targets.length}: accepted ${applied.length}, unresolved ${unresolved.length}`);
}

main();
