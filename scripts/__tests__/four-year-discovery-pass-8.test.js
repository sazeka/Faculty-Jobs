import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const review = JSON.parse(fs.readFileSync(new URL("../../generated/promotion-candidates-four-year-next100-pass8.json", import.meta.url), "utf8"));
const laterReview = JSON.parse(fs.readFileSync(new URL("../../generated/second-public-discovery-batch-validation.json", import.meta.url), "utf8"));
const laterPromotions = new Set(laterReview.promoted.map((item) => item.name));

test("eighth four-year pass promotes only safely scoped sources", () => {
  assert.equal(review.count, 15);
  assert.equal(review.rejectedCount, 2);
  for (const item of review.items) {
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`^\\s*\\{ campus: "${escaped}"`, "m"), item.name);
  }
  for (const item of review.rejected) {
    if (laterPromotions.has(item.name)) continue;
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(source, new RegExp(`^\\s*\\{ campus: "${escaped}"`, "m"), item.name);
  }
});

test("shared boards remain faculty or institution scoped", () => {
  assert.match(source, /University of Colorado System Office[^\n]+organization=4300103016/);
  assert.match(source, /Maryland Institute College of Art[^\n]+myworkdayjobs\.com\/Faculty/);
  assert.match(source, /Southeast Missouri State University[^\n]+\/promotionaljobs/);
  assert.equal((source.match(/campus: "Lake-Sumter State College"/g) || []).length, 2);
});

test("new platform types have live state dispatch routes", () => {
  const checks = [
    [/async function scrapeCtPrivate[\s\S]*?async function scrapeCtAll/, /type === "adp"/],
    [/async function scrapeVaAll[\s\S]*?async function scrapeScAll/, /type === "interviewexchange"/],
    [/async function scrapeScAll[\s\S]*?async function scrapeDeAll/, /type === "csod"/],
    [/async function scrapeMnAll[\s\S]*?\/\* ============================== ND/, /type === "paycom"[\s\S]*type === "peopleadmin"/],
    [/async function scrapeMoAll[\s\S]*?async function scrapeKyAll/, /type === "schooljobs"/],
    [/async function scrapeKyAll[\s\S]*?export function extractMooreTech/, /type === "paycom"/]
  ];
  for (const [sectionPattern, routePattern] of checks) {
    const section = source.match(sectionPattern);
    assert.ok(section);
    assert.match(section[0], routePattern);
  }
});
