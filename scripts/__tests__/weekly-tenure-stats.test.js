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

test("source titles and verified institution policies override stale stored values", () => {
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      title: "Adjunct Assistant Professor of Mathematics",
      tenureTrack: true,
    }),
    { value: false, evidence: "title-rank" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "SUNY Upstate Medical University",
      title: "Psychiatry Instructor/Assistant Professor (Adult or Child Psych)",
      description: "Board Eligible or Board Certified psychiatrist sought for a Clinical Instructor or Clinical Assistant Professor position.",
    }),
    { value: false, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "University of Washington",
      title: "Assistant or Associate Professor (WOT) - Pediatric Epileptologist",
      tenureTrack: true,
    }),
    { value: false, evidence: "title-rank" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "University of Nevada, Las Vegas",
      title: "Assistant Professor-in-Residence, Criminal Justice",
      tenureTrack: true,
    }),
    { value: false, evidence: "title-rank" }
  );
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
  assert.equal(
    classifyTenureTrack({
      college: "Colorado Mesa University",
      title: "Assistant or Associate Professor/Clinical Professor for Master of Science in Occupational Therapy",
      tenureTrack: true,
    }),
    true
  );
});

test("gives labeled appointment-track fields precedence over unrelated page prose", () => {
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      description:
        "Tenure Track Status Non-Tenure Track Required Education MD. Faculty follow the university tenure and promotion policy.",
    }),
    { value: false, evidence: "description-structured-field" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      description:
        "Is this position tenure track or non-tenure track? Tenure Track. The college also employs non-tenure-track lecturers.",
    }),
    { value: true, evidence: "description-structured-field" }
  );
  assert.equal(
    classifyTenureTrack({
      description: "Type of Position: Faculty - Non-Tenure (Research). Promotion and tenure policies are available online.",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      description: "Group: Tenure System Faculty. The department also includes non-tenure-track instructors.",
    }),
    true
  );
  // Mixed free-form language is still ambiguous; only a source field receives
  // precedence.
  assert.equal(
    classifyTenureTrack({
      description: "Appointment may be tenure-track or non-tenure-track depending on qualifications.",
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

  assert.deepEqual(
    classifyTenureTrackWithEvidence({ title: "Associate or Full Professor (with Tenure)" }),
    { value: true, evidence: "title-explicit" }
  );
});

test("recognizes additional explicit non-tenure appointment phrases", () => {
  for (const description of [
    "This appointment is without tenure.",
    "The position is non-tenurable.",
    "This is a non-tenure-accruing appointment.",
    "This is not a tenure-track appointment.",
    "This position is not eligible for tenure.",
    "This is a full‑time, 12‑month, non‑tenure‑track faculty position.",
    "This is a one-year faculty appointment with possible renewal.",
    "The department is seeking applications for one-year lecturer positions.",
    "This is a one-year instructor appointment with possible renewal.",
    "This is a full-time temporary position (not to exceed 2 years).",
    "The initial Clinical/Applied contract is 1-2 years and subsequent contracts depend on review.",
    "This is a term position; length of the term will be discussed during the interview process.",
    "The department invites applications for a one-year full-time Teaching Professor position.",
    "The position will be a two-year term, with renewal based on performance.",
  ]) {
    assert.equal(classifyTenureTrack({ description }), false, description);
  }
});

test("recognizes appointment-title qualifiers that are definitionally outside a tenure line", () => {
  for (const title of [
    "Affiliate Faculty for Professional Doctoral Programs",
    "Per Diem Nursing Lab Instructor",
    "Non-Compensated Clinical Faculty Open Rank",
    "Contract Faculty - Department of Physics",
    "Psychology: Contract Instructor-College Credit",
    "Acting Assistant Professor of Management",
    "Adult Basic Education Substitute Instructor",
    "9-Month Restricted Faculty of Emergency Medical Services",
    "Assistant Professor Term",
    "Associate Professor, Term",
    "Term Assistant Professor in Applied Physics",
    "Full Time Instructor 3 Term - Cybersecurity",
    "Affiliate Instructor, Communication",
    "On-Call Culinary Instructor",
    "Hourly Nursing Instructor",
    "Skilled Trades Non-Credit Instructor",
    "Phlebotomy Instructor, Non-Credit",
    "Adj. Instructor, Culinary Arts",
    "Lecturer - Creating a Pool - School of Communication",
    "Arts Administration On-Campus Instructors (POOL POSTING)",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ title }),
      { value: false, evidence: "title-rank" },
      title
    );
  }
});

test("recognizes substitute instructors when a discipline appears inside the title", () => {
  assert.equal(classifyTenureTrack({ title: "Substitute Cosmetology Instructor" }), false);
  assert.equal(classifyTenureTrack({ title: "Substitute Professor of Economics" }), null);
});

test("recognizes direct adjunct-role statements without using incidental adjunct mentions", () => {
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      title: "Clinical Faculty",
      description: "This is an adjunct faculty appointment. Clinical teaching is paid hourly.",
    }),
    { value: false, evidence: "description-direct-claim" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      title: "English Instructor",
      description: "Menlo College is seeking an adjunct instructor to teach English language learners.",
    }),
    { value: false, evidence: "description-direct-claim" }
  );
  assert.equal(
    classifyTenureTrack({
      title: "Assistant Professor",
      description: "The successful candidate will help recruit and mentor adjunct faculty.",
    }),
    null
  );
});

test("recognizes direct part-time role statements but not flexible full-or-part-time workloads", () => {
  for (const description of [
    "Summary: Part-time faculty position supporting the nursing program.",
    "The Center is seeking part-time contract instructors for workforce training.",
    "This is a part-time/contract instructional position for the spring term.",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ title: "Instructor", description }),
      { value: false, evidence: "description-direct-claim" },
      description
    );
  }
  assert.equal(
    classifyTenureTrack({
      title: "Assistant Professor",
      description: "This position is full-time or part-time faculty position at 80%-100% effort.",
    }),
    null
  );
});

test("recognizes P/T faculty title abbreviations without treating mixed F/T or P/T roles as part-time", () => {
  assert.equal(classifyTenureTrack({ title: "GED/HSE Instructor P/T" }), false);
  assert.equal(classifyTenureTrack({ title: "Workforce Training Instructor (P / T)" }), false);
  assert.equal(classifyTenureTrack({ title: "Instructor - Engineering Technology (F/T or P/T)" }), null);
});

test("classifies Fellow ranks as non-tenure without confusing fellowship-program leadership", () => {
  for (const title of [
    "AIRC Research Fellow",
    "Faculty Fellow in Business",
    "Fellow-in-Residence — Faculty of Arts and Sciences",
    "Physician Assistant Fellow - Pediatrics: Neonatal Critical Care",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ title }),
      { value: false, evidence: "title-rank" },
      title
    );
  }
  assert.equal(
    classifyTenureTrack({ title: "Professor and Program Director, Thoracic Radiology Fellowship" }),
    null
  );
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

