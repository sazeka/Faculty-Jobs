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
  // Some sources render the hyphen with a full space on both sides ("Part -
  // Time Instructor") -- College of Southern Nevada, University of
  // Washington, Austin Peay all format titles this way.
  assert.equal(classifyTenureTrack({ title: "Part - Time Instructor, Biology" }), false);
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

  // SUNY (collegePattern rule): system-wide HR policy defines "Qualified
  // Academic Rank" -- titles of lecturer, or academic rank preceded by
  // "clinical" or "visiting" -- as explicitly not tenure-track.
  for (const college of ["Stony Brook University", "University at Buffalo", "SUNY Upstate Medical University"]) {
    assert.equal(classifyTenureTrack({ college, title: "Clinical Assistant Professor" }), false, college);
  }
  assert.equal(
    classifyTenureTrack({ college: "SUNY Buffalo State University", title: "Lecturer 10 Months (Pool Posting)" }),
    false
  );
  // A plain title at a SUNY state-operated campus is unaffected (not "clinical"
  // or "lecturer") and stays unclassified like everywhere else.
  assert.equal(
    classifyTenureTrack({ college: "Stony Brook University", title: "Assistant Professor" }),
    null
  );
  // SUNY's separately-governed community colleges are deliberately excluded
  // from the collegePattern (different governance, not confirmed to share this
  // title schema), so the same title there is NOT matched.
  assert.equal(
    classifyTenureTrack({ college: "SUNY Broome Community College", title: "Clinical Assistant Professor" }),
    null
  );

  // Kentucky: OFA confirms the Research (AR 2:5), Clinical (AR 2:6), and
  // Lecturer (AR 2:9) title series are all non-tenure-track.
  for (const title of [
    "Clinical Assistant Professor in Social Work",
    "Clinical Instructor in Urology",
    "Clinical Title Series Assistant Professor-Emergency Medicine Physician",
    "Research Professor",
    "Lecturer in Criminal Justice",
    "Senior Lecturer in Economics",
  ]) {
    assert.equal(classifyTenureTrack({ college: "University of Kentucky", title }), false, title);
  }
  // UK posts most faculty jobs as a plain "Assistant, Associate or Professor
  // in/of [Specialty]" with no series qualifier stated -- genuinely
  // unresolvable from title text, so it correctly stays unclassified.
  assert.equal(
    classifyTenureTrack({ college: "University of Kentucky", title: "Assistant, Associate or Professor in Neurology" }),
    null
  );

  // Ohio State: trustees bylaws 3335-7 define the Clinical/Teaching/
  // Professional practice series as non-tenure; the College of Medicine
  // faculty-tracks page defines Lecturer/Senior Lecturer as non-tenure
  // "Associated Faculty".
  for (const title of [
    "Clinical Instructor in Dentistry",
    "Assistant Clinical Professor",
    "Teaching Professor of Mathematics",
    "Assistant Professor - Practice",
    "Lecturer",
    "Senior Lecturer, Applied Trumpet (9M)",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Ohio State University", title }), false, title);
  }
  // OSU's own "Open Rank/Track Faculty" phrasing means the track is
  // genuinely undetermined at posting time -- not resolvable from the
  // title, so it correctly stays unclassified rather than being guessed.
  assert.equal(
    classifyTenureTrack({
      college: "Ohio State University",
      title: "Physician - Cardiovascular Medicine, Cardiologist (Open Rank/Track Faculty)",
    }),
    null
  );

  // UT Health San Antonio: IHOP policy states only plain Professor/Associate/
  // Assistant Professor titles are "Tenure Titles"; "[Rank]/Clinical" and
  // "[Rank]/Research" suffixes, the "Clinical [rank]" prefix, Lecturer, and
  // bare Instructor are all explicitly enumerated non-tenure titles.
  const uthsaCollege = "The University of Texas Health Science Center at San Antonio";
  for (const title of [
    "Assistant Professor/Clinical",
    "Assistant Professor/Research",
    "Instructor/Clinical",
    "Clinical Assistant Professor",
    "Lecturer",
    "Instructor",
  ]) {
    assert.equal(classifyTenureTrack({ college: uthsaCollege, title }), false, title);
  }
  // Two live postings append an explicit ", Tenure" / "with Tenure" to the
  // plain title -- a positive signal specific to this institution's own
  // convention, distinguishing the Tenure Titles from the suffixed ones.
  assert.equal(
    classifyTenureTrack({ college: uthsaCollege, title: "Chair and Professor, Tenure" }),
    true
  );
  assert.equal(
    classifyTenureTrack({ college: uthsaCollege, title: "Distinguished Chair Professor with Tenure Faculty Position" }),
    true
  );
  // A plain title with no suffix (the actual Tenure Titles category) and the
  // common "Open Rank Faculty ..." postings both correctly stay unclassified.
  assert.equal(classifyTenureTrack({ college: uthsaCollege, title: "Assistant Professor" }), null);
  assert.equal(classifyTenureTrack({ college: uthsaCollege, title: "Open Rank Faculty Position" }), null);

  // Santa Rosa Junior College: SRJC's own live posting text states
  // "Associate assignments may be temporary, part-time and/or on-call" and
  // caps them at 67% of a full-time assignment.
  assert.equal(
    classifyTenureTrack({ college: "Santa Rosa Junior College", title: "Associate Faculty - Chemistry" }),
    false
  );
  // Not generalized to other colleges -- only SRJC's own posting language
  // was verified.
  assert.equal(
    classifyTenureTrack({ college: "Some Other Community College", title: "Associate Faculty - Chemistry" }),
    null
  );

  // Central Washington University: the Faculty Code separates "academic
  // rank" (tenure-eligible) from "professional designation" (lecturer,
  // senior lecturer, etc.); the CBA describes Lecturer as non-tenure-track.
  for (const title of ["Lecturer Pool - Accounting", "Senior Lecturer, Applied Music", "Nonpermanent Pool - EMT/Paramedic Lab Instructors"]) {
    assert.equal(classifyTenureTrack({ college: "Central Washington University", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "Central Washington University", title: "Assistant Professor - Mathematics" }),
    null
  );

  // University of Washington: ap.washington.edu documents five professorial
  // tracks; Tenure status is explicitly "N/A" for WOT, Research, Teaching,
  // and Clinical Practice. "Acting" titles are separately confirmed
  // non-tenure (used for ABD candidates and postdocs past the term limit).
  const uwCollege = "University of Washington";
  for (const title of [
    "Assistant or Associate Professor (WOT) - Pediatric Epileptologist",
    "Assistant Professor of Clinical Practice, Family Medicine",
    "Clinical Assistant Professor or Clinical Associate Professor",
    "Teaching Assistant Professor - Robotics (GIX)",
    "Research Assistant Professor, Department of Microbiology",
    "Acting Assistant Professor, History",
    "Acting Instructor – Mechanistic Computational Modelling",
  ]) {
    assert.equal(classifyTenureTrack({ college: uwCollege, title }), false, title);
  }
  assert.equal(classifyTenureTrack({ college: uwCollege, title: "Assistant Professor in Physics" }), null);

  // University of South Florida: the Provost's office confirms the
  // "Professor of Instruction Series" and "Instructor Series" are both
  // explicitly non-tenure "instructional faculty".
  const usfCollege = "University of South Florida";
  for (const title of [
    "Assistant Professor of Instruction - Mechanical Eng",
    "Instructional Faculty Position, School of Marketing",
    "Child Abuse Pediatrics Clinical Faculty Position",
    "APRN/Instructor 1.",
    "Physician Asst/Instructor. I - Plastic Surgery",
  ]) {
    assert.equal(classifyTenureTrack({ college: usfCollege, title }), false, title);
  }
  assert.equal(classifyTenureTrack({ college: usfCollege, title: "Assistant Professor" }), null);

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
