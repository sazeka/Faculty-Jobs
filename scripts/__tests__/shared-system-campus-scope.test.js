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

test("shared two-year boards keep durable campus facets in configuration", () => {
  assert.match(serverSource, /Riverside City College[\s\S]*?query_organizational_tier_1_id%5B%5D=756/);
  assert.match(serverSource, /Norco College[\s\S]*?query_organizational_tier_1_id%5B%5D=755/);
  assert.match(serverSource, /Ohio State University Agricultural Technical Institute[\s\S]*?locations=819c1ab743bd01b092af970065019db6/);
  assert.match(serverSource, /Rowan College of South Jersey-Cumberland Campus[\s\S]*?rcsjedu\/promotionaljobs/);
});
