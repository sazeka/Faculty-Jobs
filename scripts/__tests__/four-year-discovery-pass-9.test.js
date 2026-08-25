import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const review = JSON.parse(fs.readFileSync(new URL("../../generated/promotion-candidates-four-year-next100-pass9.json", import.meta.url), "utf8"));

test("ninth four-year pass promotes 22 reviewed scoped sources", () => {
  assert.equal(review.count, 22);
  assert.equal(review.rejectedCount, 1);
  for (const item of review.items) {
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`^\\s*\\{ campus: "${escaped}"`, "m"), item.name);
  }
  assert.doesNotMatch(source, /^\s*\{ campus: "University of Hawaii at Hilo"/m);
});

test("corrected faculty and campus filters replace unsafe first candidates", () => {
  assert.match(source, /University of Louisiana at Monroe[^\n]+careers\/ulm/);
  assert.match(source, /Hamline University[^\n]+Faculty_Career_Site/);
  assert.match(source, /Tallahassee State College[^\n]+jobFamilyGroup=/);
  assert.match(source, /Massachusetts College of Liberal Arts[^\n]+static\/clients\/456MCM1/);
  assert.match(source, /University of Wisconsin-Green Bay[^\n]+Institution=5adf054562b610142325cf0d5f910000/);
});

test("new ninth-pass platform routes are wired", () => {
  const checks = [
    [/async function scrapeMaPrivate[\s\S]*?async function scrapeUscJobsAs/, /type === "paycom"/],
    [/async function scrapeOrAll[\s\S]*?async function scrapeWaAll/, /type === "icims"/],
    [/async function scrapeVtAll[\s\S]*?async function scrapeMnAll/, /type === "interviewexchange"/],
    [/async function scrapeLaAll[\s\S]*?async function scrapeArAll/, /type === "csod"/],
    [/async function scrapeOkAll[\s\S]*?async function scrapeMoAll/, /type === "csod"/],
    [/async function scrapeTnAll[\s\S]*?async function scrapeAkAll/, /type === "interfolio"/],
  ];
  for (const [sectionPattern, routePattern] of checks) {
    const section = source.match(sectionPattern);
    assert.ok(section);
    assert.match(section[0], routePattern);
  }
});
