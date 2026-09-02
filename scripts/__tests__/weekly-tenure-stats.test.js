import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTenureTrack,
  classifyTenureTrackWithEvidence,
  computeTenureTrackBreakdown,
} from "../lib/weekly-tenure-stats.js";

test("classifies stored and explicitly titled tenure status", () => {
  assert.equal(classifyTenureTrack({ tenureTrack: "tenure-track" }), true);
  assert.equal(classifyTenureTrack({ tenureTrack: "non-tenure-track" }), false);
  assert.equal(classifyTenureTrack({ tenureTrack: "unknown", title: "Tenure Stream Assistant Professor" }), true);
  assert.equal(classifyTenureTrack({ title: "NTT Teaching Professor" }), false);
  assert.equal(classifyTenureTrack({ title: "Visiting Assistant Professor" }), false);
  assert.equal(classifyTenureTrack({ positionType: "Postdoctoral" }), false);
  assert.equal(classifyTenureTrack({ title: "Adjunct Professor" }), false);
  assert.equal(classifyTenureTrack({ title: "Assistant Professor of Practice" }), false);
  assert.equal(classifyTenureTrack({ title: "Psychology Temporary Lecturer" }), false);
  assert.equal(classifyTenureTrack({ title: "Part-Time Nursing Instructor" }), false);
  assert.equal(classifyTenureTrack({ title: "Lecturer" }), null);
  assert.equal(classifyTenureTrack({ title: "Full-Time Lecturer" }), null);
  assert.equal(classifyTenureTrack({ title: "Assistant Professor" }), null);
});

test("uses unambiguous descriptions and records classification evidence", () => {
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      title: "Assistant Professor of Biology",
      description: "This is a full-time tenure-track appointment.",
    }),
    { value: true, evidence: "description-explicit" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      title: "Teaching Faculty",
      description: "This fixed-term position is part of the instructional track.",
    }),
    { value: false, evidence: "description-explicit" }
  );
  assert.equal(
    classifyTenureTrack({
      title: "Faculty",
      description: "The department employs both tenure-track and non-tenure-track faculty.",
    }),
    null
  );
});

test("recognizes additional explicit tenure appointment phrases", () => {
  for (const description of [
    "This is a tenure-earning faculty appointment.",
    "The successful candidate will hold a tenure-accruing appointment.",
    "This position is eligible for tenure.",
    "The role is appointed on the tenure-line.",
    "The selected candidate may be appointed with tenure.",
  ]) {
    assert.equal(classifyTenureTrack({ description }), true, description);
  }
});

test("recognizes additional explicit non-tenure appointment phrases", () => {
  for (const description of [
    "This appointment is without tenure.",
    "The position is non-tenurable.",
    "This is a non-tenure-accruing appointment.",
    "This is not a tenure-track appointment.",
    "This position is not eligible for tenure.",
  ]) {
    assert.equal(classifyTenureTrack({ description }), false, description);
  }
});

test("leaves conflicting appointment language unclassified", () => {
  assert.equal(classifyTenureTrack({
    description: "Depending on qualifications, appointment may be eligible for tenure or without tenure.",
  }), null);
});

test("does not treat generic with-tenure policy boilerplate as appointment evidence", () => {
  assert.equal(classifyTenureTrack({
    description: "Before a conditional offer of employment with tenure is finalized, disclosures are required.",
  }), null);
});

test("reports counts and percentages only across classified positions", () => {
  assert.deepEqual(
    computeTenureTrackBreakdown([
      { tenureTrack: true },
      { tenureTrack: "tenured" },
      { tenureTrack: false },
      { title: "Lecturer" },
    ]),
    {
      tenureTrack: 2,
      nonTenureTrack: 1,
      unknown: 1,
      classified: 3,
      tenureTrackPct: 66.7,
      nonTenureTrackPct: 33.3,
    }
  );
});
