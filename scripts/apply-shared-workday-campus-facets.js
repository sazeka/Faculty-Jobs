#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PATH = path.join(ROOT, "server.js");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const REPORT_PATH = path.join(ROOT, "generated", "shared-workday-campus-facet-milestone.json");

const PSU_COMMON = "timeType=b9c7a8628206010c6cedcb3aa4474a00&jobFamily=57340197317201e0b53836bfde4ae85f";
const OSU_COMMON = "timeType=38709af0feb60197596be2b9ff095800&jobFamilyGroup=67612469e2ea01a29e348f105b01ff10";

const groups = [
  {
    source: "The Pennsylvania State University",
    marker: '  {\n    campus: "The Pennsylvania State University",',
    base: "https://psu.wd1.myworkdayjobs.com/PSU_Academic",
    common: PSU_COMMON,
    items: [
      ["Pennsylvania State University-Penn State Abington", "b0858b72065c01db6fcc2c00c501ea12"],
      ["Pennsylvania State University-Penn State Altoona", "ac1efd63d810019d9b1dec32c7010c1c"],
      ["Pennsylvania State University-Penn State Beaver", "52f02272e496018002c169acc501be17"],
      ["Pennsylvania State University-Penn State Berks", "a85e9b4f6d2001e9e53607fbc4019110"],
      ["Pennsylvania State University-Penn State Brandywine", "52f02272e496014b250d54acc501b917"],
      ["Pennsylvania State University-Penn State DuBois", "ac1efd63d810011f1c93c332c701071c"],
      ["Pennsylvania State University-Penn State Erie-Behrend College", "52f02272e496018b56ce3eacc501b417"],
      ["Pennsylvania State University-Penn State Fayette- Eberly", "cbe735ea2e6d019fa0b439b4c5015712"],
      ["Pennsylvania State University-Penn State Great Valley", "573401973172013c148bbab2e14a2365"],
      ["Pennsylvania State University-Penn State Greater Allegheny", "e0040d8047ed01e51b54ca63c5016914"],
      ["Pennsylvania State University-Penn State Harrisburg", "e0040d8047ed016207d5bf63c5016414"],
      ["Pennsylvania State University-Penn State Hazleton", "e0040d8047ed01d55af7b563c5015f14"],
      ["Pennsylvania State University-Penn State Lehigh Valley", "c80ecc155645012544a5405fc50190d3"],
      ["Pennsylvania State University-Penn State Mont Alto", "b0858b72065c01f8a82a5102c5011c13"],
      ["Pennsylvania State University-Penn State Schuylkill", "b0858b72065c016f25d63c02c5011713"],
      ["Pennsylvania State University-Penn State Scranton", "12c4a9bad727016b853043abc5019111"],
      ["Pennsylvania State University-Penn State Shenango", "c1cfc9c255a401aad5f3f94bc5016c12"],
      ["Pennsylvania State University-Penn State Wilkes-Barre", "ac1efd63d81001c8b2334232c701021c"],
      ["Pennsylvania State University-Penn State York", "ac1efd63d81001e62e623732c701fd1b"],
    ],
  },
  {
    source: "Ohio State University",
    marker: '  {\n    campus: "Ohio State University",',
    base: "https://osu.wd1.myworkdayjobs.com/OSUCareers",
    common: OSU_COMMON,
    items: [
      ["Ohio State University-Lima Campus", "819c1ab743bd011392808600650189b6"],
      ["Ohio State University-Mansfield Campus", "819c1ab743bd01d41327930065018eb6"],
      ["Ohio State University-Marion Campus", "819c1ab743bd01d135bb9400650193b6"],
      ["Ohio State University-Newark Campus", "819c1ab743bd015ff0249600650198b6"],
    ],
  },
];

const urlFor = (group, facetId) => `${group.base}?locations=${facetId}&${group.common}`;
let server = fs.readFileSync(SERVER_PATH, "utf8");
const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const existingOverrides = new Map((overrides.overrides || []).map((item) => [item.name.toLowerCase(), item]));
const institutions = new Map((master.institutions || []).map((item) => [item.name.toLowerCase(), item]));
const applied = [];

for (const group of groups) {
  const configs = group.items.map(([name, facetId]) => {
    const url = urlFor(group, facetId);
    return `  { campus: ${JSON.stringify(name)}, type: "workday", url: ${JSON.stringify(url)} },`;
  }).join("\n");

  if (!server.includes(`campus: ${JSON.stringify(group.items[0][0])}`)) {
    const markerIndex = server.indexOf(group.marker);
    if (markerIndex < 0) throw new Error(`Could not find insertion marker for ${group.source}`);
    server = `${server.slice(0, markerIndex)}${configs}\n${server.slice(markerIndex)}`;
  }

  for (const [name, facetId] of group.items) {
    const url = urlFor(group, facetId);
    const entry = {
      name,
      career_url: url,
      platform_type: "workday",
      coverage_source: group.source,
      notes: `Verified 2026-08-25 through the official public Workday API: unique campus location facet ${facetId}, combined with the existing academic/faculty filters. Campus route is ordered before the broad ${group.source} route so URL deduplication preserves exact campus attribution.`,
    };
    const prior = existingOverrides.get(name.toLowerCase());
    if (prior) Object.assign(prior, entry);
    else {
      overrides.overrides.push(entry);
      existingOverrides.set(name.toLowerCase(), entry);
    }
    const institution = institutions.get(name.toLowerCase());
    if (!institution) throw new Error(`Institution missing from master: ${name}`);
    institution.career_url = url;
    institution.platform_type = "workday";
    institution.coverage_source = group.source;
    institution.coverage_status = "covered";
    institution.verification_status = "healthy";
    institution.last_verified_at = new Date().toISOString();
    institution.last_discovery_status = "shared_workday_campus_facet_validated";
    institution.last_discovery_confidence = 1;
    if (!String(institution.notes || "").includes(`unique campus location facet ${facetId}`)) {
      institution.notes = `${String(institution.notes || "").trim()} ${entry.notes}`.trim();
    }
    applied.push({ name, source: group.source, facetId, career_url: url });
  }
}

overrides.updatedAt = new Date().toISOString();
master.generatedAt = new Date().toISOString();
master.counts.covered = master.institutions.filter((item) => item.coverage_status === "covered").length;
master.counts.missing = master.institutions.filter((item) => item.coverage_status === "missing").length;
fs.writeFileSync(SERVER_PATH, server);
fs.writeFileSync(OVERRIDES_PATH, `${JSON.stringify(overrides, null, 2)}\n`);
fs.writeFileSync(MASTER_PATH, `${JSON.stringify(master, null, 2)}\n`);
fs.writeFileSync(REPORT_PATH, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  appliedCount: applied.length,
  applied,
  heldForReview: [{
    name: "Pennsylvania State University-Penn State New Kensington",
    reason: "The current Workday location facet response exposes no New Kensington campus facet; no unscoped fallback was promoted.",
  }],
}, null, 2)}\n`);

console.log(`Applied ${applied.length} official campus-scoped Workday sources.`);