test("recognizes a temporary replacement appointment without treating generic temporary prose as track evidence", () => {
  assert.equal(
    classifyTenureTrack({
      title: "Instructor, Biology",
      description: "This position is a temporary replacement for faculty members on sabbatical leave.",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      title: "Assistant Professor of Biology",
      description: "The search committee has established a temporary review schedule.",
    }),
    null
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
    false
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
  // Multi-rank slash chains after "Clinical" (heavily used at Stony
  // Brook/Buffalo/Downstate) also match, not just a single optional
  // assistant/associate word.
  assert.equal(
    classifyTenureTrack({
      college: "Stony Brook University",
      title: "Anesthesiologist, Clinical Assistant/Associate/Full Professor, Anesthesiology, Pediatric",
    }),
    false
  );
  // SUNY HR explicitly identifies the unqualified academic ranks as tenure
  // track at state-operated campuses.
  assert.equal(
    classifyTenureTrack({ college: "Stony Brook University", title: "Assistant Professor" }),
    true
  );
  // The same applies to an unqualified multi-rank slash chain.
  assert.equal(
    classifyTenureTrack({
      college: "Stony Brook University",
      title: "Cardiologist, Assistant/Associate/Full Professor, Internal Medicine, Heart Failure",
    }),
    true
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
    "Physician – Clinical Faculty, Radiation Oncologist-GU (Open Rank/Track Faculty)",
    "Research Faculty - Division of Surgical Oncology - (Associate Professor or Professor)",
    "Research Professor",
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
  // A plain title with no suffix remains unresolved. The otherwise generic
  // exact Open Rank title is a separately verified current tenure search.
  assert.equal(classifyTenureTrack({ college: uthsaCollege, title: "Assistant Professor" }), null);
  assert.equal(classifyTenureTrack({ college: uthsaCollege, title: "Open Rank Faculty Position" }), true);

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
    classifyTenureTrack({ college: "Central Washington University", title: "Assistant Professor - Economics" }),
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

  // Issue #145: the check above only exercises the no-stored-value path.
  // Eleven live University of Washington WOT records were stuck at
  // tenureTrack: true because classifyTenureTrackWithEvidence() used to
  // return a stored boolean immediately, before ever consulting the title --
  // so a stale/incorrect
  // `true` silently outranked the source's own "WOT" title language. This
  // reproduces the actual production failure state: a WOT title combined
  // with a contradictory stored `true`.
  for (const title of [
    "Assistant Professor WOT – Department of Laboratory Medicine and Pathology, Neuropathology",
    "Assistant or Associate Professor (WOT) in Radiology, Emergency and Trauma",
    "Assistant, Associate or Full Professor (WOT) - Foot & Ankle Surgeon - Orthopaedic Surgery & Sports Medicine",
    "Assistant, Associate, or Full Professor (WOT) in Radiology, Cardiothoracic Imaging",
    "Professor WOT, Division of Hematology and Oncology (Leukemia Program Head)",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college: uwCollege, title, tenureTrack: true }),
      { value: false, evidence: "title-rank" },
      title
    );
  }
  // "without tenure" (spelled out, not the "WOT" abbreviation) is recognized
  // directly as explicit non-tenure title language -- it doesn't need the
  // institution-policy fallback at all.
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: uwCollege,
      title: "Assistant, Associate or Full Professor without tenure - UW Pediatrics - Gastroenterology & Hepatology",
      tenureTrack: true,
    }),
    { value: false, evidence: "title-explicit" }
  );
  // A stored `true` that agrees with a plain (non-WOT) UW title is untouched.
  assert.deepEqual(
    classifyTenureTrackWithEvidence({ college: uwCollege, title: "Assistant Professor in Physics", tenureTrack: true }),
    { value: true, evidence: "stored" }
  );
  // Explicit title language still wins even when it contradicts a stored
  // non-tenure value in the other direction.
  assert.deepEqual(
    classifyTenureTrackWithEvidence({ title: "Tenure-Track Assistant Professor", tenureTrack: false }),
    { value: true, evidence: "title-explicit" }
  );

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
  assert.equal(classifyTenureTrack({ college: usfCollege, title: "Assistant Professor" }), true);

  // Texas State Technical College: no explicit tenure policy was found, but
  // every posting ever scraped from this employer uses "Instructor" -- zero
  // "Professor" titles exist at all -- consistent with a technical/
  // vocational college with no professorial tenure ladder.
  assert.equal(
    classifyTenureTrack({ college: "Texas State Technical College", title: "Welding - Instructor (Trade Experience)" }),
    false
  );
  // The same bare-"Instructor" title elsewhere is not affected.
  assert.equal(classifyTenureTrack({ college: "Some Other College", title: "Instructor" }), null);

  // UW-Madison: SMPH's six faculty tracks include only Tenured/Tenure-Track
  // as "full faculty"; CHS, CT, Research Professor, Teaching Professor, and
  // Clinical Adjunct are all non-tenure "academic staff".
  const madisonCollege = "UW-Madison";
  for (const title of [
    "Assistant, Associate, Full Professor - Stroke Neurologist (CHS)",
    "Assistant/ Associate/ Professor (CHS or CT Track) Notice of Filing",
    "Asst, Assoc, or Full Professor CHS-Cornea Service",
    "Research Professor",
    "Teaching Assistant Professor",
    "Clinical Instructor, Large Animal Surgery",
  ]) {
    assert.equal(classifyTenureTrack({ college: madisonCollege, title }), false, title);
  }
  // A plain title with no track qualifier -- including outside the medical
  // school entirely -- correctly stays unclassified.
  assert.equal(classifyTenureTrack({ college: madisonCollege, title: "Assistant Professor of Political Science" }), null);
  assert.equal(
    classifyTenureTrack({
      college: madisonCollege,
      title: "Assistant Professor of Political Science",
      description: "Job Category: Faculty Employment Type: Regular Job Profile: Assistant Professor Job Summary: Research and teaching.",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      college: madisonCollege,
      title: "Comprehensive Ophthalmology Faculty",
      description: "Job Category: Academic Staff Employment Type: Regular Job Profile: Assistant Professor (CHS) Job Summary: Patient care.",
    }),
    false
  );
  // The category alone is insufficient, and a CHS profile must never be
  // mistaken for the plain tenure-track Faculty profile.
  assert.equal(
    classifyTenureTrack({ college: madisonCollege, title: "Assistant Professor", description: "Job Category: Faculty" }),
    null
  );

  for (const title of [
    "Assistant/Associate Teaching Professor in Geospatial Analytics",
    "Professor of the Practice in Media Arts and Production",
  ]) {
    assert.equal(classifyTenureTrack({ college: "NC State University", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "University of Maryland, College Park", title: "Faculty Specialist" }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "University of Maryland, College Park",
      title: "Senior/Principal Faculty Specialist OR Associate Professor/Professor OR Senior/Principal Agent",
    }),
    null
  );
  for (const title of [
    "Clinical Instructor of Radiology (Practitioner)",
    "Assistant or Associate Professor of Clinical Otolaryngology Head and Neck Surgery-CHLA",
  ]) {
    assert.equal(classifyTenureTrack({ college: "University of Southern California", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "University of New Orleans", title: "Assistant Professor of Professional Practice - Healthcare Management" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "University of Nebraska at Omaha", title: "Instructor - Early Literacy" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "University of Nebraska at Omaha", title: "Assistant/Associate Professor, DSW Director Appointment" }),
    null
  );
  for (const title of ["Lecturer, Business Law", "Practicum Director/Clinical Assistant Professor"]) {
    assert.equal(classifyTenureTrack({ college: "St Bonaventure University", title }), false, title);
  }
  for (const title of [
    "Workforce Development and Continuing Education Art Instructor",
    "Workforce Development and Continuing Education- English as a Second Language Instructor",
    "Allied Health Care Training Instructor",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Schenectady County Community College", title }), false, title);
  }

  // University of Vermont: the Larner College of Medicine Faculty Handbook
  // confirms four non-tenure "Ranked" pathways (Clinical, Clinical Scholar,
  // Education Scholar, Research Scholar). Critically, the Clinical Scholar
  // Pathway shares the SAME plain titles as the Tenure Pathway -- only
  // resolvable when the pathway name itself is stated in the title.
  const uvmCollege = "University of Vermont";
  for (const title of [
    "Clinical Assistant Professor, Surgery",
    "Assistant/Associate/Professor, Clinical Scholar Pathway - General Neurologist",
    "Clinical Academic Abdominal Radiologist (Assistant/Associate/Professor - Radiology)",
    "Clinical Radiologist (Assistant/Associate/Professor - Radiology - Porter Medical)",
  ]) {
    assert.equal(classifyTenureTrack({ college: uvmCollege, title }), false, title);
  }
  // A plain title with no pathway named is genuinely ambiguous (could be
  // Tenure Pathway or Clinical Scholar Pathway -- identical titles) and
  // correctly stays unclassified.
  assert.equal(classifyTenureTrack({ college: uvmCollege, title: "Assistant/Associate/Professor Breast Surgical Oncology" }), null);
  assert.equal(classifyTenureTrack({
    college: uvmCollege,
    title: "Assistant/Associate/Professor Breast Surgical Oncology",
    description: "This is a full-time faculty appointment in the Clinical Scholar Pathway.",
  }), false);

  // North Carolina public community colleges (collegePattern rule): the NC
  // State Board of Community Colleges Code -- the governing document for all
  // 58 public NC community colleges -- contains zero mentions of "tenure"
  // anywhere in ~540 pages, so no position there can be tenure-track by
  // institutional design. Matches ANY title, not just keyword-scoped ones.
  for (const title of [
    "Automotive Systems Technology Instructor",
    "Clinical Nursing Instructor",
    "Department Chair of Horticulture Technology",
    "Nursing Faculty (12-Months)",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Forsyth Technical Community College", title }), false, title);
  }
  // Private NC junior colleges are deliberately excluded (different
  // governance, not confirmed to be covered by the same state code) --
  // Louisburg College is a private 2-year institution, not part of the
  // state-operated NCCCS system.
  assert.equal(
    classifyTenureTrack({ college: "Louisburg College", title: "Automotive Systems Technology Instructor" }),
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

test("does not treat a department-overview faculty headcount as a position-track signal", () => {
  // CSU Fort Collins SMTD's boilerplate "department overview" sentence states the
  // CURRENT SIZE of the department, not the track of the posted position -- nine
  // live "Open Pool" Instructor postings were incorrectly stored as
  // tenureTrack: true purely off this sentence.
  assert.equal(
    classifyTenureTrack({
      college: "Colorado State University-Fort Collins",
      title: "Applied Music Instructors - Open Pool",
      description:
        "The School of Music, Theatre, and Dance (SMTD) at Colorado State University empowers students. SMTD has 46 tenured and tenure-track faculty as well as 55 contract, continuing and adjunct faculty. There are currently over 550 students in SMTD.",
    }),
    // The CSU institution-policy rule below resolves this to false; the point of
    // this assertion is that it is NOT true.
    false
  );
  // The same shape appears verbatim at other institutions (Texas A&M, Virginia
  // Tech, UMass Lowell, and others), so it is not CSU-specific.
  for (const description of [
    "The Department has 30 tenured and tenure-track faculty, modern research facilities, and a vibrant graduate program.",
    "The Department of Finance, Insurance and Law has 19 tenured and tenure-track faculty members and 800 undergraduate students.",
    "It currently has 19 tenured/tenure-track faculty and 7 instructional academic staff serving approximately 1000 students.",
    // The second enumerated clause here ("22 academic professional track faculty
    // members") must not leak through as a false NON-tenure signal either.
    "with approximately 55 tenured/tenure-track faculty, 22 academic professional track faculty members",
  ]) {
    assert.equal(classifyTenureTrack({ description }), null, description);
  }
  // A genuine per-position statement elsewhere in the same description still
  // wins -- the aggregate clause is stripped, not the whole description.
  assert.equal(
    classifyTenureTrack({
      description:
        "This is a full-time, tenured/tenure-track faculty position. Our Clinical Nutrition Service has 1 tenure-track clinical nutritionist and one licensed veterinary technician.",
    }),
    true
  );
});

test("ignores group-of faculty headcounts before reading the opening's teaching track", () => {
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      title: "Full-Time",
      description:
        "Full-Time, Teaching-Track Faculty Position in Biology. The candidate will join a group of 12 tenured/tenure-track, teaching, and research core faculty members.",
    }),
    { value: false, evidence: "description-explicit" }
  );
});

test("ignores visa-sponsorship track boilerplate before reading the opening's track", () => {
  assert.equal(
    classifyTenureTrack({
      title: "Assistant Professor of Criminology",
      description:
        "CCU rarely sponsors part-time, temporary, staff or non-tenure-track roles and will not sponsor H-1B petitions when the required fee applies. The Department invites applications for a Tenure-Track Assistant Professor of Criminology.",
    }),
    true
  );
});

test("gives a direct position claim precedence over later cross-track context", () => {
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      title: "Assistant Professor of Finance",
      description:
        "The department invites applications for a tenure-track faculty position in Finance. Our faculty include lecturers on non-tenure-track appointments.",
    }),
    { value: true, evidence: "description-direct-claim" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      title: "Lecturer",
      description:
        "This is a ranked non-tenure-track faculty position. Tenure-track faculty participate in a separate review process.",
    }),
    { value: false, evidence: "description-direct-claim" }
  );
  assert.equal(
    classifyTenureTrack({
      title: "Open Rank Professor",
      description: "The position is a full-time tenure-track or non-tenure-track faculty position.",
    }),
    null
  );
});

test("recognizes a direct this-tenure-track-position claim before contextual track prose", () => {
  assert.equal(
    classifyTenureTrack({
      title: "Open Rank Professor of Political Science",
      description: "This tenure-track, open-rank position includes teaching and research. The department includes fixed-term faculty.",
    }),
    true
  );
});

test("applies the CSU Fort Collins Instructor-rank institution policy", () => {
  for (const title of [
    "Applied Music Instructors - Open Pool",
    "Dance Instructors - Open Pool",
    "Marching Band Instructor - Open Pool",
    "Music Education Instructor (Evergreen)",
    "Theatre Instructor - Open Pool",
  ]) {
    assert.equal(
      classifyTenureTrack({ college: "Colorado State University-Fort Collins", title }),
      false,
      title
    );
  }
  // A title also naming a Professor rank is genuinely ambiguous about which rank
  // the hire lands at, so it is NOT matched by the Instructor-only policy.
  assert.equal(
    classifyTenureTrack({
      college: "Colorado State University-Fort Collins",
      title: "Instructor/Assistant/Associate Professor in Livestock Veterinary Services",
    }),
    null
  );
});

