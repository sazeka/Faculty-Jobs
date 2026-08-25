import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const review = JSON.parse(
  fs.readFileSync(new URL("../../generated/promotion-candidates-four-year-next100-pass4.json", import.meta.url), "utf8")
);

test("fourth four-year pass promotes the reviewed Marion ADP board", () => {
  assert.equal(review.count, 1);
  assert.equal(review.items[0].validatedJobCount, 14);
  assert.match(source, /^\s*\{ campus: "Marion Technical College", type: "adp", url: "https:\/\/workforcenow\.adp\.com\/mascsr\/default\/mdf\/recruitment\/recruitment\.html\?cid=6305797d-3336-45ce-9507-c61ca821c1bd&ccId=19000101_000001&lang=en_US" \},$/m);
});
