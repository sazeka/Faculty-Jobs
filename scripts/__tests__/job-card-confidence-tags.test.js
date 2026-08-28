import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const jobCard = fs.readFileSync(new URL("../../web-vue/src/components/JobCard.vue", import.meta.url), "utf8");

test("job cards hide confidence and missing-metadata tags", () => {
  assert.doesNotMatch(jobCard, /confidenceBadges|fa-tag-warning/);
  assert.match(jobCard, /New to Atlas/);
  assert.match(jobCard, /trackLabel\(props\.job\)/);
  assert.match(jobCard, /props\.job\.discipline/);
});