test("applies Colorado State, Morgan State, Northeastern, and Ball State institution-specific conventions", () => {
  // CSU-Fort Collins: Faculty Manual Section E limits both Tenured and
  // Tenure-Track appointments to the assistant/associate/professor ranks, so
  // Instructor (and Senior/Master Instructor) can never be tenure-track.
  for (const title of ["Instructor - Open Pool - Communication Studies", "Instructor: VM710 - Foundations, Bandaging Lab", "Instructors - Open Pool"]) {
    assert.equal(classifyTenureTrack({ college: "Colorado State University-Fort Collins", title }), false, title);
  }
  // A compound "Instructor/.../Professor" open-rank search is genuinely
  // ambiguous (could land at either rank) and stays unclassified, same as
  // the Troy University "Lecturer/...Professor" precedent.
  assert.equal(
    classifyTenureTrack({
      college: "Colorado State University-Fort Collins",
      title: "Instructor/Sr. Instructor/Assistant Professor, Veterinary Communications",
    }),
    null
  );

  // Morgan State: Faculty Handbook Sec. 2.0 names Lecturer directly as a
  // "non-tenure-track rank."
  assert.equal(
    classifyTenureTrack({ college: "Morgan State University", title: "Full-Time Lecturer - Supply Chain Management" }),
    false
  );

  // Northeastern: a Senior Vice Provost presentation lists Teaching
  // Professor, Clinical Professor, Professor of the Practice, Academic
  // Specialist, Full-time Lecturer, Co-op Coordinator, and Research
  // Professor as the full-time non-tenure-track faculty types.
  for (const title of [
    "Assistant/Associate Teaching Professor - MS in Human Resources Management",
    "Professor of the Practice & Director - Engineering Design Program",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Northeastern University", title }), false, title);
  }
  // A plain title with no qualifier is Northeastern's tenure-line series and
  // stays unclassified; the separate Fellow-rank rule handles fixed-term
  // research fellow appointments.
  assert.equal(
    classifyTenureTrack({ college: "Northeastern University", title: "Assistant Professor, Modern Korean History" }),
    null
  );
  assert.equal(
    classifyTenureTrack({ college: "Northeastern University", title: "Distinguished Research Fellow, Khoury College of Computer Sciences" }),
    false
  );

  // Ball State's current Faculty Resources page lists both the Lecturer and
  // Teaching Professor ladders under "Non-Tenure Line Titles and Promotions."
  assert.equal(
    classifyTenureTrack({
      college: "Ball State University",
      title: "Assistant Lecturer of Early Childhood, Youth, and Family Studies (Child Life)",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "Ball State University",
      title: "Assistant Lecturer/Assistant Teaching Professor of Entrepreneurship",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "Ball State University", title: "Assistant Teaching Professor" }),
    false
  );
  // Ball State's legacy Instructor rank was moved into its non-tenure-line
  // structure and retitled within the Lecturer/Teaching Professor ladder.
  assert.equal(classifyTenureTrack({ college: "Ball State University", title: "Instructor of Nursing" }), false);
});

test("applies USG, UNLV, Virginia Tech, and Florida institution-specific conventions", () => {
  // USG (collegePattern): Board of Regents-defined non-tenure ranks (Academic
  // Professional, Lecturer, Public Service, Clinical, Research Scientist,
  // Librarian) extended from the existing University of Georgia rule to the
  // rest of the University System of Georgia.
  for (const college of ["University of North Georgia", "Georgia College & State University", "Fort Valley State University"]) {
    assert.equal(classifyTenureTrack({ college, title: "Lecturer of Psychology" }), false, college);
  }
  // USG defines the unqualified academic-rank ladder as tenure track.
  assert.equal(
    classifyTenureTrack({ college: "University of North Georgia", title: "Assistant Professor of Biology" }),
    true
  );
  // The compound "Lecturer/[Assistant/Associate] Professor" form is genuinely
  // ambiguous (mixes a non-tenure rank with a potentially tenure-track one)
  // and is deliberately excluded, same as the Troy University precedent.
  assert.equal(
    classifyTenureTrack({
      college: "Middle Georgia State University",
      title: "Lecturer/Assistant Professor of Aviation & Air Traffic Control Specialist",
    }),
    null
  );
  // "Lecturer/Senior Lecturer" has no such ambiguity (both alternatives are
  // non-tenure) and still matches.
  assert.equal(
    classifyTenureTrack({ college: "University of North Georgia", title: "Lecturer/Senior Lecturer of Nursing, BSN" }),
    false
  );
  // Georgia State's own handbook now supplies the narrower institution rule;
  // direct appointment language still outranks the title convention.
  assert.equal(
    classifyTenureTrack({ college: "Georgia State University", title: "Clinical Assistant Professor of Radiology" }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "Georgia State University",
      title: "Clinical Assistant Professor of Radiology",
      description: "This is a tenure-track appointment.",
    }),
    true
  );

  // UNLV: University Bylaws define Rank 0 appointments as non-tenure-track
  // and unqualified Rank II-IV professorial appointments as the tenure line.
  assert.equal(
    classifyTenureTrack({
      college: "University of Nevada, Las Vegas",
      title: "Assistant Professor-in-Residence, Criminal Justice",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "University of Nevada, Las Vegas",
      title: "Geriatrics, Assistant/Associate/Professor, Internal Medicine",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({ college: "University of Nevada, Las Vegas", title: "Clinical Assistant Professor of Medicine" }),
    false
  );

  // Virginia Tech: Faculty Handbook Ch. 5/6 define Clinical, Collegiate,
  // Instructor, and Research Professor as non-tenure-track series.
  for (const title of ["Collegiate Assistant Professor of Forestry", "Instructor", "Research Assistant Professor", "Open Rank - Research Faculty"]) {
    assert.equal(classifyTenureTrack({ college: "Virginia Tech", title }), false, title);
  }
  // A plain title with no Clinical/Collegiate/Research qualifier is VT's
  // tenure-track series and stays unclassified.
  assert.equal(
    classifyTenureTrack({ college: "Virginia Tech", title: "Assistant/Associate Professor of Mammalian Conservation Ecology" }),
    null
  );

  // Florida: 2021 Faculty Senate Resolution renamed the non-tenure Lecturer
  // series to "Instructional Professor" and confirms Clinical/Research
  // Professor are also non-tenure-track series.
  assert.equal(
    classifyTenureTrack({ college: "University of Florida", title: "Assistant Instructional Professor" }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "University of Florida",
      title: "Clinical Assistant or Associate Professor of Veterinary Clinical Pathology",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "University of Florida", title: "Assistant Professor in American Politics" }),
    true
  );
});

test("applies additional verified institution-specific appointment-title policies", () => {
  const nonTenureCases = [
    ["Columbia University in the City of New York", "Assistant Professor at CUIMC"],
    ["Columbia University in the City of New York", "Assistant Professor at the Columbia University Medical Center"],
    ["University of Miami", "Clinical Faculty, Open Rank - Diagnostic Radiology"],
    ["University of Miami", "Anesthesiology- Research Asst. Professor"],
    ["Yeshiva University", "Clinical & Preclinical Instructor"],
    ["Yeshiva University", "Clinical Assistant/Associate Professor and Director"],
    ["Georgia Institute of Technology-Main Campus", "Lecturer / Sr. Lecturer (open rank)"],
    ["The University of Texas Health Science Center at Houston", "Instructor, Undergraduate Studies"],
    ["University of Notre Dame", "Associate/Full Research Professor"],
    ["Florida International University", "Open Rank Research Professor Pool in the Institute of Environment"],
    ["Stony Brook University", "AI Innovation Research Assistant Professor"],
    ["Samuel Merritt University", "Annual Faculty - Medical / Surgical Nursing"],
    ["Harrisburg Area Community College", "Workforce Development (WFD) Instructor - Automotive Technology"],
    ["William Rainey Harper College", "CE Instructor - Arabic Instructor – Levant Dialects"],
    ["William Rainey Harper College", "Community Education Instructor - Career Training"],
    ["William Rainey Harper College", "Vocational Skills Lecturer - Artificial Intelligence Instructor"],
    ["Oakland University", "Special Instructor in Chemistry"],
    ["Tennessee Technological University", "Lecturer (3 Positions) - Computer Science"],
    ["East Tennessee State University", "9-Month Lecturer, Nursing Undergraduate Programs"],
    ["South Texas College", "Full-Time Lecturer Positions (Division of Liberal Arts)"],
    ["University of Wyoming", "Lecturer, Assistant - Energy & Petroleum Engineering"],
    ["Southern Illinois University Edwardsville", "FA26-036: Lecturer"],
    ["University of New Hampshire System", "Clinical Assistant Professor of Nursing"],
    ["University of New Hampshire-Franklin Pierce School of Law", "Assistant Director of Legal Residencies (Lecturer)"],
    ["Boise State University", "Lecturer - Chemistry"],
    ["The Catholic University of America", "Clinical Assistant/Associate Professor / Conway Mentor"],
    ["Wayne State University", "Assistant Professor, Clinical - Department of Neurology"],
    ["Northern Illinois University", "Instructor, Biological Sciences"],
    ["Cabrillo College", "Communication Studies - Associate Instructor"],
    ["University of Maryland, Baltimore County", "Assistant Teaching Professor"],
    ["University of Maryland, Baltimore County", "Faculty Research Assistant"],
    ["Medical College of Wisconsin", "Faculty Instructor II - Cardiology/Advanced Imaging"],
    ["Austin Community College District", "Faculty, Nursing"],
    ["University of Miami", "Instructor - Ophthalmology"],
    ["Binghamton University", "Lecturers in Economics"],
    ["Oral Roberts University", "Open Rank Professor of Nursing"],
    ["Liberty University", "Assistant Professor - Social Work"],
    ["Hampton University", "Research Assistant Professor of Machine Learning and Control"],
    ["Hampton University", "Lead Welding Instructor- Virginia Workforce Innovation & Entrepreneurship Center"],
    ["University of Rochester", "Clinical/Executive Professor of Strategy and Consulting (Full-time)"],
    ["University of Rochester", "GI Pathology - Instructor-1"],
    ["College of the Mainland", "Faculty - English"],
    ["University of North Texas Health Science Center", "Instructor - HSC-Texas Coll of Osteopathic Med"],
    ["Barry University", "Assistant/Associate Professor Physician Assistant Program"],
    ["Barry University", "Assistant Professor of Psychology"],
    ["University of Minnesota", "Faculty Position in Pathology (Academic/Clinician Track)"],
    ["Wayne State University", "Assistant Professor, Clinician Educator - Dept. of Psychiatry"],
    ["UCLA", "Family Medicine Faculty - Health Sciences Clinical Series"],
    ["UC San Francisco", "Health Sciences Assistant/Associate/Full Clinical Professor"],
    ["UCLA", "Head and Neck Surgeon - HS Assistant, Associate or Full Clinical Professor"],
    ["University of New Mexico", "Open Rank Lecturer in Psychiatry, First Episode Psychosis"],
    ["Baptist Health Sciences University", "Instructor/Clinical Coordinator for Medical Radiography Program"],
    ["University of Georgia", "Clinical Assistant, Associate, or Full Professor"],
    ["University of Georgia", "Public Service Faculty - Economic Development Training"],
  ];

  for (const [college, title] of nonTenureCases) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college, title }),
      { value: false, evidence: "institution-policy" },
      `${college}: ${title}`
    );
  }

  assert.equal(
    classifyTenureTrack({
      college: "Amarillo College",
      title: "Faculty - Biology",
      description: "Job Type Full-Time Job Number 202400782",
    }),
    true
  );
  assert.equal(classifyTenureTrack({ college: "Oakland University", title: "Assistant Professor of Accounting" }), true);
  assert.equal(
    classifyTenureTrack({
      college: "Northampton County Area Community College",
      title: "Fab Lab Instructor",
      description: "The number of adjunct instructors hired varies from semester to semester.",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "Northampton County Area Community College",
      title: "Lineworker Instructor",
      description: "Part-time hands-on adjunct Instructors for the Lineworker Trainee Program.",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "Northampton County Area Community College",
      title: "Youth Instructor",
      description: "Applicants will be placed into a pool for future consideration. The number hired varies from semester to semester.",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "Fort Hays Tech North Central",
      title: "Information Technology Instructor",
      description: "Pay commensurate with qualifications, plus fringe benefits.",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({ college: "Fort Hays Tech North Central", title: "Nursing Instructor" }),
    null
  );
  assert.equal(
    classifyTenureTrack({
      college: "Ohio State University",
      title: "Community Music School Instructor",
      description: "Community Music School Instructors will teach engaging and effective private lessons, classes, and/or ensembles.",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "Bard College",
      title: "Full-time Faculty in Theater",
      description: "Bard High School Early College Bronx. Compensation follows the United Federation of Teacher salary scale.",
    }),
    false
  );
  assert.equal(classifyTenureTrack({ college: "Bard College", title: "Assistant Professor in Art History" }), null);
  assert.equal(
    classifyTenureTrack({
      college: "The College of the Florida Keys",
      title: "Faculty, English (Key West)",
      description: "Job Type Full Time. The Faculty, English position is a full-time, 10-month Faculty position.",
    }),
    true
  );

  for (const [college, title] of [
    ["Binghamton University", "Assistant Professor in Applied Microeconomics"],
    ["SUNY Polytechnic Institute", "Assistant, Associate, or Full Professor of Robotics"],
    ["Oklahoma Baptist University", "Assistant or Associate Professor of Accounting"],
    ["Rice University", "Assistant Professor of Bioengineering"],
    ["University of Notre Dame", "Assistant Professor in Archaeology"],
    ["The Pennsylvania State University", "Professor in Neurobiology of Insect Chemical Ecology"],
    ["Clemson University", "Assistant Professor - Psychology"],
    ["University of Georgia", "Assistant Professor - Social Studies Education"],
    ["University of Florida", "Assistant/Associate/Full Professor - Pulmonary/Critical Care"],
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college, title }),
      { value: true, evidence: "institution-policy" },
      `${college}: ${title}`
    );
  }

  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "University of North Texas Health Science Center",
      title: "Assistant Professor - Pharmacology & Neuroscience",
    }),
    { value: null, evidence: null }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({ college: "Barry University", title: "Assistant Professor of Law" }),
    { value: null, evidence: null }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Oklahoma Baptist University",
      title: "Core Faculty Member - Doctor of Physical Therapy Program",
    }),
    { value: null, evidence: null }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({ college: "Rice University", title: "Clinical Professor of Medicine" }),
    { value: null, evidence: null }
  );

  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "The University of Texas Health Science Center at Houston",
      title: "Assistant Professor (TT); Center for Health Equity",
    }),
    { value: true, evidence: "institution-policy" }
  );

  // Institution rules stay narrow: the same schools' unqualified ranks can
  // occur on more than one appointment track and must not be guessed.
  for (const college of [
    "Columbia University in the City of New York",
    "University of Miami",
    "Yeshiva University",
    "The University of Texas Health Science Center at Houston",
    "Florida International University",
    "Harrisburg Area Community College",
    "William Rainey Harper College",
    "East Tennessee State University",
    "University of New Hampshire System",
    "University of New Hampshire-Franklin Pierce School of Law",
    "Boise State University",
    "The Catholic University of America",
    "Wayne State University",
    "Lane Community College",
    "Cabrillo College",
    "University of Maryland, Baltimore County",
    "Medical College of Wisconsin",
  ]) {
    assert.equal(classifyTenureTrack({ college, title: "Assistant Professor of Biology" }), null, college);
  }
});

