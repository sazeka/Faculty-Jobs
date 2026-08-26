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
const remainingValidation = JSON.parse(
  fs.readFileSync(new URL("../../generated/dc-remaining-major-universities-validation.json", import.meta.url), "utf8")
);
const specializedValidation = JSON.parse(
  fs.readFileSync(new URL("../../generated/dc-specialized-institutions-validation.json", import.meta.url), "utf8")
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
  assert.match(serverSource, /Howard University", type: "workday", url: "https:\/\/howard\.wd1\.myworkdayjobs\.com\/HU"/);
  assert.match(serverSource, /The Catholic University of America", type: "generic", url: "https:\/\/provost\.catholic\.edu\/faculty-positions\/index\.html"/);
  assert.match(serverSource, /Trinity Washington University", type: "generic", url: "https:\/\/www2\.trinitydc\.edu\/hr\/employment-openings\/"/);
  assert.match(serverSource, /University of the District of Columbia", type: "generic", url: "https:\/\/udc\.applicantstack\.com\/x\/openings"/);
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

test("remaining major DC controls retain live validation and false-positive evidence", () => {
  assert.equal(remainingValidation.newlyCoveredCount, 4);
  assert.equal(remainingValidation.projectedMissing, remainingValidation.baselineMissing - 4);
  assert.equal(remainingValidation.facultyJobCount, 120);
  assert.equal(remainingValidation.results.length, 4);
  for (const result of remainingValidation.results) assert.equal(result.healthySource, true);
  assert.equal(remainingValidation.results.find((row) => row.name === "Howard University")?.facultyJobCount, 17);
  assert.equal(remainingValidation.results.find((row) => row.name === "The Catholic University of America")?.facultyJobCount, 9);
  assert.equal(remainingValidation.results.find((row) => row.name === "University of the District of Columbia")?.rawBoardJobCount, 116);
  assert.match(serverSource, /Howard University"[^\n]*excludeTitleFilter: "\^\(\?:Chief Financial Officer\\\\b\|Faculty Services Coordinator\$\)"/);
  assert.match(serverSource, /The Catholic University of America"[^\n]*excludeTitleFilter: "\^Faculty \(\?:Handbook\|Newsletters and Updates\|Positions Overview\)\$"/);
});

test("specialized DC institutions use employee sources and reject student job boards", () => {
  const dcConfig = serverSource.match(/const DC_CAMPUSES = \[[\s\S]*?\n\];/);
  assert.ok(dcConfig);
  assert.match(dcConfig[0], /NewU University", type: "generic", url: "https:\/\/newu\.university\/careers\/"/);
  assert.match(dcConfig[0], /Pontifical Faculty of the Immaculate Conception at the Dominican House of Studies", type: "generic", url: "https:\/\/dhs\.edu\/careers\/"/);
  assert.doesNotMatch(dcConfig[0], /Institute of World Politics/);
  assert.doesNotMatch(dcConfig[0], /Pontifical John Paul II Institute/);
  assert.equal(specializedValidation.newlyCoveredCount, 2);
  assert.equal(specializedValidation.projectedMissing, specializedValidation.baselineMissing - 2);
  assert.equal(specializedValidation.facultyJobCount, 0);
  assert.equal(specializedValidation.results.length, 2);
  for (const result of specializedValidation.results) assert.equal(result.healthySource, true);
  assert.equal(specializedValidation.reviewedUnresolved.length, 2);
});
