#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { scrapeHawaiiSystemAs } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MILESTONE_PATH = path.join(ROOT, "generated", "hawaii-system-campus-splitter-milestone.json");
const OUT_PATH = path.join(ROOT, "generated", "hawaii-system-campus-splitter-validation.json");
const milestone = JSON.parse(fs.readFileSync(MILESTONE_PATH, "utf8"));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const validated = [];
let focusedScrape = null;
try {
  const page = await context.newPage();
  const observedByQuery = [];
  for (const item of milestone.applied) {
    const url = new URL(milestone.boardUrl);
    // NEOGOV's keyword parser normalizes the ASCII campus name more reliably
    // than a query containing Hawai'i apostrophes; attribution still validates
    // against the exact official data-department-name below.
    url.searchParams.set("keywords", item.name);
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('a.item-details-link[data-department-name]', { state: "attached", timeout: 20_000 });
    const departments = await page.evaluate(() => [...new Set(
      [...document.querySelectorAll('a.item-details-link[data-department-name]')]
        .map((anchor) => String(anchor.getAttribute("data-department-name") || "").trim())
        .filter(Boolean),
    )]);
    observedByQuery.push({ query: item.name, departments });
  }

  const departments = [...new Set(observedByQuery.flatMap((item) => item.departments))];
  for (const item of milestone.applied) {
    const normalize = (value) => String(value || "").replace(/[ʻ’]/g, "'").replace(/^\(EVA\)\s*/i, "").toLowerCase();
    const expected = normalize(item.control);
    const matched = departments.filter((department) => {
      const value = normalize(department);
      return value === expected || value.startsWith(`${expected} -`);
    });
    if (!matched.length) throw new Error(`${item.name}: exact department marker ${item.control} is absent`);
    validated.push({ name: item.name, control: item.control, matchedDepartments: matched });
  }

  const jobs = await scrapeHawaiiSystemAs(context, milestone.boardUrl, "HI");
  const counts = Object.fromEntries(
    [...new Set(jobs.map((job) => job.college))]
      .sort()
      .map((name) => [name, jobs.filter((job) => job.college === name).length]),
  );
  focusedScrape = { currentFacultyPostingCount: jobs.length, campusCounts: counts };
} finally {
  await context.close();
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  validatedCount: validated.length,
  allControlsPresent: validated.length === milestone.appliedCount,
  focusedScrape,
  validated,
};
fs.writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Validated ${validated.length} University of Hawai'i department controls.`);