test("recognizes ATS structural metadata (hourly salary, labeled non-tenure Job Type) as a non-tenure signal", () => {
  // NEOGOV/schooljobs.com-style descriptions concatenate labeled fields
  // verbatim -- an hourly rate (rather than an annual salary schedule) is
  // definitional of part-time/adjunct employment, never tenure-track.
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      title: "French (Foreign Languages) Instructor",
      description:
        "French (Foreign Languages) Instructor Applicant Pool Salary $89.24 Hourly Location Santa Clarita, CA Job Type Part-Time Faculty",
    }),
    { value: false, evidence: "description-job-type" }
  );
  for (const description of [
    "Employee category: Part-Time Staff Department: Adult and Continuing Education",
    "Job Category Non-Employee Instructor FVTC Worksite Wisconsin",
    "Work type: Part time Location: Virginia Beach Categories: Faculty & Adjunct",
    "Appointment Type: Part-Time Faculty Position—Humanities",
    "EMPLOYMENT CATEGORY: Seasonal Nursing Lab Instructor",
    "Regular/TemporaryTemporary Position Type Faculty",
    "Compensation is $45 - $60 per hour for teaching assignments",
    "Salary range: $3,000-$3,600 per course",
    "Compensation is $1,420 per credit",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ title: "Instructor", description }),
      { value: false, evidence: "description-job-type" }
    );
  }
  assert.equal(
    classifyTenureTrack({
      title: "Noncredit Business (Non-Vocational) Instructor Applicant Pool",
      description: "Salary $89.24 Hourly Location Santa Clarita, CA Job Type Non-Credit Instructor",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({ description: "Salary $62.16 - $71.40 Hourly Job Type Staff Part Time" }),
    false
  );
  for (const description of [
    "FT/PT Part Time Hours Per Week 20",
    "Full/Part Time: Part-Time Work Schedule evenings",
    "Full Time/Part Time: Part time Union: SEIU",
    "Position Time Status Part-Time Required Education MD",
    "Job Status: Part time Employee Type: Faculty",
    "Position Type Part-Time Department Continuing Education",
    "Time Type: Part time Location Main Campus",
    "Expected Hourly Rate: $23.72 Faculty Regular",
    "FLSA Status: Non-Exempt Pay Basis: Hourly Hiring Range: $23.00",
    "Full or Part-time Part-Time Appointment Type Temporary",
    "Position Type: Seasonal Location: Bemidji, Minnesota",
    "Language VillagesPosition Type:SeasonalLocation:Bemidji, Minnesota",
    "Employment Type Temporary Job Category Instructor Months 3 month",
    "Classification Temporary Minimum Pay $0",
    "Position Type Contracted Part-Time Faculty",
    "Position Type Adjunct Faculty Department Business and Technology",
    "Work type: Adjunct Faculty Location: Denver Categories: Faculty",
    "Work type: Temporary Grant-P14, Full-Time Location: Orangeburg Categories: Faculty",
    "Position Type: PT Hours Per Week 15",
    "Work Schedule: part-time/9-months Department: Arts and Sciences",
    "Job Type: Part-Time Staff Term: Staff Faculty Term: Fall Semester",
    "Job Type Faculty - Part Time, Exempt, Contract based",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ title: "Instructor", description }),
      { value: false, evidence: "description-job-type" },
      description
    );
  }
  assert.equal(classifyTenureTrack({ title: "Faculty Half-Time- UG Healthcare Administration" }), false);
  // A real tenure-track salary schedule (annual, not hourly) is unaffected.
  assert.equal(
    classifyTenureTrack({ description: "Salary $75,000.00 - $95,000.00 Annually Job Type Full-Time Faculty" }),
    null
  );
});

test("recognizes additional labeled appointment-track fields without guessing mixed-track openings", () => {
  const cases = [
    ["Tenure Track Status: No", false],
    ["Faculty Tenure Track Yes", true],
    ["Tenure Track Status: Tenure-Track", true],
    ["Tenure Status Term", false],
    ["Appointment Term Term", false],
    ["Tenure Status Tenure Track", true],
    ["Tenure: Ineligible", false],
    ["Appointment Status Tenure", true],
    ["Faculty Type of Position: Term", false],
    ["Position Category: Faculty - Term Appointment", false],
    ["Appointment Type Time limited", false],
    ["Time Limited Position: Yes", false],
    ["Tenure Track or Non Tenure Track Non Tenure Track", false],
    ["Tenure Track or Non Tenure Track Tenure Track", true],
  ];

  for (const [description, value] of cases) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ description }),
      { value, evidence: "description-structured-field" },
      description
    );
  }

  assert.equal(
    classifyTenureTrack({ description: "This is a career-track teaching appointment with a path for promotion." }),
    false
  );
  assert.equal(
    classifyTenureTrack({ description: "This may be a tenure or career track faculty position depending on qualifications." }),
    null
  );
  assert.equal(
    classifyTenureTrack({ description: "Eligible for application and receipt of continuing appointment (tenure) and promotion." }),
    true
  );
  assert.equal(
    classifyTenureTrack({ description: "Effective End Date (for Limited-Term postings) Job Posting Date 09/11/2026" }),
    null
  );
});

test("recognizes a labeled tenured or tenure-track appointment type", () => {
  assert.equal(
    classifyTenureTrack({
      title: "Open Rank Professor of Political Science",
      description: "Appointment Type Tenured/Tenure Track Vacancy ID FAC0006107",
    }),
    true
  );
});

test("recognizes additional ATS fixed-duration fields", () => {
  for (const description of [
    "Employment Type: Terminal (Fixed Term) Job Profile: Lecturer",
    "Position Status: Limited Term If Limited Term (End Date of Assignment) 06/30/2031",
    "Appointment type Term - 2 Years. This is a term position.",
    "Job Type: Temporary Department: Music",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ title: "Instructor", description }),
      { value: false, evidence: "description-structured-field" },
      description
    );
  }
});

test("recognizes an explicitly capped multi-year appointment term", () => {
  assert.equal(classifyTenureTrack({
    title: "L.E. Dickson Instructor",
    description: "The initial appointment is for a term of up to three years.",
  }), false);
});

test("uses documented unmodified professorial ladders without absorbing qualified ranks", () => {
  for (const [college, title] of [
    ["Southern Illinois University Edwardsville", "Assistant Professor in Painting and Digital Illustration"],
    ["Southern Illinois University Edwardsville", "Assistant/Associate Professor"],
    ["Northern Illinois University", "Associate Professor/Professor and MSW Program Director"],
    ["Mississippi State University", "Assistant/Associate/Professor"],
    ["University of Wyoming", "Asst/Assoc Professor - Communication Disorders"],
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college, title }),
      { value: true, evidence: "institution-policy" },
      `${college}: ${title}`
    );
  }

  for (const [college, title] of [
    ["Southern Illinois University Edwardsville", "Assistant Professor / Clinical Assistant Professor"],
    ["Northern Illinois University", "Assistant Professor of Legal Practice"],
    ["Mississippi State University", "Assistant Research Professor"],
    ["University of Wyoming", "Assistant Librarian - Faculty Support Librarian"],
  ]) {
    assert.equal(classifyTenureTrack({ college, title }), null, `${college}: ${title}`);
  }
});

test("applies SUNY's system-wide academic-rank distinction at state-operated campuses", () => {
  for (const [college, title] of [
    ["University at Albany", "Assistant Professor - School of Criminal Justice"],
    ["Stony Brook University", "Cardiologist, Assistant/Associate/Full Professor, Internal Medicine"],
    ["SUNY Downstate Health Sciences University", "Assistant/Associate Professor (HS), Anatomic Pathology"],
    ["University at Buffalo", "Academic Scholar - Assistant or Associate Professor, Memory Disorders"],
    ["SUNY Oneonta", "Associate Professor and Director: Master of Social Work Program"],
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college, title }),
      { value: true, evidence: "institution-policy" },
      `${college}: ${title}`
    );
  }

  for (const [college, title] of [
    ["Stony Brook University", "Research Assistant Professor of Biology"],
    ["University at Buffalo", "Clinical Assistant Professor GFT"],
  ]) {
    assert.equal(classifyTenureTrack({ college, title }), false, `${college}: ${title}`);
  }
  assert.equal(
    classifyTenureTrack({
      college: "SUNY Old Westbury",
      title: "Assistant Professor - Instructor - Literacy Education",
    }),
    null
  );
});

test("uses Tennessee Tech's rank taxonomy and Clark Atlanta's explicit current searches", () => {
  for (const title of [
    "Assistant or Associate Professor of Accounting",
    "Assistant/Associate/Full Professor - Computer Science",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college: "Tennessee Technological University", title }),
      { value: true, evidence: "institution-policy" },
      title
    );
  }
  for (const title of ["Instructor", "Research Assistant Professor", "Clinical Professor"]) {
    assert.notEqual(classifyTenureTrack({ college: "Tennessee Technological University", title }), true, title);
  }

  for (const title of [
    "Assistant Professor: Mathematical Sciences(075-26)",
    "Assistant Professor: School of Social Work(089-26)",
    "Assistant/Associate Professor: Curriculum and Instruction(113-26)",
    "Associate Professor, Social and Behavioral Scientist 003-26",
    "Assistant/Associate Professor of Finance(103-26)",
    "Assistant/Associate Professor of Marketing(108-26)",
    "Assistant/Associate Professor: Public Administration(140-24)",
    "Associate Professor: Social and Behavior Scientist(001-26)",
    "Department Chair: Physics(078-26)",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college: "Clark Atlanta University", title }),
      { value: true, evidence: "institution-policy" },
      title
    );
  }
  assert.equal(
    classifyTenureTrack({ college: "Clark Atlanta University", title: "Assistant Professor: Film and Digital Media Studies" }),
    null
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Clark Atlanta University",
      title: "Assistant Professor of Research Methods(129-25)",
    }),
    { value: false, evidence: "institution-policy" }
  );
});

test("uses documented Missouri State, Austin Peay, and USF rank taxonomies", () => {
  for (const [college, title] of [
    ["Missouri State University", "Assistant Professor (Early American History) - 9 month appointment"],
    ["Missouri State University", "Assistant Professor, Library (E-Resource & Serials) 12-month appointment"],
    ["Austin Peay State University", "Assistant Professor - Engineering Technology"],
    ["Austin Peay State University", "Assistant Professor, Teaching & Learning"],
    ["University of South Florida", "Assistant-Associate Professor/School of Social Work"],
    ["University of South Florida", "Professor, Chair, Biostatistics and Data Science"],
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college, title }),
      { value: true, evidence: "institution-policy" },
      `${college}: ${title}`
    );
  }

  for (const [college, title] of [
    ["Missouri State University", "Clinical Assistant Professor of Financial Planning"],
    ["University of South Florida", "Research Assistant Professor"],
    ["University of South Florida", "Advanced Assistant Professor of Marketing"],
  ]) {
    assert.notEqual(classifyTenureTrack({ college, title }), true, `${college}: ${title}`);
  }
  assert.deepEqual(
    classifyTenureTrackWithEvidence({ college: "Austin Peay State University", title: "Instructor - Chemistry" }),
    { value: false, evidence: "institution-policy" }
  );
});

test("uses WSCO's current openings categories instead of legacy PDF headings", () => {
  for (const title of [
    "Full-Time Faculty",
    "Advanced Manufacturing and Integration Faculty",
    "Process Engineering Faculty",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college: "Washington State College of Ohio", title }),
      { value: false, evidence: "institution-policy" },
      title
    );
  }
  assert.equal(
    classifyTenureTrack({ college: "Washington State College of Ohio", title: "Electrical Engineering Faculty" }),
    false
  );
});

test("uses newly verified institution-specific appointment policies", () => {
  for (const title of [
    "Assistant Professor of Psychology",
    "Assistant/Associate Professor of Speech-Language Pathology",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Nevada State University", title }), true, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "Nevada State University", title: "Lecturer of Human Health Sciences" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "Radford University", title: "Instructor, Special Purpose - Nursing" }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "Oklahoma State University Center for Health Sciences",
      title: "Clinical Assistant Professor - Emergency Medicine",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "Western Oregon University", title: "Instructional Faculty, Linguistics" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "Louisiana Tech University", title: "Lecturer, Chemistry" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "St. Mary's College of Maryland", title: "Assistant Professor of Economics" }),
    true
  );
  assert.equal(
    classifyTenureTrack({ college: "University of Connecticut-Avery Point", title: "Instructor in Residence - Stamford" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "UC Irvine", title: "Assistant Professor of Teaching" }),
    true
  );
});

