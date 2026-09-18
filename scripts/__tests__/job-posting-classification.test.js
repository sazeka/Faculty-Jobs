import assert from "node:assert/strict";
import test from "node:test";

import {
  derivePositionTypes,
  derivePrimaryPositionType,
  deriveTenureTrack,
  deriveEmploymentType,
} from "../lib/job-posting-classification.js";
import { getPositionTypes, normalizeTenureTrack } from "../../web-vue/src/lib/jobClassification.js";

// Issue #136: generate-job-pages.js used to read job.positionType/job.tenureTrack
// directly instead of running them through the same normalizers the
// interactive app uses. These tests reproduce the specific failure modes the
// issue reported: stale/mismatched raw positionType values on "Adjunct ..."
// titles producing employmentType: FULL_TIME, and boolean tenureTrack values
// being silently dropped.

test("derivePositionTypes/derivePrimaryPositionType are parity wrappers around the app's own normalizers", () => {
  const title = "Adjunct Assistant Professor of Chemistry";
  const job = { title, positionType: "Assistant Professor" };
  assert.deepEqual(derivePositionTypes(job), getPositionTypes(title));
  assert.deepEqual(derivePositionTypes(job), ["Assistant Professor", "Adjunct"]);
  assert.equal(derivePrimaryPositionType(job), "Assistant Professor");
});

test("derivePositionTypes prefers titleClean, then title, then an explicit rank", () => {
  assert.deepEqual(derivePositionTypes({ title: "Adjunct Instructor of Biology" }), ["Instructor", "Adjunct"]);
  assert.deepEqual(
    derivePositionTypes({ title: "wrong title", titleClean: "Adjunct Instructor of Biology" }),
    ["Instructor", "Adjunct"]
  );
  assert.deepEqual(derivePositionTypes({ title: "Adjunct Instructor of Biology", rank: "Custom Rank" }), ["Custom Rank"]);
});

test("deriveTenureTrack normalizes booleans, canonical strings, and null the same way the app does", () => {
  const title = "Assistant Professor of Biology";
  assert.equal(deriveTenureTrack({ tenureTrack: true, title }), true);
  assert.equal(deriveTenureTrack({ tenureTrack: false, title }), false);
  assert.equal(deriveTenureTrack({ tenureTrack: "tenure-track", title }), true);
  assert.equal(deriveTenureTrack({ tenureTrack: "non-tenure-track", title }), false);
  assert.equal(deriveTenureTrack({ tenureTrack: null, title }), null);
  assert.equal(deriveTenureTrack({ title }), null);
});

test("deriveTenureTrack lets explicit title language override a stale/contradictory raw value", () => {
  assert.equal(
    deriveTenureTrack({ tenureTrack: true, title: "Non-Tenure-Track Lecturer in English" }),
    false
  );
  assert.equal(
    normalizeTenureTrack(true, "Non-Tenure-Track Lecturer in English"),
    deriveTenureTrack({ tenureTrack: true, title: "Non-Tenure-Track Lecturer in English" })
  );
});

// The core bug: real records from the dataset where positionType was set by
// the enrichment pipeline to the *rank* (or "Other", or left missing) rather
// than the exact string "Adjunct", so the generator's old
// `positionType.toLowerCase() === "adjunct"` check never matched.
test("titles containing Adjunct are PART_TIME regardless of a stale/mismatched raw positionType", () => {
  assert.equal(
    deriveEmploymentType({ title: "Adjunct Assistant Professor of Chemistry", positionType: "Assistant Professor" }),
    "PART_TIME"
  );
  assert.equal(
    deriveEmploymentType({ title: "Adjunct Instructor of Biology", positionType: "Instructor" }),
    "PART_TIME"
  );
  assert.equal(
    deriveEmploymentType({ title: "Adjunct Lecturer in English", positionType: "Other" }),
    "PART_TIME"
  );
  assert.equal(
    deriveEmploymentType({ title: "Adjunct Faculty, Nursing" /* positionType missing */ }),
    "PART_TIME"
  );
});

test("deriveEmploymentType still recognizes the exact raw 'Adjunct' value", () => {
  assert.equal(deriveEmploymentType({ title: "Faculty Opening", positionType: "Adjunct" }), "PART_TIME");
});

test("deriveEmploymentType tags Visiting/Postdoctoral/Research appointments as FULL_TIME + TEMPORARY", () => {
  assert.deepEqual(deriveEmploymentType({ title: "Visiting Faculty Fellow" }), ["FULL_TIME", "TEMPORARY"]);
  assert.deepEqual(deriveEmploymentType({ title: "Postdoctoral Research Fellow" }), ["FULL_TIME", "TEMPORARY"]);
  assert.deepEqual(deriveEmploymentType({ title: "Research Faculty Member" }), ["FULL_TIME", "TEMPORARY"]);
});

test("deriveEmploymentType defaults everything else to FULL_TIME", () => {
  assert.equal(deriveEmploymentType({ title: "Assistant Professor of Chemistry" }), "FULL_TIME");
  assert.equal(deriveEmploymentType({ title: "Lecturer in English" }), "FULL_TIME");
});

test("deriveEmploymentType lets explicit full-/part-time source evidence override the Adjunct default", () => {
  assert.equal(
    deriveEmploymentType({
      title: "Adjunct Instructor of Biology",
      description: "This is a full-time appointment.",
    }),
    "FULL_TIME"
  );
  assert.equal(
    deriveEmploymentType({
      title: "Adjunct & Full-Time Faculty",
    }),
    "FULL_TIME"
  );
});

test("deriveEmploymentType lets explicit part-time evidence override an otherwise full-time title", () => {
  assert.equal(
    deriveEmploymentType({
      title: "Assistant Professor of Chemistry",
      description: "This position is part-time.",
    }),
    "PART_TIME"
  );
});
