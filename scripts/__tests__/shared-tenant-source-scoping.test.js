// Regression coverage for the scrape-source config changes behind issues
// #152, #155, and #159: each fix replaces an unscoped shared-tenant source
// (which silently re-scraped and mislabeled every OTHER campus's postings
// too) with one scoped to that campus's own Workday facet id. These tests
// read server.js's own source text, the same pattern used by
// shared-workday-campus-facets.test.js, since the CAMPUSES arrays are not
// exported and scraping the live Workday tenants is out of scope for a unit
// test.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

function sourceEntry(campusName) {
  const escaped = JSON.stringify(campusName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = server.match(new RegExp(`\\{[^{}]*campus:\\s*${escaped}[^{}]*\\}`, "s"));
  return m ? m[0] : null;
}

test("Miami University's regional campuses are scoped to their own Workday locations facet (issue #155)", () => {
  const hamilton = sourceEntry("Miami University-Hamilton");
  const middletown = sourceEntry("Miami University-Middletown");
  const oxford = sourceEntry("Miami University-Oxford");
  assert.ok(hamilton, "Miami University-Hamilton source not found");
  assert.ok(middletown, "Miami University-Middletown source not found");
  assert.ok(oxford, "Miami University-Oxford source not found");

  assert.match(hamilton, /miamioh\.wd5\.myworkdayjobs\.com\/miamioh-faculty\?locations=c79d26910af9100520aac2b74d840000/);
  assert.match(middletown, /miamioh\.wd5\.myworkdayjobs\.com\/miamioh-faculty\?locations=c79d26910af9100520aa3ae7d3080000/);
  assert.match(oxford, /miamioh\.wd5\.myworkdayjobs\.com\/miamioh-faculty\?locations=c79d26910af9100520a8fb35e1440000/);

  // All three distinct facet ids -- no two regional sources reading the
  // exact same scoped URL (which would just reproduce the original bug).
  const facetIds = [hamilton, middletown, oxford].map((entry) => entry.match(/locations=([a-f0-9]+)/)[1]);
  assert.equal(new Set(facetIds).size, 3);
});

test("Saint Joseph's University's Philadelphia and Lancaster sources are scoped to distinct Workday locations facets (issue #155)", () => {
  const philadelphia = sourceEntry("Saint Joseph's University - Philadelphia");
  const lancaster = sourceEntry("Saint Joseph's University - Lancaster");
  assert.ok(philadelphia, "Saint Joseph's University - Philadelphia source not found");
  assert.ok(lancaster, "Saint Joseph's University - Lancaster source not found");

  assert.match(philadelphia, /sju\.wd1\.myworkdayjobs\.com\/sju\?locations=/);
  assert.match(lancaster, /sju\.wd1\.myworkdayjobs\.com\/sju\?locations=afc02508c75e100208166fcd76bb0000/);

  // Lancaster's single facet id must not appear among Philadelphia's facet ids.
  const lancasterFacet = lancaster.match(/locations=([a-f0-9]+)/)[1];
  const philadelphiaFacets = [...philadelphia.matchAll(/locations=([a-f0-9]+)/g)].map((m) => m[1]);
  assert.equal(philadelphiaFacets.includes(lancasterFacet), false);
});

test("University of Arkansas System Office is scoped to its own hiringCompany facet, distinct from Fayetteville/UAMS (issue #159)", () => {
  const systemOffice = sourceEntry("University of Arkansas System Office");
  assert.ok(systemOffice, "University of Arkansas System Office source not found");
  assert.match(systemOffice, /uasys\.wd5\.myworkdayjobs\.com\/UASYS\?hiringCompany=/);
  assert.doesNotMatch(systemOffice, /type:\s*"generic"/);
});

test("Minnesota State System dispatches through the description/bulletFields-aware scraper, not the plain workday one (issue #152)", () => {
  const entry = sourceEntry("Minnesota State System");
  assert.ok(entry, "Minnesota State System source not found");
  assert.match(entry, /type:\s*"minnstate-workday"/);

  // The dispatcher for MN sources must actually route that type to
  // scrapeMinnStateWorkdayAs, not silently fall through to the generic
  // scrapeWorkdayAs (which would re-introduce the city-guess bug).
  assert.match(
    server,
    /if \(type === "minnstate-workday"\) return await scrapeMinnStateWorkdayAs\(context, url, campus, "MN"\);/
  );
});
