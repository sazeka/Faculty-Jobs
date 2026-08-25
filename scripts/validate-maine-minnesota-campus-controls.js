#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MILESTONE_PATH = path.join(ROOT, "generated", "maine-minnesota-campus-control-milestone.json");
const OUT_PATH = path.join(ROOT, "generated", "maine-minnesota-campus-control-validation.json");
const milestone = JSON.parse(fs.readFileSync(MILESTONE_PATH, "utf8"));
const oracleItems = milestone.applied.filter((item) => item.controlType === "oracle_organization");
const minnesotaItems = milestone.applied.filter((item) => item.controlType === "peoplesoft_location");
const ORACLE_FACETS = "LOCATIONS%3BWORK_LOCATIONS%3BWORKPLACE_TYPES%3BTITLES%3BCATEGORIES%3BORGANIZATIONS%3BPOSTING_DATES%3BFLEX_FIELDS";

async function oracleRequest(url, extraFinder = "", limit = 25) {
  const parsed = new URL(url);
  const siteNumber = parsed.pathname.match(/\/sites\/([^/]+)/)?.[1];
  if (!siteNumber) throw new Error(`Cannot identify Oracle site in ${url}`);
  const finder = `findReqs;siteNumber=${siteNumber},facetsList=${ORACLE_FACETS},limit=${limit},offset=0,sortBy=POSTING_DATES_DESC${extraFinder}`;
  const endpoint = `${parsed.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&finder=${finder}`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
  const payload = await response.json();
  const item = payload?.items?.[0];
  if (!item) throw new Error(`${endpoint} returned no Oracle search item`);
  return item;
}

async function validateMaine() {
  const unfiltered = await oracleRequest(oracleItems[0].url, "", 1);
  const organizations = new Map((unfiltered.organizationsFacet || []).map((item) => [String(item.Id), item]));
  const facultyCategory = (unfiltered.categoriesFacet || []).find((item) => String(item.Id) === String(milestone.oracleFacultyCategory));
  if (facultyCategory?.Name !== "Faculty") {
    throw new Error(`Maine Faculty category ${milestone.oracleFacultyCategory} is absent or renamed`);
  }

  const validated = [];
  for (const item of oracleItems) {
    const official = organizations.get(String(item.control));
    if (!official) throw new Error(`${item.name}: organization ${item.control} is absent`);
    if (official.Name !== item.descriptor) {
      throw new Error(`${item.name}: expected ${item.descriptor}, found ${official.Name}`);
    }
    const filtered = await oracleRequest(
      item.url,
      `,selectedOrganizationsFacet=${item.control},selectedCategoriesFacet=${milestone.oracleFacultyCategory}`,
      25,
    );
    if (String(filtered.SelectedOrganizationsFacet) !== String(item.control)) {
      throw new Error(`${item.name}: Oracle did not preserve organization ${item.control}`);
    }
    if (String(filtered.SelectedCategoriesFacet) !== String(milestone.oracleFacultyCategory)) {
      throw new Error(`${item.name}: Oracle did not preserve the Faculty category`);
    }
    validated.push({
      name: item.name,
      control: item.control,
      officialDescriptor: official.Name,
      officialUnfilteredPostingCount: Number(official.TotalCount || 0),
      currentFacultyPostingCount: Number(filtered.TotalJobsCount || 0),
      titles: (filtered.requisitionList || []).map((row) => String(row.Title || "").trim()).filter(Boolean),
    });
  }
  return { facultyCategory: { id: String(facultyCategory.Id), descriptor: facultyCategory.Name }, validated };
}

async function validateMinnesota() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(minnesotaItems[0].url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('span[id^="SCH_JOB_TITLE$"]', { timeout: 20_000 });

    for (let index = 0; index < 5; index++) {
      const clicked = await page.evaluate(() => {
        const button = document.querySelector("div.ps_box-more");
        if (!button) return false;
        button.click();
        return true;
      });
      if (!clicked) break;
      await page.waitForTimeout(1_200);
    }

    const observed = await page.evaluate(() => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const campusLinks = [...document.querySelectorAll("a[href]")]
        .map((anchor) => ({ label: clean(anchor.textContent), href: anchor.href }))
        .filter((item) => /^(Crookston|Duluth|Morris|Rochester)$/.test(item.label));
      const jobLocations = [...document.querySelectorAll('span[id^="LOCATION$"]')]
        .map((element) => clean(element.textContent))
        .filter(Boolean);
      return { campusLinks, jobLocations };
    });

    const linkByLabel = new Map(observed.campusLinks.map((item) => [item.label, item.href]));
    const validated = minnesotaItems.map((item) => {
      const officialCampusUrl = linkByLabel.get(item.control);
      if (!officialCampusUrl) throw new Error(`${item.name}: official ${item.control} campus link is absent`);
      return {
        name: item.name,
        control: item.control,
        officialDescriptor: item.control,
        officialCampusUrl,
        currentRowsObserved: observed.jobLocations.filter((location) => location === item.control).length,
      };
    });
    return { inspectedJobRows: observed.jobLocations.length, validated };
  } finally {
    await browser.close();
  }
}

const maine = await validateMaine();
const minnesota = await validateMinnesota();
const validatedCount = maine.validated.length + minnesota.validated.length;
const report = {
  generatedAt: new Date().toISOString(),
  validatedCount,
  allControlsPresentAndSelected: validatedCount === milestone.appliedCount,
  maine,
  minnesota,
};
fs.writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Validated ${validatedCount} Maine and Minnesota campus controls.`);
