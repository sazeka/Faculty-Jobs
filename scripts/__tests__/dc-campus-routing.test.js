import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const promotionSource = fs.readFileSync(
  new URL("../apply-promotion-candidates-to-server.js", import.meta.url),
  "utf8"
);
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/dc-major-universities-validation.json", import.meta.url), "utf8")
);

test("District of Columbia promotion candidates have a live scraper route", () => {
  assert.match(promotionSource, /DC:\s*"DC_CAMPUSES"/);
  assert.match(serverSource, /const DC_CAMPUSES = \[/);
  assert.match(serverSource, /\{ name: "DC", fn: \(\) => scrapeDcAll\(context\) \}/);
  assert.match(serverSource, /async function scrapeDcAll\(context\)/);
  assert.match(serverSource, /DC_CAMPUSES,[\s\S]*?applyCareerUrlOverridesInPlace/);
});

test("major unresolved DC universities use official faculty hiring systems", () => {
  assert.match(serverSource, /American University", type: "workday", url: "https:\/\/american\.wd1\.myworkdayjobs\.com\/AU"/);
  assert.match(serverSource, /Gallaudet University", type: "workday", url: "https:\/\/gallaudet\.wd1\.myworkdayjobs\.com\/GUCareers"/);
  assert.match(serverSource, /George Washington University", type: "peopleadmin", url: "https:\/\/www\.gwu\.jobs\/postings\/search\?[^"\n]*query_position_type_id%5B%5D=4/);
  assert.match(serverSource, /Georgetown University", type: "interfolio", url: "https:\/\/apply\.interfolio\.com\/11780\/positions"/);
});

test("DC dispatcher supports each newly introduced platform", () => {
  const dispatcher = serverSource.match(/async function scrapeDcAll\(context\)[\s\S]*?async function scrapeRiAll/);
  assert.ok(dispatcher);
  assert.match(dispatcher[0], /type === "peopleadmin"/);
  assert.match(dispatcher[0], /type === "workday"/);
  assert.match(dispatcher[0], /type === "interfolio"/);
});

test("all four DC controls retain live validation evidence", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 79);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
  assert.equal(validation.results.find((row) => row.name === "Gallaudet University")?.rawBoardJobCount, 26);
});