test("uses Menlo's explicitly fixed three-year searches", () => {
  for (const title of [
    "Assistant Professor of Biology",
    "Assistant Professor of Entrepreneurship and International Business",
    "Assistant Professor of Latino Studies",
    "Assistant Professor of Sports Management",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college: "Menlo College", title }),
      { value: false, evidence: "institution-policy" },
      title
    );
  }
  assert.equal(classifyTenureTrack({ college: "Menlo College", title: "Assistant Professor of Chemistry" }), null);
});

test("uses Syracuse, Northwestern Law, and Divine Word appointment policies", () => {
  assert.equal(
    classifyTenureTrack({ college: "Syracuse University", title: "Assistant Professor of Supply Chain Management" }),
    true
  );
  for (const title of [
    "Assistant Teaching Professor- School Psychology",
    "Associate Teaching Professor; Clinic Director - Low Income Taxpayer Clinic",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Syracuse University", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "Northwestern University", title: "Open-rank Clinical Professor of Law" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "Northwestern University", title: "Assistant Professor, Finance" }),
    null
  );
  assert.equal(
    classifyTenureTrack({ college: "Divine Word College", title: "Assistant Professor of Theology" }),
    false
  );
});

test("uses documented teaching-faculty ladders at NKU, ECU, and Marquette", () => {
  for (const [college, title] of [
    ["Northern Kentucky University", "Assistant Teaching Professor - APRN Core"],
    ["East Carolina University", "Teaching Instructor, Senior Teaching Instructor, Master Teaching Instructor, Teaching Assistant Professor, Teaching Associate Professor, or Teaching Professor"],
    ["Marquette University", "Teaching Assistant Professor - Psychology"],
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college, title }),
      { value: false, evidence: "institution-policy" },
      `${college}: ${title}`
    );
  }
});

test("uses exact Marquette and NCCU senior searches plus NCCU's clinical ladder", () => {
  assert.equal(
    classifyTenureTrack({ college: "Marquette University", title: "Schneider Endowed Distinguished Professor- Psychology" }),
    true
  );
  assert.equal(
    classifyTenureTrack({ college: "North Carolina Central University", title: "Clinical Assistant/Associate Professor" }),
    false
  );
  for (const title of ["Director of JLC-BBRI/Professor", "Professor"]) {
    assert.equal(classifyTenureTrack({ college: "North Carolina Central University", title }), true, title);
  }
});

test("uses description-gated and no-tenure community-college policies", () => {
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Kansas City Kansas Community College",
      title: "Automation Engineer Technology Instructor",
      description: "Department:Automation Engineer TechnologyType:Full-Time FacultyLocation:Main Campus",
    }),
    { value: true, evidence: "institution-policy" }
  );
  for (const description of [
    "Department:Adult Education Type:Full-Time StaffLocation:Main Campus",
    "Department:Music Type:Adjunct FacultyLocation:Main Campus",
    "",
  ]) {
    assert.equal(
      classifyTenureTrack({
        college: "Kansas City Kansas Community College",
        title: "Program Instructor",
        description,
      }),
      null,
      description
    );
  }

  assert.equal(
    classifyTenureTrack({ college: "Saint Louis Community College", title: "Faculty - CIT Cybersecurity" }),
    false
  );
  assert.equal(classifyTenureTrack({ college: "Odessa College", title: "Biology Faculty" }), false);
  for (const college of [
    "Kansas City University",
    "Johnson & Wales University-Providence",
    "Charles R Drew University of Medicine and Science",
    "Savannah College of Art and Design",
    "Excelsior University",
    "BridgeValley Community & Technical College",
    "J Sargeant Reynolds Community College",
    "Northern Virginia Community College",
    "Paris Junior College",
    "East Arkansas Community College",
    "Wiregrass Georgia Technical College",
    "Baltimore City Community College",
    "Azusa Pacific University",
    "Tusculum University",
    "Rust College",
    "Wayland Baptist University",
    "Baptist Health Sciences University",
    "Samuel Merritt University",
    "Navajo Technical University",
    "Central Texas College",
    "Oconee Fall Line Technical College",
    "Texas Southmost College",
    "Highland Community College (KS)",
    "North Georgia Technical College",
    "Harrisburg University of Science and Technology",
    "Arizona Western College",
    "Howard Community College",
    "Southern Arkansas University Tech",
    "NorthWest Arkansas Community College",
    "Butler Community College",
    "Houston Christian University",
    "University of Mary",
    "Blinn College District",
    "Oklahoma State University Institute of Technology",
    "William Carey University",
    "Grace College and Theological Seminary",
    "Palm Beach Atlantic University",
    "Brenau University",
    "Northwest Indian College",
    "Lynn University",
    "North Central State College",
    "Central Pennsylvania Institute of Science and Technology",
    "Thomas University",
    "Franklin Pierce University",
    "Lees-McRae College",
    "Webber International University",
    "Navarro College",
    "Columbus Technical College",
    "Culinary Institute of America",
    "Dine College",
    "American Musical and Dramatic Academy",
    "Ogeechee Technical College",
    "Southern Crescent Technical College",
    "Nebraska Methodist College of Nursing & Allied Health",
    "Tyler Junior College",
    "Central Baptist College",
    "Paul D Camp Community College",
    "Genesee Community College",
    "William R Moore College of Technology",
    "Aaniiih Nakoda College",
    "A T Still University of Health Sciences",
    "Trine University",
    "Hazelden Betty Ford Graduate School",
    "Felician University",
    "Husson University",
    "California University of Science and Medicine",
    "Keck Graduate Institute",
    "Lindenwood University",
    "Ilisagvik College",
    "Gogebic Community College",
    "West Georgia Technical College",
    "Bob Jones University",
    "Nueta Hidatsa Sahnish College",
    "Sitting Bull College",
    "Southeastern Technical College",
    "Central Wyoming College",
    "Eastern Maine Community College",
    "Columbia International University",
    "Northeast College of Health Sciences",
    "University of Valley Forge",
    "Keweenaw Bay Ojibwa Community College",
    "Mott Community College",
    "Arkansas State University Mid-South",
    "Clark State College",
    "Clarkson College",
    "Tidewater Community College",
    "Central Arizona College",
    "Lehigh Carbon Community College",
    "Bryant & Stratton College-Online",
    "Western Governors University",
    "Ave Maria University",
    "Tulsa Community College",
    "Heritage University",
    "Roseman University of Health Sciences",
    "Pfeiffer University",
    "Southern Nazarene University",
    "River Valley Community College",
    "Adler University",
    "Alabama College of Osteopathic Medicine",
    "Clarendon College",
    "Hinds Community College",
    "Northeast Wisconsin Technical College",
    "Kansas Health Science University",
    "Hawkeye Community College",
    "Geisinger Commonwealth School of Medicine",
    "Northeast Community College",
    "Southeast Technical College",
    "Shorter College",
    "Northcentral Technical College",
    "Washington County Community College",
    "Lee College",
    "Herzing University-Minneapolis",
    "Central Community College",
    "Villa Maria College",
    "Albizu University-Miami",
    "Eastern Iowa Community College District",
    "MGH Institute of Health Professions",
    "Franciscan Missionaries of Our Lady University",
    "Luna Community College",
    "Bushnell University",
    "Northwest State Community College",
    "University of Northwestern Ohio",
    "Gwinnett Technical College",
    "Northwood University",
    "Coahoma Community College",
    "Seward County Community College",
    "Virginia Western Community College",
    "Southwest Wisconsin Technical College",
    "Cleveland Institute of Music",
    "Westminster University (Utah)",
    "Endicott College",
    "College of the Ozarks",
    "Gateway Community and Technical College",
    "Pomeroy College of Nursing at Crouse Hospital",
    "Clovis Community College (NM)",
    "San Juan College",
    "Trinity Valley Community College",
    "The Master's University and Seminary",
    "Haskell Indian Nations University",
    "Umpqua Community College",
    "Blue Ridge Community College",
    "Oklahoma Wesleyan University",
    "National Park College",
    "Hannibal-LaGrange University",
    "Oklahoma City Community College",
    "Hackensack Meridian School of Medicine",
    "Clinton College",
    "Goldey-Beacom College",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college, title: "Assistant Professor or Instructor" }),
      { value: false, evidence: "institution-policy" },
      college
    );
  }
  assert.equal(
    classifyTenureTrack({ college: "Lake Land College", title: "Medical Coding/Health Information Instructor" }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      college: "Lake Land College",
      title: "Correctional Automotive Technology Instructor at Graham Correctional Center",
    }),
    false
  );
});

