import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");

const LACCD = [
  ["Los Angeles City College", "Los Angeles City College"],
  ["Los Angeles Harbor College", "Los Angeles Harbor College"],
  ["Los Angeles Pierce College", "Pierce College"],
  ["Los Angeles Southwest College", "Los Angeles Southwest College"],
  ["Los Angeles Trade Technical College", "Los Angeles Trade -Technical College"],
];

test("remaining LACCD colleges use exact campus and full-time faculty controls", () => {
  for (const [campus, filter] of LACCD) {
    const campusPattern = campus.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filterPattern = filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`${campusPattern}[\\s\\S]{0,260}site=6&c=laccd[\\s\\S]{0,180}locationFilter: "${filterPattern}"[\\s\\S]{0,120}employmentFilter: "Faculty - Full-Time"`));
  }
});

test("scoped legacy CSOD searches fail closed when a named filter disappears", () => {
  const scraper = source.match(/async function scrapeNjCsod[\s\S]*?export async function scrapeCsodAs/);
  assert.ok(scraper);
  assert.match(scraper[0], /Missing scoped CSOD filter buttons/);
  assert.match(scraper[0], /Missing CSOD filter option/);
  assert.match(scraper[0], /!hasJobAnchorsAlready && !scopedSearchApplied/);
  assert.match(source, /const isolatedContext = needsIsolation \? await context\.browser\(\)\.newContext\(\) : null/);
});

test("San Bernardino is represented only as its institution-level district tenant", () => {
  assert.match(source, /San Bernardino Community College District[\s\S]{0,180}type: "schooljobs"[\s\S]{0,180}schooljobs\.com\/careers\/sbccd[\s\S]{0,120}contentFilter: "Academic Full-Time"/);
});

test("Little Big Horn is not promoted from a single adjunct posting packet", () => {
  assert.doesNotMatch(source, /Little Big Horn College[\s\S]{0,240}HVAC_Adjunt_Intstructor_Packet/);
});
