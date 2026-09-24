import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;

test("benchmark institutions use their complete academic listing sources", () => {
  const stanford = overrides.find((row) => row.name === "Stanford University");
  assert.equal(stanford?.platform_type, "pageup");
  assert.equal(stanford?.career_url, "https://facultypositions.stanford.edu/en-us/listing/");

  assert.match(server, /campus: "Williams College",[\s\S]{0,160}employment\.williams\.edu\/faculty-positions\//);
  assert.match(server, /campus: "Princeton University", type: "interfolio-inst", url: "https:\/\/apply\.interfolio\.com\/14427\/positions"/);
  assert.match(server, /campus: "Cornell University",[\s\S]{0,160}academicjobsonline\.org\/ajo\/Cornell\/Economics/);
  assert.match(server, /campus: "University of Chicago",[\s\S]{0,120}type: "uchicago-academic"/);
  assert.match(server, /campus: "University of Texas at Austin",[\s\S]{0,120}type: "ut-austin-faculty"/);
  assert.match(server, /campus: "Massachusetts Institute of Technology",[\s\S]{0,160}economics\.mit\.edu\/juniorfaculty/);
  assert.match(server, /campus: "Brown University",[\s\S]{0,160}type: "brown-economics-faculty"[\s\S]{0,160}economics\.brown\.edu\/about\/faculty-positions/);
  assert.match(server, /campus: "Northwestern University",[\s\S]{0,160}kellogg\.northwestern\.edu\/academics-research\/faculty-recruiting/);
  assert.match(server, /campus: "University of Utah",[\s\S]{0,360}595%5B%5D=2/);

  const marist = overrides.find((row) => row.name === "Marist College");
  assert.equal(marist?.platform_type, "pageup");
  assert.match(marist?.career_url || "", /careers\.marist\.edu\/cw\/en-us\/filter/);
  assert.match(server, /campus: "Marist College",[\s\S]{0,120}type: "pageup"/);
});

test("specialized Chicago and UT Austin routes are dispatched", () => {
  assert.match(server, /type === "uchicago-academic"[\s\S]{0,100}scrapeUChicagoAcademicAs/);
  assert.match(server, /type === "ut-austin-faculty"[\s\S]{0,100}scrapeUtAustinFacultyAs/);
  assert.match(server, /type === "brown-economics-faculty"[\s\S]{0,100}scrapeBrownEconomicsFacultyAs/);
});

test("Brown Economics source binds each heading to its following application link", () => {
  assert.match(server, /export async function scrapeBrownEconomicsFacultyAs/);
  assert.match(server, /while \(sibling && sibling\.tagName !== "H3"\)/);
  assert.match(server, /a\[href\*='econjobmarket\.org\/positions\/'\]/);
});
