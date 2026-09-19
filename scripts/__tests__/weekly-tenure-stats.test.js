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
  // A plain title at a SUNY state-operated campus is unaffected (not "clinical"
  // or "lecturer") and stays unclassified like everywhere else.
  assert.equal(
    classifyTenureTrack({ college: "Stony Brook University", title: "Assistant Professor" }),
    null
  );
  // A plain multi-rank slash chain with no "Clinical" qualifier also stays
  // unclassified -- genuinely ambiguous, matches most of Stony Brook's
  // remaining unclassified postings.
  assert.equal(
    classifyTenureTrack({
      college: "Stony Brook University",
      title: "Cardiologist, Assistant/Associate/Full Professor, Internal Medicine, Heart Failure",
    }),
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

  // Issue #145: the check above only exercises the no-stored-value path.
  // Eleven live University of Washington WOT records were stuck at
  // tenureTrack: true because classifyTenureTrackWithEvidence() used to
  // return a stored boolean immediately, before ever consulting the title or
  // the institution-policy rule just verified above -- so a stale/incorrect
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
      { value: false, evidence: "institution-policy" },
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
  assert.equal(classifyTenureTrack({ college: usfCollege, title: "Assistant Professor" }), null);

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
  // stays unclassified, as does an unranked "Research Fellow" title.
  assert.equal(
    classifyTenureTrack({ college: "Northeastern University", title: "Assistant Professor, Modern Korean History" }),
    null
  );
  assert.equal(
    classifyTenureTrack({ college: "Northeastern University", title: "Distinguished Research Fellow, Khoury College of Computer Sciences" }),
    null
  );

  // Ball State: Faculty and Professional Personnel Handbook Sec.
  // 16.1.4.1.1 names Lecturer directly as "non-tenure-line."
  assert.equal(
    classifyTenureTrack({
      college: "Ball State University",
      title: "Assistant Lecturer of Early Childhood, Youth, and Family Studies (Child Life)",
    }),
    false
  );
  // The compound "Lecturer/...Teaching Professor" form stays unclassified --
  // Ball State's Teaching Professor series isn't independently confirmed
  // non-tenure in this handbook edition, unlike Lecturer.
  assert.equal(
    classifyTenureTrack({
      college: "Ball State University",
      title: "Assistant Lecturer/Assistant Teaching Professor of Entrepreneurship",
    }),
    null
  );
});

test("applies USG, UNLV, Virginia Tech, and Florida institution-specific conventions", () => {
  // USG (collegePattern): Board of Regents-defined non-tenure ranks (Academic
  // Professional, Lecturer, Public Service, Clinical, Research Scientist,
  // Librarian) extended from the existing University of Georgia rule to the
  // rest of the University System of Georgia.
  for (const college of ["University of North Georgia", "Georgia College & State University", "Fort Valley State University"]) {
    assert.equal(classifyTenureTrack({ college, title: "Lecturer of Psychology" }), false, college);
  }
  // A plain title at a USG institution stays unclassified, same as UGA.
  assert.equal(
    classifyTenureTrack({ college: "University of North Georgia", title: "Assistant Professor of Biology" }),
    null
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
  // Georgia State University is deliberately excluded from the collegePattern
  // (a live Perimeter College "Clinical" posting resolved tenure-track via an
  // explicit description signal, showing GSU doesn't reliably follow the
  // system-wide convention), so the same title there stays unclassified.
  assert.equal(
    classifyTenureTrack({ college: "Georgia State University", title: "Clinical Assistant Professor of Radiology" }),
    null
  );

  // UNLV: University Bylaws Ch. III name "faculty in residence" as
  // non-tenure-track in the same breath as tenure-track faculty.
  assert.equal(
    classifyTenureTrack({
      college: "University of Nevada, Las Vegas",
      title: "Assistant Professor-in-Residence, Criminal Justice",
    }),
    false
  );
  // A plain title with no "in Residence"/"Clinical"/"Research"/"Lecturer"
  // qualifier (common on UNLV med-school postings) stays unclassified.
  assert.equal(
    classifyTenureTrack({
      college: "University of Nevada, Las Vegas",
      title: "Geriatrics, Assistant/Associate/Professor, Internal Medicine",
    }),
    null
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
    null
  );
});

test("recognizes ATS structural metadata (hourly salary, labeled non-tenure Job Type) as a non-tenure signal", () => {
  // NEOGOV/schooljobs.com-style descriptions concatenate labeled fields
  // verbatim -- an hourly rate (rather than an annual salary schedule) is
  // definitional of part-time/adjunct employment, never tenure-track.
  assert.deepEqual(
    classifyTenureTrackWithEvidence({
      title: "French (Foreign Languages) Instructor Applicant Pool",
      description:
        "French (Foreign Languages) Instructor Applicant Pool Salary $89.24 Hourly Location Santa Clarita, CA Job Type Part-Time Faculty",
    }),
    { value: false, evidence: "description-job-type" }
  );
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
  // A real tenure-track salary schedule (annual, not hourly) is unaffected.
  assert.equal(
    classifyTenureTrack({ description: "Salary $75,000.00 - $95,000.00 Annually Job Type Full-Time Faculty" }),
    null
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
