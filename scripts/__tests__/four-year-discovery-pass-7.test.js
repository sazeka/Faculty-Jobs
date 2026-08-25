import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const review = JSON.parse(fs.readFileSync(new URL("../../generated/promotion-candidates-four-year-next100-pass7.json", import.meta.url), "utf8"));

test("seventh four-year pass promotes only reviewed institution-scoped sources", () => {
  assert.equal(review.count, 5);
  assert.equal(review.rejectedCount, 1);
  for (const item of review.items) {
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`^\\s*\\{ campus: "${escaped}"`, "m"), item.name);
  }
  assert.doesNotMatch(source, /^\s*\{ campus: "Massachusetts School of Law"/m);
});

test("Indiana Northwest remains campus and faculty scoped", () => {
  const line = source.split("\n").find((value) => value.includes('campus: "Indiana University-Northwest"'));
  assert.ok(line);
  assert.match(line, /query_organizational_tier_1_id=441/);
  assert.match(line, /query_position_type_id=/);
});
