#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { scrapeMaricopaFacultyAs, splitMaricopaBusinessUnit } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MILESTONE_PATH = path.join(ROOT, "generated", "maricopa-campus-controls-milestone.json");
const OUT_PATH = path.join(ROOT, "generated", "maricopa-campus-controls-validation.json");
const milestone = JSON.parse(fs.readFileSync(MILESTONE_PATH, "utf8"));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
  viewport: { width: 1280, height: 800 },
  locale: "en-US",
});

let options = [];
let observedRows = [];
let jobs = [];
try {
  const page = await context.newPage();
  const response = await page.goto(milestone.boardUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (response?.status() !== 200) throw new Error(`Official board returned HTTP ${response?.status()}`);
  await page.waitForSelector("#searchUnit", { state: "attached", timeout: 20_000 });
  options = await page.locator("#searchUnit option").evaluateAll((nodes) =>
    nodes.map((node) => String(node.value || "").trim()).filter(Boolean),
  );
  observedRows = await page.locator(".job-listing").evaluateAll((cards) => cards.map((card) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const fields = {};
    for (const field of card.querySelectorAll(".job-details .field")) {
      const labelNode = field.querySelector(".job-field-label");
      const label = clean(labelNode?.textContent).replace(/:$/, "").toLowerCase();
      if (label) fields[label] = clean(labelNode?.nextElementSibling?.textContent);
    }
    return {
      title: clean(card.querySelector(".job-title")?.textContent),
      businessUnit: fields["business unit"] || null,
      positionType: fields.type || null,
    };
  }));
  await page.close();

  jobs = await scrapeMaricopaFacultyAs(context, milestone.boardUrl, "AZ");
} finally {
  await context.close();
  await browser.close();
}

const expected = milestone.applied.map((item) => item.businessUnit).sort();
const actual = [...options].sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`Business Unit controls changed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const eligibleRows = observedRows.filter((row) => /^full-time faculty$/i.test(row.positionType || ""));
const unassigned = eligibleRows.filter((row) => !splitMaricopaBusinessUnit(row));
if (unassigned.length) throw new Error(`Unassigned current faculty rows: ${JSON.stringify(unassigned)}`);
if (!jobs.length) throw new Error("Focused Maricopa scrape returned no current faculty jobs");

const campusCounts = Object.fromEntries(
  milestone.applied.map((item) => [item.name, jobs.filter((job) => job.college === item.name).length]),
);
const report = {
  generatedAt: new Date().toISOString(),
  boardStatus: 200,
  expectedControlCount: expected.length,
  validatedControlCount: actual.length,
  allControlsPresent: JSON.stringify(actual) === JSON.stringify(expected),
  currentFacultyPostingCount: jobs.length,
  unassignedCurrentFacultyCount: unassigned.length,
  observedBusinessUnits: [...new Set(eligibleRows.map((row) => row.businessUnit))].sort(),
  campusCounts,
  sample: jobs.slice(0, 10).map((job) => ({
    title: job.title,
    college: job.college,
    location: job.location,
    department: job.department,
    url: job.url,
  })),
};
fs.writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Validated ${actual.length} Maricopa controls and ${jobs.length} current faculty postings.`);
