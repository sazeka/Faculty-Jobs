import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const review = JSON.parse(
  fs.readFileSync(new URL("../../generated/promotion-candidates-four-year-next100-pass5.json", import.meta.url), "utf8")
);

test("fifth four-year pass promotes only reviewed institution-scoped sources", () => {
  assert.equal(review.count, 9);
  assert.equal(review.rejectedCount, 4);
  for (const item of review.items) {
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`^\\s*\\{ campus: "${escaped}"`, "m"), item.name);
  }
  for (const item of review.rejected) {
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Alexandria was correctly rejected in pass 5 when only the broad LSU
    // tenant was known. It was later promoted after the tenant exposed an
    // exact campus + Faculty + Full time combination; keep that exception
    // conditional on every newly validated scope control remaining present.
    if (item.name === "Louisiana State University-Alexandria") {
      const row = source.match(/^\s*\{ campus: "Louisiana State University-Alexandria"[^\n]+/m)?.[0] || "";
      assert.match(row, /type: "workday-required-facets"/);
      assert.match(row, /hiringCompany=/);
      assert.match(row, /workerSubType=/);
      assert.match(row, /timeType=/);
      continue;
    }
    // Pass 5 correctly rejected the broad Minnesota State Workday feed for
    // the administrative office. A later review found the System Office's
    // institution-exclusive PeopleAdmin applicant portal.
    if (item.name === "Minnesota State Colleges and Universities System Office") {
      const row = source.match(/^\s*\{ campus: "Minnesota State Colleges and Universities System Office"[^\n]+/m)?.[0] || "";
      assert.match(row, /type: "peopleadmin"/);
      assert.match(row, /mnsystem\.peopleadmin\.com/);
      continue;
    }
    // The earlier pass found only a stale document. The college now publishes
    // an official Human Resources open-positions page with current faculty
    // and adjunct sections.
    if (item.name === "Oglala Lakota College") {
      const row = source.match(/^\s*\{ campus: "Oglala Lakota College"[^\n]+/m)?.[0] || "";
      assert.match(row, /olc\.edu\/resources\/human-resources\/open-positions/);
      continue;
    }
    assert.doesNotMatch(source, new RegExp(`^\\s*\\{ campus: "${escaped}"`, "m"), item.name);
  }
});

test("new platform dispatch and false-positive filters are active", () => {
  assert.match(source.match(/async function scrapeInAll[\s\S]*?async function scrapeAdpCareerCenterAs/)[0], /type === "csod"/);
  assert.match(source.match(/async function scrapeLaAll[\s\S]*?async function scrapeArAll/)[0], /type === "schooljobs"/);
  assert.match(source, /Northwest Missouri State University[^\n]+excludeTitleFilter: "\\\\b\(\?:upward bound\|act prep\)\\\\b"/);
  assert.match(source, /Pasco-Hernando State College[^\n]+excludeTitleFilter: "\\\\b\(\?:office assistant\|faculty support\)\\\\b"/);
  assert.match(source.match(/async function scrapeMoAll[\s\S]*?async function scrapeKyAll/)[0], /new RegExp\(excludeTitleFilter/);
  assert.match(source.match(/async function scrapeFlAll[\s\S]*?\/\/ Generic Taleo scraper/)[0], /new RegExp\(excludeTitleFilter/);
});
