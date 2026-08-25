import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const review = JSON.parse(fs.readFileSync(new URL("../../generated/promotion-candidates-four-year-next100-pass6.json", import.meta.url), "utf8"));
const sharedCampusMilestone = JSON.parse(fs.readFileSync(new URL("../../generated/shared-system-campus-control-milestone.json", import.meta.url), "utf8"));

test("sixth four-year pass promotes only institution-scoped official sources", () => {
  assert.equal(review.count, 10);
  assert.equal(review.rejectedCount, 2);
  for (const item of review.items) {
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`^\\s*\\{ campus: "${escaped}"`, "m"), item.name);
  }
  const supersededByExactCampusControl = new Set(sharedCampusMilestone.applied.map((item) => item.name));
  for (const item of review.rejected) {
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (supersededByExactCampusControl.has(item.name)) {
      assert.match(source, new RegExp(`^\\s*\\{ campus: "${escaped}"`, "m"), `${item.name} now has exact-campus evidence`);
    } else {
      assert.doesNotMatch(source, new RegExp(`^\\s*\\{ campus: "${escaped}"`, "m"), item.name);
    }
  }
});

test("new Tennessee and Virginia platform routes are reachable", () => {
  const va = source.match(/async function scrapeVaAll[\s\S]*?async function scrapeScAll/);
  const tn = source.match(/async function scrapeTnAll[\s\S]*?async function scrapeAkAll/);
  assert.ok(va);
  assert.ok(tn);
  assert.match(va[0], /type === "interfolio"/);
  assert.match(tn[0], /type === "schooljobs"/);
});
