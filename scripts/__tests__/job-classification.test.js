import assert from "node:assert/strict";
import test from "node:test";

import {
  getPositionType,
  getPositionTypes,
  getPositionFilterTypes,
  normalizeTenureTrack,
} from "../../web-vue/src/lib/jobClassification.js";

test("classifies spaced post-doctoral titles", () => {
  assert.equal(getPositionType("Post Doctoral Fellow"), "Postdoctoral");
  assert.equal(getPositionType("Post-Doctoral Researcher"), "Postdoctoral");
});

test("does not assume an unranked professor title is a full professor", () => {
  assert.equal(getPositionType("Professor of History"), "Professor");
  assert.equal(getPositionType("Full Professor of History"), "Full Professor");
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
  assert.equal(getPositionType("Professor of History"), "Professor");
  assert.equal(getPositionType("Adjunct Instructor of Biology"), "Instructor");
  assert.equal(getPositionType("Visiting Lecturer in English"), "Lecturer");
  assert.equal(getPositionType("Postdoctoral Research Fellow"), "Postdoctoral");
});

test("position filters include broad families alongside explicit ranks and appointment types", () => {
  assert.deepEqual(getPositionFilterTypes("Professor of History"), ["Professor"]);
  assert.deepEqual(getPositionFilterTypes("Clinical Assistant Professor of Nursing"), ["Assistant Professor", "Professor", "Clinical Faculty"]);
  assert.deepEqual(getPositionFilterTypes("Associate Research Professor"), ["Associate Professor", "Professor", "Research Faculty"]);
  assert.deepEqual(getPositionFilterTypes("Clinical Track Assistant Professor"), ["Assistant Professor", "Professor", "Clinical Faculty"]);
  assert.deepEqual(getPositionFilterTypes("Clinical Assistant/Associate Professor"), ["Assistant Professor", "Associate Professor", "Professor", "Clinical Faculty"]);
  assert.deepEqual(getPositionFilterTypes("Research Assistant/Associate Professor"), ["Assistant Professor", "Associate Professor", "Professor", "Research Faculty"]);
  assert.deepEqual(getPositionFilterTypes("Professor (Research)"), ["Research Faculty", "Professor"]);
  assert.deepEqual(getPositionFilterTypes("Adjunct Lecturer in English"), ["Lecturer", "Adjunct"]);
  assert.deepEqual(getPositionFilterTypes("Professor of Clinical Research"), ["Professor"]);
  assert.deepEqual(getPositionFilterTypes("Research Assistant Professor", "Custom Rank"), ["Custom Rank", "Professor", "Research Faculty"]);
});

test("benchmark cases distinguish appointment types from subject areas and postdoctoral research", () => {
  assert.deepEqual(getPositionFilterTypes("Postdoctoral Research Scientist"), ["Postdoctoral"]);
  assert.deepEqual(getPositionFilterTypes("Professor of Clinical Research"), ["Professor"]);
  assert.deepEqual(getPositionFilterTypes("Adjunct Faculty - Clinical PsyD"), ["Adjunct"]);
  assert.deepEqual(getPositionFilterTypes("Assistant Professor/Research Scientist"), ["Assistant Professor", "Professor"]);
  assert.deepEqual(getPositionFilterTypes("Assistant Professor of Clinical Practice"), ["Assistant Professor", "Professor", "Clinical Faculty"]);
  assert.deepEqual(getPositionFilterTypes("Research Asst Professor"), ["Assistant Professor", "Professor", "Research Faculty"]);
  assert.deepEqual(getPositionFilterTypes("Instructional Faculty"), ["Teaching Faculty"]);
});

test("benchmark cases keep rank words tied to the professor appointment", () => {
  assert.deepEqual(getPositionFilterTypes("Clinical Associate Professor & Assistant Dean"), ["Associate Professor", "Professor", "Clinical Faculty"]);
  assert.deepEqual(getPositionFilterTypes("Open Rank: Associate/Professor"), ["Associate Professor", "Professor"]);
  assert.deepEqual(getPositionFilterTypes("Asst./Assoc. Professor"), ["Assistant Professor", "Associate Professor", "Professor"]);
  assert.deepEqual(getPositionFilterTypes("Full-Time Professor of Practice"), ["Teaching Faculty", "Professor"]);
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
