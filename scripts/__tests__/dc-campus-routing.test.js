import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const promotionSource = fs.readFileSync(
  new URL("../apply-promotion-candidates-to-server.js", import.meta.url),
  "utf8"
);

test("District of Columbia promotion candidates have a live scraper route", () => {
  assert.match(promotionSource, /DC:\s*"DC_CAMPUSES"/);
  assert.match(serverSource, /const DC_CAMPUSES = \[/);
  assert.match(serverSource, /\{ name: "DC", fn: \(\) => scrapeDcAll\(context\) \}/);
  assert.match(serverSource, /async function scrapeDcAll\(context\)/);
  assert.match(serverSource, /DC_CAMPUSES,[\s\S]*?applyCareerUrlOverridesInPlace/);
});