test("uses current Ohio, Georgia, and Mississippi named non-tenure series", () => {
  for (const title of [
    "Open Rank- Clinical Faculty in Pediatric Cardiology",
    "Open Rank- Clinical Faculty in Radiology and Imaging",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Augusta University", title }), false, title);
  }

  for (const college of ["Miami University-Hamilton", "Miami University-Middletown"]) {
    assert.equal(classifyTenureTrack({ college, title: "Assistant Teaching Professor" }), false, college);
    assert.equal(classifyTenureTrack({ college, title: "Assistant Professor - Finance" }), null, college);
  }

  for (const title of [
    "Instructor of Nursing",
    "Assistant Teaching Professor or Instructor of Forensic Science",
  ]) {
    assert.equal(classifyTenureTrack({ college: "University of Southern Mississippi", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "University of Southern Mississippi", title: "Assistant Professor of Biology" }),
    null
  );

  for (const title of [
    "Clinical Faculty, Doctoral Program in Clinical Psychology (Psy.D.)",
    "Clinical Instructional Faculty - Physician Assistant Program",
    "Lecturer, Department of Information Systems and Analytics",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Bryant University", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "Bryant University", title: "Assistant Professor, Global Supply Chain Management" }),
    null
  );

  assert.equal(
    classifyTenureTrack({
      college: "The University of Texas Health Science Center at Houston",
      title: "Psychiatrist- Outpatient Adult (Clinical Faculty)",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "The University of Texas Health Science Center at San Antonio",
      title: "Research Faculty Position",
    }),
    false
  );

  assert.equal(
    classifyTenureTrack({ college: "UMass Dartmouth", title: "Assistant Teaching Professor & Director of Bar Success" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "Georgetown University", title: "Assistant Teaching Professor of Spanish" }),
    false
  );
  for (const title of [
    "Assistant or Associate Clinical Professor - Simulation Faculty",
    "Assistant, Associate, or Full Teaching Professor of Health Sciences",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Drexel University", title }), false, title);
  }
  for (const title of [
    "Assistant Teaching Professor of Electrical and Computer Engineering",
    "Head Coach of Baseball/WPE Instructor",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Worcester Polytechnic Institute", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "Worcester Polytechnic Institute", title: "Assistant Professor of Teaching" }),
    null
  );

  for (const title of [
    "Assistant or Associate Professor - Criminal Justice",
    "Assistant/Associate Professor - Criminal Justice",
    "Associate Professor or Professor and Chair - Psychology",
    "Associate Professor/Professor & Chairperson - Visual & Performing Arts",
    "Associate Professor/Professor and Graduate Program Director for Criminal Justice",
  ]) {
    assert.equal(classifyTenureTrack({ college: "North Carolina A&T State University", title }), true, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "North Carolina A&T State University", title: "News and Record-Janice Byrant Howroyd Endowed Professor" }),
    null
  );

  assert.equal(
    classifyTenureTrack({
      college: "University of Nebraska Medical Center",
      title: "Retina/Uveitis Specialist - Faculty Rank DOQ",
      description: "Appointment Type P1 - REG HLTH FAC SAL Salary Range Salary Commensurate with Experience",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      college: "University of Nebraska Medical Center",
      title: "Academic EM Physician/Faculty Rank DOQ",
      description: "Appointment Type DOQ - DEPENDS ON QUALS Salary Range Salary Commensurate with Experience",
    }),
    null
  );

  assert.equal(
    classifyTenureTrack({
      college: "Troy University",
      title: "Lecturer/Assistant/Associate Professor",
      description: "Job Summary The Lecturer/Assistant/Associate Professor position in the Department of Counseling is a tenure-track faculty position.",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      college: "Troy University",
      title: "Lecturer/Assistant/Associate Professor",
      description: "Job Summary The Lecturer in Counselor Education is a non tenure track instructional faculty position with primary responsibility for teaching.",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "Troy University",
      title: "Lecturer/Assistant/Associate Professor",
      description: "Is this position tenure track or non-tenure track? Dependent on selected rank.",
    }),
    null
  );

  assert.equal(
    classifyTenureTrack({ college: "Mississippi State University", title: "Instructor I, II, or III" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "UMass Amherst", title: "Lecturer in Public Relations (100%)" }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "UMass Boston",
      title: "Department Chair and Associate/Full Professor EHS",
      description: "The college invites qualified individuals to apply for a tenure-system Associate or Full Professor to serve as Chair.",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({ college: "UMass Boston", title: "Simulation Lab Faculty A" }),
    null
  );

  for (const title of [
    "Biology (Assistant Professor - two positions) posted",
    "Counseling and Instructional Sciences (Assistant Professor of Counseling) posted",
    "Health, Kinesiology and Sport (Assistant or Associate Professor of Exercise Science - 2 positions) posted",
    "History (Assistant Professor of Early U.S./Public History) posted",
    "Leadership and Teacher Education (Assistant or Associate Professor of Educational Leadership (Higher Education Leadership) posted",
    "Physical Therapy (Assistant or Associate Professor) posted",
    "Speech Pathology and Audiology (Assistant Professor of Speech-Language Pathology) posted",
    "Theatre and Dance (Assistant Professor of Theatre) posted",
  ]) {
    assert.equal(classifyTenureTrack({ college: "University of South Alabama", title }), true, title);
  }
  for (const title of [
    "Counseling and Instructional Sciences (Assistant or Associate Professor of Instructional Design and Development) posted",
    "Leadership and Teacher Education (Department Chair & Associate Professor or Full Professor) posted",
    "Mathematics and Statistics (Assistant Professor of Mathematics) posted",
  ]) {
    assert.equal(classifyTenureTrack({ college: "University of South Alabama", title }), null, title);
  }
});

test("uses Auburn's published tenure-track and non-tenure title map", () => {
  for (const title of [
    "Assistant Professor, Public History (U.S.)",
    "Professor, Associate Professor, Assistant Professor - Industrial and Systems Engineering",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Auburn University", title }), true, title);
  }
  for (const title of ["Clinical Assistant Professor", "Research Associate Professor", "Lecturer of Mathematics"]) {
    assert.equal(classifyTenureTrack({ college: "Auburn University", title }), false, title);
  }
});

test("uses AUM's explicit current postings and clinical-faculty policy", () => {
  for (const title of ["Assistant or Associate Professor in Accounting", "Assistant Professor, Biology"]) {
    assert.equal(classifyTenureTrack({ college: "Auburn University at Montgomery", title }), true, title);
  }
  for (const title of [
    "Assistant Clinical/Associate Clinical Professor",
    "Clinical Assistant Professor of Social Work",
    "Mathematics Lecturer",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Auburn University at Montgomery", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({
      college: "Auburn University at Montgomery",
      title: "Assistant/Associate Professor or Assistant Clinical/Associate Clinical Professor",
    }),
    null
  );
});

test("uses Georgia Tech's published academic-rank split", () => {
  for (const title of [
    "Assistant Professor",
    "Associate/Full Professor-Cybersecurity Policy",
    "Professor (Endowed Chair & GRA Eminent Scholar)",
    "Professor - Biomedical Engineering, Georgia Research Alliance (GRA) Eminent Scholar",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Georgia Institute of Technology-Main Campus", title }), true, title);
  }
  assert.equal(
    classifyTenureTrack({
      college: "Georgia Institute of Technology-Main Campus",
      title: "Executive Director, IRIM - Open Rank/Title Academic/Research Faculty",
    }),
    null
  );
  assert.equal(
    classifyTenureTrack({ college: "Georgia Institute of Technology-Main Campus", title: "Principal Lecturer" }),
    false
  );
});

test("uses Harding's fixed-term new-faculty appointment system", () => {
  for (const title of [
    "College of Arts and Sciences - Department of Computer Science (Computer Science Faculty)",
    "College of Business Administration - Accounting Faculty",
    "College of Allied Health - Physician Assistant Program Faculty",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Harding University", title }), false, title);
  }
});

test("uses Columbia's named non-tenure series and Hampton's exact research-only term search", () => {
  for (const title of [
    "Lecturer in Hebrew",
    "Faculty All Ranks - Clinical: Instructor/Assistant Professor/Associate Professor",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Columbia University in the City of New York", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({
      college: "Columbia University in the City of New York",
      title: "Lecturer, Instructor, or Assistant Professor",
    }),
    null
  );
  assert.equal(
    classifyTenureTrack({ college: "Hampton University", title: "Faculty Position in Climate Science" }),
    false
  );
  assert.equal(classifyTenureTrack({ college: "Hampton University", title: "Assistant Professor of Psychology" }), null);
});

test("uses Bowling Green's qualified-rank taxonomy and TTIC's research-faculty definition", () => {
  assert.equal(
    classifyTenureTrack({ college: "Bowling Green State University-Main Campus", title: "Assistant Teaching Professor" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "Toyota Technological Institute at Chicago", title: "Research faculty" }),
    false
  );
});

test("uses Princeton's official ladder and lecturer rank taxonomy", () => {
  for (const title of [
    "Assistant Professor",
    "Assistant Professor, Associate Professor",
    "Associate Professor or Professor",
    "Professor in Plasma Physics",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Princeton University", title }), true, title);
  }

  for (const title of ["Lecturer", "Lecturer in English", "University Lecturer"]) {
    assert.equal(classifyTenureTrack({ college: "Princeton University", title }), false, title);
  }

  assert.equal(
    classifyTenureTrack({ college: "Princeton University", title: "Visiting Assistant Professor" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "Princeton University", title: "Research Assistant Professor" }),
    null
  );
});

test("uses the University of Hawai‘i non-tenure Lecturer category at Windward CC", () => {
  for (const title of [
    "Lecturer CC (Pacific Studies) - Fall2024/Spring 2025/Summer 2025",
    "Lecturer, CC (Astronomy) - Fall2024/Spring 2025/Summer2025",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Windward Community College", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "Windward Community College", title: "Assistant Professor of Biology" }),
    null
  );
});

test("uses Stanford's explicitly named non-tenure faculty lines without guessing mixed medical searches", () => {
  for (const title of [
    "Assistant Professor, University Medical Line, Dept of Cardiothoracic Surgery",
    "Clinical Assistant Professor, Stanford Dermatology",
    "Pediatrics CVICU Hospitalist Clinical Instructor or Clinical Assistant Professor",
    "Assistant, Associate or Full Professor of Ophthalmology (Research)",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Stanford University", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "Stanford University", title: "Pediatric Radiology Faculty Position" }),
    null
  );
  assert.equal(
    classifyTenureTrack({ college: "Stanford University", title: "Clinician Scientist - Assistant Professor" }),
    null
  );
  assert.equal(classifyTenureTrack({
    college: "Stanford University",
    title: "Faculty Position in Early Learning: Mechanisms and Interventions",
    description: "Stanford University University Tenure Line Opening at: Aug 11 2026",
  }), true);
  assert.equal(classifyTenureTrack({
    college: "Stanford University",
    title: "Mixed-Line Faculty Search",
    description: "Stanford University Non-Tenure Line (Research) University Medical Line University Tenure Line Opening at: Aug 11 2026",
  }), null);
});

test("uses UChicago's Other Academic Appointment rank names", () => {
  for (const title of [
    "Assistant Instructional Professor, Fundamentals: Issues & Texts",
    "Research Assistant Professors – Hematology/Oncology",
    "Research Associate Professor – Pediatric Genetics",
    "Lecturer, Graham School",
  ]) {
    assert.equal(classifyTenureTrack({ college: "University of Chicago", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "University of Chicago", title: "Assistant Professor in Astronomy & Astrophysics" }),
    null
  );
  assert.equal(
    classifyTenureTrack({ college: "University of Chicago", title: "Assistant Professor School of Medicine Track – Cancer Research" }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "University of Chicago",
      title: "Faculty Scientist – Cellular Therapy",
      description: "The successful candidate will be appointed on the School of Medicine track.",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "University of Chicago",
      title: "Faculty Scientist – Cellular Therapy",
      description: "Academic rank and track will be determined by experience.",
    }),
    null
  );
});

test("uses Columbia's explicitly term-limited Instructor and practice ranks", () => {
  for (const title of [
    "Instructor in Neurology",
    "Optometrist (Instructor in Optometric Sciences)",
    "Professor in the Practice of International and Public Affairs",
  ]) {
    assert.equal(
      classifyTenureTrack({ college: "Columbia University in the City of New York", title }),
      false,
      title
    );
  }
  assert.equal(
    classifyTenureTrack({
      college: "Columbia University in the City of New York",
      title: "Lecturer, Instructor, or Assistant Professor",
    }),
    null
  );
});

test("uses Lamar Institute of Technology's current all-new-hires non-tenure policy", () => {
  for (const title of [
    "Accounting Instructor",
    "Instructor, Electrical Technology",
    "Speech Instructor",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Lamar Institute of Technology", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "Lamar University", title: "Accounting Instructor" }),
    null
  );
});

test("uses Lake Land's correctional-faculty category without absorbing campus instructors", () => {
  assert.equal(
    classifyTenureTrack({ college: "Lake Land College", title: "Correctional Automotive Technology Instructor at Graham Correctional Center" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "Lake Land College", title: "Nursing Instructor" }),
    null
  );
});

test("uses Monroe Community College's exact current appointment descriptions", () => {
  assert.equal(
    classifyTenureTrack({ college: "Monroe Community College", title: "Faculty, Full-Time - Nursing (Maternal & Neonatal)" }),
    true
  );
  assert.equal(
    classifyTenureTrack({ college: "Monroe Community College", title: "Faculty, Full-time, Electrical Engineering Technology" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "Monroe Community College", title: "Coordinator II/Instructor, Healthcare Programs" }),
    null
  );
});

test("uses Ohio State's named fixed-term and associated faculty categories", () => {
  for (const title of [
    "Professional-Practice Assistant Professor in Journalism",
    "Veterinary Clinical Sciences Instructor - Practice - LOCUM",
    "Doctor of Nursing Practice and Master of Healthcare Innovation Faculty College of Nursing",
    "Faculty Director of Academic Excellence",
    "Veterinary Curriculum Instructors",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Ohio State University", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "Ohio State University", title: "Physician - Open Rank/Track Faculty" }),
    null
  );
});

test("uses UT Austin's professional-track faculty title series", () => {
  for (const title of [
    "Assistant Professor of Instruction & Program Manager, Communication for Engineering Students",
    "Clinical Assistant/Associate Professor in Psychology",
    "Management Lecturer - Business Communication",
    "Research Assistant/Research Associate Professor",
    "Seismologist - Research Assistant Professor",
  ]) {
    assert.equal(classifyTenureTrack({ college: "University of Texas at Austin", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "University of Texas at Austin", title: "Assistant Professor - Sociology" }),
    null
  );
});

test("uses FAU Medicine's clinical tracks for exact current clinical searches", () => {
  for (const title of [
    "Cardiologist - Assistant/Associate/Full Professor",
    "Gastroenterologist - Assistant/Associate/Full Professor",
    "General Psychiatry (Assistant/Associate/Full Professor)",
    "Orthopedic Surgeon - Assistant/Associate/Full Professor",
    "Program Director, Psychiatry Residency (Associate Professor/Full Professor)",
    "Surgery Clerkship Director (Assistant Professor/Associate Professor/Full Professor)",
    "Urologist - Assistant/Associate/Full Professor",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Florida Atlantic University", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "Florida Atlantic University", title: "Artificial Intelligence in Medicine – Assistant/ Associate/ Full Professor" }),
    null
  );
});

test("uses UAB's non-tenure Instructor rank and exact UTHSA appointment claims", () => {
  for (const title of [
    "Heersink School of Medicine-Clinical Instructor-Nephrology",
    "School of Medicine- Instructor - Neurosurgery- (02)",
  ]) {
    assert.equal(classifyTenureTrack({ college: "University of Alabama at Birmingham", title }), false, title);
  }
  assert.equal(
    classifyTenureTrack({
      college: "The University of Texas Health Science Center at San Antonio",
      title: "Open Rank Research Nursing Faculty Position",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      college: "The University of Texas Health Science Center at San Antonio",
      title: "Open Rank Teaching Faculty",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "The University of Texas Health Science Center at San Antonio",
      title: "Dept of Predoctoral Dental Education -Division of General Dentistry - Open Rank - (Clinical Assistant, Associate or Professor)",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "The University of Texas Health Science Center at San Antonio",
      title: "Open Rank Faculty Position in Cancer Research",
    }),
    true
  );
  for (const title of [
    "CPTAR - Open Rank (Assistant/Associate/Professor)",
    "Center Director - Center for Regenerative Sciences - Open Rank (Associate Professor/Professor)",
    "Chair - Associate Professor or Professor",
    "Open Rank Faculty in Pediatric Cancer",
    "Open Rank Faculty Position",
    "Associate Professor & Chair",
    "Associate Professor or Professor (Open Rank) and Vice Chair",
  ]) {
    assert.equal(
      classifyTenureTrack({ college: "The University of Texas Health Science Center at San Antonio", title }),
      true,
      title
    );
  }
  assert.equal(
    classifyTenureTrack({
      college: "The University of Texas Health Science Center at San Antonio",
      title: "Open Rank Faculty Position in Pharmacology",
    }),
    null
  );
});

test("uses South Alabama's separate Instructor Track without guessing professorial ranks", () => {
  assert.equal(
    classifyTenureTrack({ college: "University of South Alabama", title: "Instructor in UTeach" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "University of South Alabama", title: "Assistant Professor of Mathematics" }),
    null
  );
});

test("uses current institution vacancy pages for exact tenure-track searches", () => {
  for (const title of [
    "Department of Chinese - Assistant Professor",
    "Department of Studio Art - Assistant Professor",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Middlebury College", title }), true, title);
  }

  for (const title of [
    "Assistant Professor - Child Development and Family Science",
    "Assistant Professor Biochemistry",
    "Assistant Professor of Information Technology Management",
    "Associate Professor or Full Professor/ Department Chair - Engagement and Outreach Librarian",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Central Washington University", title }), true, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "Central Washington University", title: "Lecturer Pool - Accounting" }),
    false
  );

  for (const title of [
    "Assistant Professor of Biology",
    "Assistant Professor of Politics",
  ]) {
    assert.equal(classifyTenureTrack({ college: "Whitman College", title }), true, title);
  }
  assert.equal(
    classifyTenureTrack({ college: "Whitman College", title: "Visiting Assistant Professor of Economics" }),
    false
  );
});

test("uses explicit appointment qualifiers in the direct posting filename as a final fallback", () => {
  const cases = [
    ["https://example.edu/jobs/Assistant-Professor--Non-tenure-Track_R0007906", false],
    ["https://example.edu/files/Adjunct%20Music%20Instructors%2006.26.pdf", false],
    ["https://example.edu/files/English_Instructor_PT_07.26.pdf", false],
    ["https://example.edu/files/Nursing_Instructor_FT_Temp_08.26.pdf", false],
    ["https://example.edu/jobs/new-testament-biblical-studies-tenure-track-faculty/85013131", true],
  ];

  for (const [url, value] of cases) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ title: "Faculty", url }),
      { value, evidence: "source-url-explicit" },
      url
    );
  }

  // Parent directories, fragments, and query parameters are not posting-title
  // evidence, and a direct description always outranks a possibly stale slug.
  assert.equal(classifyTenureTrack({ url: "https://adjunct.example.edu/part-time/jobs/123?type=adjunct#tenure-track" }), null);
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      description: "This is a tenure-track appointment.",
      url: "https://example.edu/jobs/old-adjunct-faculty-slug",
    }),
    { value: true, evidence: "description-explicit" }
  );
});

test("leaves conflicting appointment language unclassified", () => {
  assert.equal(classifyTenureTrack({
    description: "Depending on qualifications, appointment may be eligible for tenure or without tenure.",
  }), null);
});

test("classifies current Lamar State College-Port Arthur hires after tenure ended", () => {
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Lamar State College-Port Arthur",
      title: "Instructor, Process Technology",
    }),
    { value: false, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({
      college: "Lamar State College-Orange",
      title: "Instructor, Process Technology",
    }),
    null
  );
});

test("uses current ECSU, Daytona State, and Minnesota State appointment paths", () => {
  assert.equal(classifyTenureTrack({ college: "Elizabeth City State University", title: "Assistant/Associate Professor" }), true);
  assert.equal(classifyTenureTrack({ college: "Elizabeth City State University", title: "Visiting Assistant Professor" }), false);
  assert.equal(classifyTenureTrack({ college: "Daytona State College", title: "Faculty, Nursing" }), true);
  assert.equal(classifyTenureTrack({
    college: "Southwest Minnesota State University",
    title: "Assistant Professor of Accounting - State University Faculty",
    description: "Employment Condition: Unclassified - Unlimited Academic",
  }), true);
  assert.equal(classifyTenureTrack({
    college: "Southwest Minnesota State University",
    title: "Assistant Professor of Accounting - State University Faculty",
    description: "Employment Condition: Unclassified - Limited Academic (Fixed Term)",
  }), false);
  assert.equal(classifyTenureTrack({
    college: "Normandale Community College",
    title: "Instructor - Chemistry",
    description: "Employment Condition: Unclassified - Unlimited Academic",
  }), true);
  assert.equal(classifyTenureTrack({
    college: "Normandale Community College",
    title: "Instructor - Chemistry",
    description: "Employment Condition: Unclassified - Limited Academic (Fixed Term)",
  }), false);
  assert.equal(classifyTenureTrack({
    college: "Normandale Community College",
    title: "Instructor - Chemistry",
  }), null);
});

test("uses verified clinical and research title series at current institutions", () => {
  for (const [college, title] of [
    ["Columbia University in the City of New York", "Assistant/Associate Professor of Medicine of the CUMC"],
    ["University of Missouri-Kansas City", "ASSISTANT/ASSOCIATE CLINICAL PROFESSOR of Acute Care"],
    ["University of Missouri-Kansas City", "CLINICAL INSTRUCTOR Dental Hygiene"],
    ["University of Minnesota", "Clinical Assistant or Associate Professor"],
    ["University of Montana", "Clinical Assistant or Associate Professor of Medicine"],
    ["Seattle University", "Assistant Clinical Professor, Counseling"],
    ["Moravian University", "Assistant Clinical Professor, Maternal and Child Health"],
    ["University of Chicago", "Clinical Instructors, Neurological Surgery"],
    ["University of Chicago", "Research Assistant/Associate Professor in Nuclear Medicine Instrumentation"],
    ["Northern Arizona University", "Assistant Clinical Professor, Occupational Therapy"],
    ["Georgia State University", "Clinical Assistant Professor of Audiology"],
    ["Georgia State University", "Lecturer or Senior Lecturer - Computer Science"],
    ["University of Rhode Island", "Clinical Assistant Professor of Clinical Practice — Psychology"],
    ["Idaho State University", "Clinical Assistant Professor, Audiology Program"],
    ["Idaho State University", "Clinical Instructor, Computer Aided Design Drafting"],
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college, title }),
      { value: false, evidence: "institution-policy" },
      `${college}: ${title}`
    );
  }

  assert.equal(classifyTenureTrack({
    college: "University of Missouri-Kansas City",
    title: "ASSISTANT/ASSOCIATE CLINICAL PROFESSOR or TT ASSISTANT PROFESSOR",
  }), null);
  assert.equal(classifyTenureTrack({
    college: "High Point University",
    title: "Open Rank Faculty Position in Multimedia Journalism and Sports Media",
    description: "This is a nine month renewable contract appointment.",
  }), false);
  assert.equal(classifyTenureTrack({
    college: "High Point University",
    title: "Open Rank Professor of Mechanical Engineering",
  }), null);
  assert.equal(classifyTenureTrack({
    college: "Idaho State University",
    title: "Assistant Professor of Clinical Psychology, PsyD Program",
  }), null);
});

test("treats summer-only instructor searches as non-tenure appointments", () => {
  assert.equal(classifyTenureTrack({ title: "Primary Instructor for 2026 Summer Language Institute" }), false);
  assert.equal(classifyTenureTrack({ title: "Summer 2026 Primary Instructors" }), false);
});

test("uses continuing-contract and exact with-tenure posting evidence", () => {
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "St Petersburg College",
      title: "Nursing Faculty",
      description: "Full/Part TimeFull-Time Regular/TemporaryRegular",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.equal(classifyTenureTrack({
    college: "St Petersburg College",
    title: "Adjunct Nursing Faculty",
    description: "Full/Part TimePart-Time Regular/TemporaryTemporary",
  }), false);

  for (const [title, description] of [
    ["Associate Professor - Ph.D. Program in Philosophy", "The program seeks a scholar at the level of Associate Professor with tenure."],
    ["Associate Professor - Ph.D. Program in Theatre and Performance", "The Graduate Center seeks an Associate Professor with tenure to begin in Fall 2027."],
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college: "CUNY Graduate School and University Center", title, description }),
      { value: true, evidence: "institution-policy" }
    );
  }
});

test("uses additional verified clinical-faculty ladders", () => {
  for (const [college, title] of [
    ["University of Evansville", "Clinical Assistant Professor of Nursing"],
    ["Keene State College", "Clinical Assistant Professor, Safety and Construction Sciences"],
    ["Howard University", "Clinical Associate Professor"],
    ["University of Missouri", "Clinical Instructor, Emergency Veterinary Medicine"],
    ["Northeastern State University", "F99593 Clinical Assistant Professor Occupational Therapy"],
    ["University of Texas Southwestern Medical Center", "Clinical Assistant Professor - Department of Physical Medicine & Rehabilitation"],
    ["Icahn School of Medicine at Mount Sinai", "Clinical Assistant Professor - Mount Sinai Phillips School of Nursing"],
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college, title }),
      { value: false, evidence: "institution-policy" },
      `${college}: ${title}`
    );
  }
});

