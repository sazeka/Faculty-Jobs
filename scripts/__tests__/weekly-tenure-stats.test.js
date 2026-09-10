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

test("does not treat generic 'contingent upon' funding/background-check language as a non-tenure signal", () => {
  // Bare "contingent" is ordinary English in most postings ("offer is contingent
  // upon a background check", "contingent on funding") and must not cancel out a
  // real tenure-track signal elsewhere in the description.
  assert.equal(
    classifyTenureTrack({
      description:
        "The department seeks applicants for a tenure-track Assistant Professor position. The position is contingent on final confirmation of funding.",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      description: "This tenure-track offer is contingent upon successful completion of a background check.",
    }),
    true
  );
});

test("recognizes genuine contingent-faculty language as a non-tenure signal", () => {
  assert.equal(
    classifyTenureTrack({ description: "This is a contingent faculty appointment." }),
    false
  );
});

test("applies verified institution-specific title conventions as a last resort", () => {
  // Columbia: CUIMC's non-tenure track uses the "at CUMC" title suffix (see
  // data/institution-tenure-policy.json for the cited source).
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Columbia University in the City of New York",
      title: "Assistant Professor of Medicine at CUMC",
    }),
    { value: false, evidence: "institution-policy" }
  );
  // A plain title (no "at CUMC") at Columbia is NOT inferred as tenure-track --
  // the source policy doesn't confirm that direction, so it stays unclassified.
  assert.equal(
    classifyTenureTrack({
      college: "Columbia University in the City of New York",
      title: "Assistant Professor of Radiology",
    }),
    null
  );

  // Miami: Miller School of Medicine's non-tenure Clinical Educator track uses
  // "Professor of Clinical [Dept]" / "Clinical [rank] Professor" titles.
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "University of Miami",
      title: "Assistant Professor of Clinical - Anesthesiology",
    }),
    { value: false, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({ college: "University of Miami", title: "Assistant/Associate Professor" }),
    null
  );

  // UTMB Galveston: IHOP policy states non-tenure tracks carry a mission
  // designation (research, instruction, or clinical practice) after the rank.
  for (const title of [
    "Assistant Professor Clinical Practice, Anesthesiology",
    "Assistant Professor Clinic Practice, Pediatric Pulmonology", // typo variant seen in the live data
    "Assistant Professor of Instruction - School of Nursing Undergraduate Studies",
    "Assistant, Associate or Professor Research, Pediatric Nephrology",
    "Assistant Professor (N-T Trk Clin), Internal Medicine-Pulmonary/Critical Care",
  ]) {
    assert.equal(
      classifyTenureTrack({ college: "The University of Texas Medical Branch at Galveston", title }),
      false,
      title
    );
  }
  // A plain rank + department title with no mission designation is NOT
  // guessed -- UTMB doesn't always state it, so this correctly stays null.
  assert.equal(
    classifyTenureTrack({
      college: "The University of Texas Medical Branch at Galveston",
      title: "Assistant Professor, Cardiovascular Medicine",
    }),
    null
  );

  // Rochester: SMD Faculty Regulations define three distinct non-tenure title
  // series -- "of Clinical [Dept]" (suffix), "Clinical [rank]" (prefix,
  // Voluntary Clinical Faculty), and "Research [rank]" (prefix, soft-money).
  for (const title of [
    "Assistant Professor of Clinical Medicine",
    "Instructor of Clinical Pediatrics",
    "Clinical Assistant Professor",
    "Clinical Professor",
    "Research Assistant Professor",
    "Research Professor",
  ]) {
    assert.equal(classifyTenureTrack({ college: "University of Rochester", title }), false, title);
  }
  // Rochester's own regulations state the plain title is used identically
  // whether or not the underlying component is tenurable -- so a plain title
  // genuinely cannot be resolved from text alone and correctly stays null.
  assert.equal(
    classifyTenureTrack({ college: "University of Rochester", title: "Assistant Professor" }),
    null
  );
  assert.equal(
    classifyTenureTrack({ college: "University of Rochester", title: "Instructor" }),
    null
  );

  // An institution with no rules in the policy file is unaffected.
  assert.equal(
    classifyTenureTrack({ college: "Some Other University", title: "Professor of Clinical Medicine" }),
    null
  );

  // A real explicit signal still wins over the institution-policy fallback.
  assert.equal(
    classifyTenureTrack({
      college: "University of Miami",
      title: "Assistant Professor of Clinical - Anesthesiology",
      description: "This is a tenure-track appointment.",
    }),
    true
  );
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
