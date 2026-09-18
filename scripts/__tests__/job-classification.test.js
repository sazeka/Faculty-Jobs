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

test("modified professor titles resolve to their modifier, not Full Professor (issue #117)", () => {
  assert.equal(getPositionType("Adjunct Professor of Art & Art History (Studio Art)"), "Adjunct");
  assert.equal(
    getPositionType("Clinical Professor - Director of Environmental Law & Policy Clinic"),
    "Clinical Faculty"
  );
  assert.equal(getPositionType("Research Professor"), "Research Faculty");
  assert.equal(getPositionType("Visiting Professor"), "Visiting Faculty");
  assert.equal(getPositionType("Teaching Professor of Mathematics"), "Teaching Faculty");
  assert.equal(getPositionType("Assistant, Associate, or Full Professor of Practice – Management"), "Teaching Faculty");
  assert.deepEqual(getPositionTypes("Adjunct Professor of History"), ["Adjunct"]);
});

test("unmodified professor titles and non-professor titles keep their existing precedence", () => {
  assert.equal(getPositionType("Professor of History"), "Full Professor");
  assert.equal(getPositionType("Adjunct Instructor of Biology"), "Instructor");
  assert.equal(getPositionType("Visiting Lecturer in English"), "Lecturer");
  assert.equal(getPositionType("Postdoctoral Research Fellow"), "Postdoctoral");
});

test("normalizes stored tenure strings and explicit title language", () => {
  assert.equal(normalizeTenureTrack("tenure-track"), true);
  assert.equal(normalizeTenureTrack("non-tenure-track"), false);
  assert.equal(normalizeTenureTrack("unknown", "Tenure Track Assistant Professor"), true);
  assert.equal(normalizeTenureTrack("unknown", "Assistant Professor of Biology"), null);
  assert.equal(normalizeTenureTrack(true, "Clinical Professor (Non-Tenured Track)"), false);
  assert.equal(normalizeTenureTrack(false, "Tenure-Track Assistant Professor"), true);
});

// Issue #145: eleven live University of Washington "WOT" (without tenure)
// appointments were stored as tenureTrack: true. UW's own title convention
// uses bare "WOT", parenthesized "(WOT)", and spelled-out "without tenure" --
// all three must be recognized as explicit non-tenure evidence and must win
// over a contradictory stored `true`.
test("recognizes University of Washington WOT appointments as non-tenure regardless of stored value (issue #145)", () => {
  assert.equal(
    normalizeTenureTrack(true, "Assistant Professor WOT – Department of Laboratory Medicine and Pathology", "University of Washington"),
    false
  );
  assert.equal(
    normalizeTenureTrack(true, "Assistant or Associate Professor (WOT) in Radiology, Emergency and Trauma", "University of Washington"),
    false
  );
  assert.equal(
    normalizeTenureTrack(
      true,
      "Assistant, Associate or Full Professor without tenure - UW Pediatrics - Gastroenterology & Hepatology",
      "University of Washington"
    ),
    false
  );
  // "without tenure" is unambiguous regardless of institution.
  assert.equal(normalizeTenureTrack(true, "Lecturer without tenure", "Some Other University"), false);
  // Bare "WOT" is scoped to UW -- an unrelated "WOT" acronym elsewhere must
  // not be misread as tenure evidence.
  assert.equal(normalizeTenureTrack(true, "Assistant Professor WOT", "Some Other University"), true);
  // A plain UW title with no WOT/without-tenure language is unaffected.
  assert.equal(normalizeTenureTrack(true, "Assistant Professor of Biology", "University of Washington"), true);
});