test("recognizes a labeled temporary status and UNE's structured clinical track", () => {
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      title: "Research Professor, Arctic Studies",
      description: "Temporary or Permanent: Temporary Relocation Authorized: No",
    }),
    { value: false, evidence: "description-job-type" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "University of New England",
      title: "Associate Dean, Academic Affairs",
      description: "Position Type Faculty Faculty Track Clinical Position Title Associate Dean, Academic Affairs",
    }),
    { value: false, evidence: "institution-policy" }
  );
});

test("uses verified teaching-professor and lecturer appointment structures", () => {
  for (const [college, title] of [
    ["University of Wisconsin-Green Bay", "Assistant Teaching Professor of Human Biology"],
    ["University of Wisconsin-Stevens Point", "Teaching Professor with Assistant Rank: Media Studies"],
    ["University of Wisconsin-Superior", "Teaching Assistant Professor of Social Work"],
    ["Iowa State University", "Assistant Teaching Professor in Art Education"],
    ["University of Missouri", "Assistant/Associate/Full Teaching Professor – Radiochemical Manufacturing"],
    ["Brandeis University", "Lecturer in History (Modern European History)"],
    ["Texas Tech University", "Lecturer - 9 mo appt - Interior Design"],
    ["Drexel University", "Open Rank Teaching Faculty"],
    ["St. Mary's College of Maryland", "Lecturer of Art History and Museum Studies"],
    ["Bentley University", "Lecturer, Accounting"],
    ["Miami University-Oxford", "Assistant Teaching Professor"],
    ["Miami University-Oxford", "Assistant/Associate Teaching Professor or Associate Lecturer - Paper Science and Engineering"],
    ["Auburn University at Montgomery", "Lecturer of Theatre"],
    ["Texas Christian University", "Assistant Professor of Professional Practice in Counseling - of Education"],
    ["Texas Christian University", "Director of the Institute of Ranch Management and Associate Professor of Professional Practice in Ranch Management - of Science & Engineering"],
    ["Texas Christian University", "Instructor of Entrepreneurship and Innovation - of Entrepreneurship and Innovation at Texas Christian Univers"],
    ["Colorado State University Pueblo", "Lecturer of Nursing"],
    ["The University of Texas Permian Basin", "Lecturer, Department of Counseling"],
    ["Hollins University", "CHEMISTRY: Assistant Teaching Professor of Chemistry"],
    ["Lee University", "Lecturer in Graphic Design and Illustration"],
    ["Saint Peter's University", "Clinical Assistant Professor of Nursing"],
    ["Oklahoma State University", "Instructor of Professional Practice 22154"],
    ["Oklahoma State University", "Professor of Professional Practice & Laboratory Director AF7850"],
    ["University of Nevada, Reno", "(Nursing Scientist) Assistant / Associate Professor"],
    ["University of Nevada, Reno", "Lecturer/Teaching Assistant Professor, Criminal Justice"],
    ["University of South Dakota", "Clinical Instructor of Dental Hygiene"],
    ["Colorado Mesa University", "Assistant Clinical Professor of Nursing"],
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({ college, title }),
      { value: false, evidence: "institution-policy" },
      `${college}: ${title}`
    );
  }
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Manchester University",
      title: "Lecturer of Physical Therapy",
      description: "The Doctorate of Physical Therapy Adjunct Lecturer will teach assigned courses.",
    }),
    { value: false, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Washington State University",
      title: "Internal Medicine Residency Program Core Faculty | College of Medicine",
      description: "Job Classification: Clinical Assistant Professor - Career, Clinical Associate Professor - Career, Clinical Professor - Career",
    }),
    { value: false, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({
      college: "Texas Christian University",
      title: "Assistant/Associate Professor or Assistant/Associate Professor of Professional Practice - Occupational Therapy - of Nursing & Health Sciences",
    }),
    null
  );
});

