import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const review = JSON.parse(
  fs.readFileSync(new URL("../../generated/promotion-candidates-four-year-next100-pass3.json", import.meta.url), "utf8")
);

test("third four-year pass promotes only reviewed official sources", () => {
  assert.equal(review.count, 15);
  assert.equal(review.rejectedCount, 2);
  for (const item of review.items) {
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`^\\s*\\{ campus: "${escaped}"`, "m"), item.name);
  }
  for (const item of review.rejected) {
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(source, new RegExp(`^\\s*\\{ campus: "${escaped}"`, "m"), item.name);
  }
});

test("Robert Morris excludes known non-academic instructor roles", () => {
  assert.match(source, /Robert Morris University[^\n]+excludeTitleFilter: "\\\\b\(\?:group fitness\|hockey program\)\\\\b"/);
  const pa = source.match(/async function scrapePaAll[\s\S]*?async function scrapeMiAll/);
  assert.ok(pa);
  assert.match(pa[0], /excludeTitleFilter[\s\S]*new RegExp\(excludeTitleFilter/);
});
