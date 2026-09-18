import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { matchesSchoolJobsCampusScope } from "../../server.js";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");

test("schooljobs campus scope requires every configured campus marker", () => {
  const hawaii = {
    location: "Hilo, HI",
    cardText: "Department: Hawai'i Community College - Liberal Arts Location: East Hawaii",
  };
  assert.equal(matchesSchoolJobsCampusScope(hawaii, null, "Hawai'i Community College"), true);
  assert.equal(matchesSchoolJobsCampusScope(hawaii, null, "Honolulu Community College"), false);

  const district = {
    location: "San Bernardino Valley College, CA",
    cardText: "Instructor in Biology",
  };
  assert.equal(matchesSchoolJobsCampusScope(district, "San Bernardino Valley College"), true);
  assert.equal(matchesSchoolJobsCampusScope(district, "Crafton Hills College"), false);
});

test("SBCCD locationFilter arrays also match a campus's own city (issue #133)", () => {
  const craftonConfig = ["Crafton Hills College", "Yucaipa, CA"];
  const sbvConfig = ["San Bernardino Valley College", "San Bernardino, CA"];

  // Real SBCCD board behavior: roughly a third of single-campus postings
  // render their location as just the campus's city, not the full college
  // name -- these were previously invisible to BOTH campus filters.
  assert.equal(matchesSchoolJobsCampusScope({ location: "Yucaipa, CA" }, craftonConfig), true);
  assert.equal(matchesSchoolJobsCampusScope({ location: "Yucaipa, CA" }, sbvConfig), false);
  assert.equal(matchesSchoolJobsCampusScope({ location: "San Bernardino, CA" }, sbvConfig), true);
  assert.equal(matchesSchoolJobsCampusScope({ location: "San Bernardino, CA" }, craftonConfig), false);

  // Genuinely dual-campus postings ("X and/or Y") are meant to keep matching
  // both filters -- that reflects the source's own stated ambiguity, not a
  // bug (see issue #133 discussion).
  const andOr = { location: "San Bernardino Valley College and/or Crafton Hills College, CA" };
  assert.equal(matchesSchoolJobsCampusScope(andOr, craftonConfig), true);
  assert.equal(matchesSchoolJobsCampusScope(andOr, sbvConfig), true);

  // A district-office administrative posting's address happens to end in
  // "San Bernardino, CA" too, but it isn't faculty-titled so looksFacultyish
  // drops it upstream before campus scoping matters -- this only documents
  // that the scope check itself doesn't try to exclude it.
  const districtOffice = { location: "District Office 550 E. Hospitality Lane Suite 200 San Bernardino, CA" };
  assert.equal(matchesSchoolJobsCampusScope(districtOffice, sbvConfig), true);
});

test("shared two-year boards keep durable campus facets in configuration", () => {
  assert.match(serverSource, /Riverside City College[\s\S]*?query_organizational_tier_1_id%5B%5D=756/);
  assert.match(serverSource, /Norco College[\s\S]*?query_organizational_tier_1_id%5B%5D=755/);
  assert.match(serverSource, /Ohio State University Agricultural Technical Institute[\s\S]*?locations=819c1ab743bd01b092af970065019db6/);
  assert.match(serverSource, /Rowan College of South Jersey-Cumberland Campus[\s\S]*?rcsjedu\/promotionaljobs/);
});
