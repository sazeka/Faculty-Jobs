import assert from "node:assert/strict";
import test from "node:test";

import {
  getPositionType,
  getPositionTypes,
  normalizeTenureTrack,
} from "../../web-vue/src/lib/jobClassification.js";

test("classifies spaced post-doctoral titles", () => {
  assert.equal(getPositionType("Post Doctoral Fellow"), "Postdoctoral");
  assert.equal(getPositionType("Post-Doctoral Researcher"), "Postdoctoral");
});

test("uses the Full Professor label for full and open-rank postings", () => {
  assert.equal(getPositionType("Professor of History"), "Full Professor");
  assert.deepEqual(
    getPositionTypes("Faculty - All Ranks - Assistant Professor / Associate Professor / Professor"),
    ["Assistant Professor", "Associate Professor", "Full Professor"]
  );
});

test("normalizes stored tenure strings and explicit title language", () => {
  assert.equal(normalizeTenureTrack("tenure-track"), true);
  assert.equal(normalizeTenureTrack("non-tenure-track"), false);
  assert.equal(normalizeTenureTrack("unknown", "Tenure Track Assistant Professor"), true);
  assert.equal(normalizeTenureTrack("unknown", "Assistant Professor of Biology"), null);
  assert.equal(normalizeTenureTrack(true, "Clinical Professor (Non-Tenured Track)"), false);
  assert.equal(normalizeTenureTrack(false, "Tenure-Track Assistant Professor"), true);
});