test("does not treat generic with-tenure policy boilerplate as appointment evidence", () => {
  assert.equal(classifyTenureTrack({
    description: "Before a conditional offer of employment with tenure is finalized, disclosures are required.",
  }), null);
});

test("uses Larkin University's certified no-tenure-system response", () => {
  assert.equal(
    classifyTenureTrack({ college: "Larkin University", title: "Assistant or Associate Professor and Director of Preclinical Education" }),
    false
  );
  assert.equal(
    classifyTenureTrack({ college: "Larkin University", title: "Faculty (Rank TBD)" }),
    false
  );
});

test("uses Owens' full-time faculty tenure-track policy without absorbing temporary instructors", () => {
  const fullTimeContract =
    "Union Position: Owens Faculty Association Job Classification: Faculty Duty Days: 173 Days Work Schedule: Monday-Friday Pay Basis: Salary";

  assert.equal(
    classifyTenureTrack({
      college: "Owens Community College",
      title: "Instructor, Nursing",
      description: fullTimeContract,
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      college: "Owens Community College",
      title: "Clinical Teaching Faculty",
      description: "The position has a 40 hour per week requirement. " + fullTimeContract,
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      college: "Owens Community College",
      title: "Temporary Instructor, Nursing",
      description: fullTimeContract,
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "Owens Community College",
      title: "Instructor, Nursing",
      description: "Part-time temporary faculty appointment",
    }),
    null
  );
});

test("uses TTUHSC's named clinical non-tenure ranks without guessing unmodified professors", () => {
  assert.equal(
    classifyTenureTrack({
      college: "Texas Tech University Health Sciences Center",
      title: "Clinical Asst Professor HSC - Psychiatry",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "Texas Tech University Health Sciences Center",
      title: "Clinical Professor HSC - Endocrinology",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "Texas Tech University Health Sciences Center",
      title: "Asst/Assoc Professor, Cardiology",
    }),
    null
  );
});

test("uses South Carolina State's non-tenure Instructor rank without guessing professors", () => {
  assert.equal(
    classifyTenureTrack({
      college: "South Carolina State University",
      title: "Criminal Justice Instructor",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "South Carolina State University",
      title: "Assistant Professor of Sociology",
    }),
    null
  );
});

test("uses full-time tenure and continuing-contract paths at Holyoke, Saint Johns River, Pasco-Hernando, HACC, Eastern Oklahoma, Galveston, and CCRI", () => {
  assert.equal(
    classifyTenureTrack({
      college: "Holyoke Community College",
      title: "Accounting Faculty Member",
      description: "Job Type Full-time Job Number F-00028",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      college: "Holyoke Community College",
      title: "Accounting Faculty Member",
      description: "Job Type Part-time",
    }),
    false
  );
  assert.equal(
    classifyTenureTrack({
      college: "Saint Johns River State College",
      title: "Anatomy & Physiology Instructor (FT - OPC)",
      description: "Job Type Full-Time Department Biological Science",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      college: "Saint Johns River State College",
      title: "Anatomy & Physiology Instructor (PT - OPC)",
      description: "Job Type Part-Time",
    }),
    false
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Pasco-Hernando State College",
      title: "Instructor, Nursing RN Programs (Full-Time Faculty)",
      description: "Job Type Full-Time Job Number 202600141 Department Nursing Programs FLSA Exempt Bargaining Unit Faculty",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({
      college: "Pasco-Hernando State College",
      title: "Adjunct Faculty, Nursing",
      description: "Job Type Part-Time Bargaining Unit Adjunct Faculty",
    }),
    false
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Harrisburg Area Community College",
      title: "9.5 Faculty, Dental Hygiene",
      description: "Job Summary: Provides academic instruction. Job Type: Full-Time 9 Month If part time, hours per week: N/A",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({
      college: "Harrisburg Area Community College",
      title: "Adjunct Faculty, Dental Hygiene",
      description: "Job Type: Adjunct",
    }),
    false
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Eastern Oklahoma State College",
      title: "Faculty: Instructor of Political Science",
      description: "Responsibilities include teaching 15 credits each semester, developing curriculum, advising, and institutional service.",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({
      college: "Eastern Oklahoma State College",
      title: "Adjunct Instructor of Political Science",
      description: "Part-time appointment",
    }),
    false
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Galveston College",
      title: "Nursing Faculty",
      description: "POSITION : Nursing Faculty POSITION AVAILABLE: Full time JOB SUMMARY: Faculty Job Description",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({
      college: "Galveston College",
      title: "Program Director/Instructor-Law Enforcement",
      description: "POSITION AVAILABLE: 6/9/26",
    }),
    null
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Community College of Rhode Island",
      title: "Assistant Professor, Management",
      description: "The successful candidate will teach business courses and contribute to curriculum development, assessment, and student success initiatives.",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Community College of Rhode Island",
      title: "Medical Assistant Instructor",
      description: "Workforce Development. This position is scheduled based on employer and program demand and may include day, evening, and weekend hours.",
    }),
    { value: false, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Carthage College",
      title: "Assistant Professor, Biology",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Carthage College",
      title: "Assistant Professor of Education - Secondary Education",
    }),
    { value: false, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({
      college: "Carthage College",
      title: "Assistant Professor of Nursing (Mental Health)",
    }),
    null
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Dallas Theological Seminary",
      title: "Missiology and Intercultural Ministries Faculty‍",
      description: "Faculty Development and Participation: Actively make progress toward tenure and promotions as outlined in the Faculty Handbook.",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({
      college: "Dallas Theological Seminary",
      title: "Assistant Professor of Old Testament Studies Faculty‍",
    }),
    null
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Northwestern College",
      title: "Biology Faculty",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Northwestern College",
      title: "Physician Assistant Faculty",
      description: "Northwestern College invites applications for a 0.82 FTE professor of practice position in the physician assistant program.",
    }),
    { value: false, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({
      college: "Northwestern College",
      title: "Civil Engineering Faculty",
    }),
    null
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Transylvania University",
      title: "Assistant Professor of Biology",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Transylvania University",
      title: "Assistant Professor of Business Administration - Finance",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Transylvania University",
      title: "Assistant Professor of Business Administration - Management",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Transylvania University",
      title: "Assistant Professor of Political Science (Methods and American Politics)",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({
      college: "Transylvania University",
      title: "Assistant Professor of Chemistry",
    }),
    null
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Union Commonwealth University",
      title: "Assistant Professor of History",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Union Commonwealth University",
      title: "Assistant Professor of Management",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Union Commonwealth University",
      title: "Assistant Professor of Health Sciences",
    }),
    { value: false, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({
      college: "Union Commonwealth University",
      title: "Assistant Professor of Biology",
    }),
    null
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Andrew College",
      title: "Nursing Clinicals Instructor",
    }),
    { value: false, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Cedarville University",
      title: "Faculty: School of Pharmacy - Instructor of Pharmacy Practice - Pharmacy Innovation Fellowship",
    }),
    { value: false, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Graceland University-Lamoni",
      title: "Assistant Professor Math",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "Graceland University-Lamoni",
      title: "Assistant Professor of Physical Education",
    }),
    { value: true, evidence: "institution-policy" }
  );
  assert.equal(
    classifyTenureTrack({
      college: "Graceland University-Lamoni",
      title: "Assistant Professor of Chemistry",
    }),
    null
  );
  for (const title of [
    "Assistant Professor of Educational Studies (Instructional Design, Technology, and Quantitative Methods Focus)",
    "Assistant Professor, English",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({
        college: "University of Nevada, Reno",
        title,
      }),
      { value: true, evidence: "institution-policy" }
    );
  }
  assert.equal(
    classifyTenureTrack({
      college: "University of Nevada, Reno",
      title: "Lecturer II / Teaching Assistant Professor / Assistant Professor, Commercial Horticulture Specialist (Clark County, NV)",
    }),
    null
  );
  for (const title of [
    "Assistant Professor of Clinical Psychology",
    "Assistant Professor of Counseling Psychology",
    "Assistant Professor of Nutrition – Nutritional Science",
    "Assistant Professor Pediatric Audiology",
    "Assistant/Associate Professor of Microbiology",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({
        college: "University of North Texas",
        title,
      }),
      { value: true, evidence: "institution-policy" }
    );
  }
  for (const title of [
    "Assistant Professor — AAH CHHS Human Dev and Family Sci",
    "Assistant Professor — AAH Marketing and Supply Chain Mgmt",
    "Assistant Professor / Associate Professor — AAH Finance",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({
        college: "East Carolina University",
        title,
      }),
      { value: true, evidence: "institution-policy" }
    );
  }
  assert.equal(
    classifyTenureTrack({
      college: "East Carolina University",
      title: "Family Medicine - Geriatrics Physician (Faculty) — EHH BSOM FM Geriatrics",
    }),
    null
  );
  for (const title of [
    "Assistant Professor of Architecture - AI/Machine Learning",
    "Assistant Professor of Dance - Modern",
    "Assistant Professor of Drama - Costume Technology",
    "Assistant Professor of Educational Psychology - Professional Counseling",
    "Assistant Professor of Electrical and Computer Engineering - High-Performance Computing",
  ]) {
    assert.deepEqual(
      classifyTenureTrackWithEvidence({
        college: "University of Oklahoma",
        title,
      }),
      { value: true, evidence: "institution-policy" }
    );
  }
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      college: "University of Oklahoma",
      title: "Assistant Professor of Law - Clinical Legal Education - Criminal Defense Clinic",
    }),
    { value: false, evidence: "institution-policy" }
  );
});

test("uses College of Southern Maryland's ten-month tenure-track faculty convention", () => {
  assert.equal(
    classifyTenureTrack({
      college: "College of Southern Maryland",
      title: "10-Month Faculty - Pediatric Nursing",
      description: "Job Type Faculty Job Number FY26-90",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      college: "College of Southern Maryland",
      title: "10-Month Full-Time Economics Faculty",
      description: "Job Type Faculty Job Number FY26-52",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      college: "College of Southern Maryland",
      title: "Adjunct Faculty - Nursing",
      description: "Job Type Adjunct Faculty",
    }),
    false
  );
});

test("uses Shasta's full-time tenure-track convention while excluding temporary faculty", () => {
  assert.equal(
    classifyTenureTrack({
      college: "Shasta College",
      title: "(Full-time) Ethnic Studies Instructor",
      description: "Job Type: Faculty Full-Time Department: Instruction",
    }),
    true
  );
  assert.equal(
    classifyTenureTrack({
      college: "Shasta College",
      title: "(Full-time) Agriculture Business Instructor (Temporary, Grant Funded, Non-Tenure Track)",
      description: "Job Type: Faculty Full-Time Department: Instruction",
    }),
    false
  );
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
