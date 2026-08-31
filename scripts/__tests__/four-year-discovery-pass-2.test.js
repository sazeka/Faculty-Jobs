import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const review = JSON.parse(
  fs.readFileSync(new URL("../../generated/promotion-candidates-four-year-next100-pass2.json", import.meta.url), "utf8")
);
const laterPrivateReview = JSON.parse(
  fs.readFileSync(new URL("../../generated/second-private-discovery-batch-validation.json", import.meta.url), "utf8")
);
const reviewed99 = JSON.parse(
  fs.readFileSync(new URL("../../generated/reviewed-99-closeout-report.json", import.meta.url), "utf8")
);

test("second four-year pass promotes only reviewed official sources", () => {
  assert.equal(review.count, 5);
  assert.equal(review.rejectedCount, 2);
  for (const item of review.items) {
    const escapedName = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`^\\s*\\{ campus: "${escapedName}"`, "m"), item.name);
  }
  const laterPromotions = new Set([
    ...laterPrivateReview.promoted.map((item) => item.name),
    ...reviewed99.verified.map((item) => item.name),
  ]);
  for (const item of review.rejected.filter((item) => !laterPromotions.has(item.name))) {
    const escapedName = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(source, new RegExp(`^\\s*\\{ campus: "${escapedName}"`, "m"), item.name);
  }
});

test("new platform types are reachable from their state dispatchers", () => {
  const ca = source.match(/async function scrapeCaPrivate[\s\S]*?async function scrapeNjAll/);
  const pa = source.match(/async function scrapePaAll[\s\S]*?async function scrapeMiAll/);
  assert.ok(ca);
  assert.ok(pa);
  assert.match(ca[0], /type === "icims"[\s\S]*scrapeIcimsAs/);
  assert.match(pa[0], /type === "interviewexchange"[\s\S]*scrapeInterviewExchangeAs/);
});
