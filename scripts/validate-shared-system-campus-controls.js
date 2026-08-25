#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MILESTONE_PATH = path.join(ROOT, "generated", "shared-system-campus-control-milestone.json");
const OUT_PATH = path.join(ROOT, "generated", "shared-system-campus-control-validation.json");
const milestone = JSON.parse(fs.readFileSync(MILESTONE_PATH, "utf8"));

const clean = (value) => String(value || "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&ndash;/g, "–")
  .replace(/\s+/g, " ")
  .trim();

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return { html: await response.text(), finalUrl: response.url };
}

function selectHtml(html, name) {
  const marker = `name="${name}"`;
  const position = html.indexOf(marker);
  if (position < 0) throw new Error(`Missing select ${name}`);
  const start = html.lastIndexOf("<select", position);
  const end = html.indexOf("</select>", position);
  if (start < 0 || end < 0) throw new Error(`Malformed select ${name}`);
  return html.slice(start, end + 9);
}

function optionMap(select) {
  return new Map([...select.matchAll(/<option([^>]*)value="([^"]*)"([^>]*)>([\s\S]*?)<\/option>/gi)]
    .map((match) => [match[2], { label: clean(match[4]), selected: /selected/i.test(`${match[1]} ${match[3]}`) }]));
}

function postingCount(html) {
  return new Set([...html.matchAll(/href="\/postings\/(\d+)"/g)].map((match) => match[1])).size;
}

async function validateWorkday(item) {
  const parsed = new URL(item.url);
  const tenant = parsed.hostname.split(".")[0];
  const site = parsed.pathname.split("/").filter(Boolean)[0];
  const endpoint = `https://${parsed.hostname}/wday/cxs/${tenant}/${site}/jobs`;
  const post = async (appliedFacets) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appliedFacets, limit: 20, offset: 0, searchText: "" }),
    });
    if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
    return response.json();
  };
  const unfiltered = await post({});
  const locationFacet = (unfiltered.facets || []).flatMap((facet) => facet.values || [])
    .find((facet) => facet.facetParameter === "locations");
  const official = (locationFacet?.values || []).find((value) => value.id === item.control);
  if (!official) throw new Error(`${item.name}: location facet ${item.control} is absent`);
  if (item.descriptor && official.descriptor !== item.descriptor) {
    throw new Error(`${item.name}: expected ${item.descriptor}, found ${official.descriptor}`);
  }
  const appliedFacets = {};
  for (const [key, value] of parsed.searchParams) {
    if (!appliedFacets[key]) appliedFacets[key] = [];
    appliedFacets[key].push(value);
  }
  const filtered = await post(appliedFacets);
  return { officialDescriptor: official.descriptor, currentPostingCount: Number(filtered.total || 0) };
}

async function validatePageUp(item) {
  const { html } = await fetchText(item.url);
  const inputs = [...html.matchAll(/<input([^>]*)name="location"([^>]*)>/gi)]
    .map((match) => `${match[1]} ${match[2]}`);
  const input = inputs.find((attrs) => new RegExp(`value="${item.control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(attrs));
  if (!input) throw new Error(`${item.name}: PageUp location ${item.control} is absent`);
  if (!/checked/i.test(input)) throw new Error(`${item.name}: PageUp did not preserve selected location ${item.control}`);
  const anchors = [...html.matchAll(/<a\b([^>]*\bclass=["'][^"']*\bjob-link\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)];
  const matchingUrls = new Set();
  for (let index = 0; index < anchors.length; index++) {
    const match = anchors[index];
    const href = (match[1] || "").match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const nextIndex = anchors[index + 1]?.index ?? html.length;
    const tail = html.slice((match.index || 0) + match[0].length, nextIndex);
    const location = clean(tail.match(/<span\b[^>]*class=["'][^"']*\blocation\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    if (location === item.control) matchingUrls.add(new URL(href.replace(/&amp;/g, "&"), item.url).toString());
  }
  return { officialDescriptor: item.control, currentPostingCount: matchingUrls.size };
}

async function validatePeopleAdmin(item) {
  const { html } = await fetchText(item.url);
  const isRutgers = item.source.startsWith("Rutgers");
  const selectName = isRutgers ? "2201[]" : "query_organizational_tier_1_id[]";
  const campusOption = optionMap(selectHtml(html, selectName)).get(item.control);
  if (!campusOption) throw new Error(`${item.name}: campus control ${item.control} is absent`);
  if (!campusOption.selected) throw new Error(`${item.name}: campus control ${item.control} is not selected`);

  if (isRutgers) {
    const position = optionMap(selectHtml(html, "query_position_type_id[]")).get("6");
    const fullTime = optionMap(selectHtml(html, "2182[]")).get("3");
    if (!position?.selected || position.label !== "Faculty") throw new Error(`${item.name}: Rutgers faculty filter is not selected`);
    if (!fullTime?.selected || fullTime.label !== "Full Time") throw new Error(`${item.name}: Rutgers full-time filter is not selected`);
  }

  return { officialDescriptor: campusOption.label, currentPostingCount: postingCount(html) };
}

const validated = [];
for (const item of milestone.applied || []) {
  let result;
  if (item.controlType === "workday_location") result = await validateWorkday(item);
  else if (item.controlType === "pageup_location") result = await validatePageUp(item);
  else if (item.controlType === "peopleadmin_campus") result = await validatePeopleAdmin(item);
  else throw new Error(`${item.name}: unknown control type ${item.controlType}`);
  validated.push({
    name: item.name,
    source: item.source,
    controlType: item.controlType,
    control: item.control,
    ...result,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  validatedCount: validated.length,
  allControlsPresentAndSelected: validated.length === milestone.appliedCount,
  campusesWithCurrentPostings: validated.filter((item) => item.currentPostingCount > 0).length,
  currentPostingCount: validated.reduce((sum, item) => sum + item.currentPostingCount, 0),
  validated,
};
fs.writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Validated ${validated.length} exact campus controls (${report.campusesWithCurrentPostings} currently have matching postings).`);
