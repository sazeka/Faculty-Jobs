#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MILESTONE_PATH = path.join(ROOT, "generated", "shared-workday-campus-facet-milestone.json");
const OUT_PATH = path.join(ROOT, "generated", "shared-workday-campus-facet-validation.json");
const milestone = JSON.parse(fs.readFileSync(MILESTONE_PATH, "utf8"));

function endpointFor(url) {
  const parsed = new URL(url);
  const tenant = parsed.hostname.split(".")[0];
  const site = parsed.pathname.split("/").filter(Boolean)[0];
  return `https://${parsed.hostname}/wday/cxs/${tenant}/${site}/jobs`;
}

function appliedFacetsFor(url) {
  const facets = {};
  for (const [key, value] of new URL(url).searchParams) {
    if (!facets[key]) facets[key] = [];
    facets[key].push(value);
  }
  return facets;
}

async function postJobs(endpoint, appliedFacets) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appliedFacets, limit: 20, offset: 0, searchText: "" }),
  });
  if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
  return response.json();
}

const byEndpoint = new Map();
for (const item of milestone.applied || []) {
  const endpoint = endpointFor(item.career_url);
  if (!byEndpoint.has(endpoint)) byEndpoint.set(endpoint, []);
  byEndpoint.get(endpoint).push(item);
}

const validated = [];
for (const [endpoint, items] of byEndpoint) {
  const unfiltered = await postJobs(endpoint, {});
  const locationFacet = (unfiltered.facets || [])
    .flatMap((facet) => facet.values || [])
    .find((facet) => facet.facetParameter === "locations");
  const officialLocations = new Map((locationFacet?.values || []).map((value) => [value.id, value]));

  for (const item of items) {
    const official = officialLocations.get(item.facetId);
    if (!official) throw new Error(`${item.name}: facet ${item.facetId} is absent from the official location facet`);
    const response = await postJobs(endpoint, appliedFacetsFor(item.career_url));
    if (!Number.isFinite(Number(response.total))) throw new Error(`${item.name}: Workday response has no finite total`);
    validated.push({
      name: item.name,
      source: item.source,
      facetId: item.facetId,
      officialDescriptor: official.descriptor,
      currentPostingCount: Number(response.total),
      sampleTitles: (response.jobPostings || []).slice(0, 3).map((job) => job.title),
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  validatedCount: validated.length,
  allFacetIdsPresentInOfficialApi: validated.length === milestone.appliedCount,
  campusesWithCurrentPostings: validated.filter((item) => item.currentPostingCount > 0).length,
  validated,
};
fs.writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Validated ${validated.length} official Workday campus facets (${report.campusesWithCurrentPostings} currently have matching postings).`);
