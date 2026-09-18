import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeJobTitle,
  truncateTitleAtEmbeddedCollegeName,
  isPlausibleCityStateLocation,
  recoverLabelPrefixedLocation,
} from "../../server.js";

test("removes embedded and bracketed requisition codes without losing specialization", () => {
  assert.equal(
    normalizeJobTitle("Assistant to Associate Professor (Hematology/Oncology Fellowship Assoc. Program Director - 0088872T)"),
    "Assistant to Associate Professor (Hematology/Oncology Fellowship Assoc. Program Director)"
  );
  assert.equal(
    normalizeJobTitle("Assistant/Associate Professor (Hematology/Oncology Core - 88883T & 88886T)"),
    "Assistant/Associate Professor (Hematology/Oncology Core)"
  );
  assert.equal(
    normalizeJobTitle("Assistant Professor-in-Residence in Developmental Disabilities and Applied Behavior Analysis, College of Education [R0152682]."),
    "Assistant Professor-in-Residence in Developmental Disabilities and Applied Behavior Analysis, College of Education"
  );
});

test("expands a trailing MIS course code into its academic field", () => {
  assert.equal(
    normalizeJobTitle("Adjunct Faculty - MIS 630 ONL-Z"),
    "Adjunct Faculty - Information Systems"
  );
});

// Issue #138: bot-challenge pages and description/UI-label text contaminated
// at least 29 stored titles.
test("strips a bot-challenge prefix from the title (issue #138)", () => {
  assert.equal(
    normalizeJobTitle("Let's confirm you are human - of Computer Science at the University of Houston invites applications for a Postdoctoral R"),
    "of Computer Science at the University of Houston invites applications for a Postdoctoral R"
  );
  assert.equal(
    normalizeJobTitle("Let's confirm you're human: Assistant Professor of Biology"),
    "Assistant Professor of Biology"
  );
});

test("strips 'Position Type ... Job Details' description/UI text appended to the title (issue #138, ASU Mid-South pattern)", () => {
  const t = normalizeJobTitle(
    "Adjunct Faculty - Mechatronics Some description prose here. Position Type Adjunct Faculty Job Details"
  );
  assert.equal(t, "Adjunct Faculty - Mechatronics Some description prose here.");
});

test("strips a source-domain + relative-timestamp footer appended to the title (issue #138, Mitchell Hamline pattern)", () => {
  assert.equal(
    normalizeJobTitle("Adjunct Instructor of History Schreiner University Kerrville Texas Adjunct Opportunities Posted 2 months ago"),
    "Adjunct Instructor of History Schreiner University Kerrville Texas Adjunct Opportunities"
  );
  assert.equal(
    normalizeJobTitle("Assistant Professor of Theatre and Artistic Director of Theatre Milligan, TN Milligan Job Opening Posted 5 months ago"),
    "Assistant Professor of Theatre and Artistic Director of Theatre Milligan, TN Milligan"
  );
});

test("strips a legal-address + description footer appended to the title (issue #138, Meridian Community College pattern)", () => {
  assert.equal(
    normalizeJobTitle(
      "EMS-Paramedic Program Coodinator/Instructor/Full Time | Legal Address - Meridian, MS 39307Faculty in the Workforce Solutions Division of Meridian Comm"
    ),
    "EMS-Paramedic Program Coodinator/Instructor/Full Time"
  );
});

// Issue #138: Luther College, Oblate School of Theology, and Mitchell Hamline
// concatenated the college name, department, and location directly onto the
// end of the real title with no separator.
test("truncateTitleAtEmbeddedCollegeName recovers the real title before the glued-on college name (issue #138)", () => {
  assert.equal(
    truncateTitleAtEmbeddedCollegeName(
      "Assistant Professor of Biology (tenure-eligible)Luther CollegeBiologyDecorah, IABenefits Eligible ASSISTANT PROFESSOR OF BIOLOGY REQUIREMENTS...",
      "Luther College"
    ),
    "Assistant Professor of Biology (tenure-eligible)"
  );
});

test("truncateTitleAtEmbeddedCollegeName leaves a normal 'College - Position' title alone", () => {
  const t = "Luther College - Assistant Professor of Biology";
  assert.equal(truncateTitleAtEmbeddedCollegeName(t, "Luther College"), t);
  // No college name, or too-short a college name, is a no-op rather than a crash.
  assert.equal(truncateTitleAtEmbeddedCollegeName(t, ""), t);
  assert.equal(truncateTitleAtEmbeddedCollegeName("", "Luther College"), "");
});

// Issue #137: the PageUp/nau-search location extractor accepted arbitrary
// comma-separated metadata whenever the trailing token happened to contain
// two capital letters, storing credentials, ranks, and instructions as
// job locations.
test("isPlausibleCityStateLocation rejects credential, rank, and instruction fragments (issue #137)", () => {
  assert.equal(isPlausibleCityStateLocation("MD, DO"), false);
  assert.equal(isPlausibleCityStateLocation("Instructor I, II"), false);
  assert.equal(isPlausibleCityStateLocation("Submit a letter of interest, CV"), false);
  assert.equal(isPlausibleCityStateLocation("PROFESSOR - CLINICAL, OB"), false);
  assert.equal(isPlausibleCityStateLocation("Associate Professor or Professor, OB"), false);
  assert.equal(isPlausibleCityStateLocation("Assoc Professor, BS"), false);
  assert.equal(isPlausibleCityStateLocation("Film, TV"), false);
  assert.equal(isPlausibleCityStateLocation("high-performance and scientific computing, AI"), false);
  assert.equal(isPlausibleCityStateLocation("ASSOCIATE PROFESSOR, OR"), false);
});

test("isPlausibleCityStateLocation accepts real city/state pairs, including Washington DC (issue #137)", () => {
  assert.equal(isPlausibleCityStateLocation("Tulsa, OK"), true);
  assert.equal(isPlausibleCityStateLocation("Las Cruces, NM"), true);
  assert.equal(isPlausibleCityStateLocation("Washington, DC"), true);
  assert.equal(isPlausibleCityStateLocation("Not A Real State, ZZ"), false);
  assert.equal(isPlausibleCityStateLocation(""), false);
});

// A bug related to, but distinct from, #137: these locations DO end in a
// real, correct "City, ST", but a job-label or employment-status fragment
// was glued onto the front with no separator (HACC's "... Faculty Exempt" /
// "... Staff Non exempt", University of Toledo's "... Health Science Campus
// College"). recoverLabelPrefixedLocation() strips the unambiguous marker
// and recovers the real trailing city.
test("recoverLabelPrefixedLocation strips HACC's Exempt/Non-exempt FLSA-status markers", () => {
  assert.equal(recoverLabelPrefixedLocation("MATH Faculty Exempt Gettysburg, PA"), "Gettysburg, PA");
  assert.equal(recoverLabelPrefixedLocation("Civil Construction Technology Faculty Exempt York, PA"), "York, PA");
  assert.equal(recoverLabelPrefixedLocation("Dental Hygiene Faculty Exempt Harrisburg, PA"), "Harrisburg, PA");
  assert.equal(recoverLabelPrefixedLocation("Adjunct Faculty - Chemistry Faculty Exempt Harrisburg, PA"), "Harrisburg, PA");
  assert.equal(recoverLabelPrefixedLocation("Instructor - GED Staff Non exempt Harrisburg, PA"), "Harrisburg, PA");
  assert.equal(recoverLabelPrefixedLocation("Industrial Maintenance Faculty Staff Non exempt Harrisburg, PA"), "Harrisburg, PA");
});

test("recoverLabelPrefixedLocation strips University of Toledo's 'Health Science Campus College' marker", () => {
  assert.equal(recoverLabelPrefixedLocation("Full Professor Health Science Campus College Toledo, OH"), "Toledo, OH");
  assert.equal(recoverLabelPrefixedLocation("Professor of Medicine Health Science Campus College Toledo, OH"), "Toledo, OH");
  assert.equal(recoverLabelPrefixedLocation("Pathologists' Assistant Health Science Campus College Toledo, OH"), "Toledo, OH");
});

test("recoverLabelPrefixedLocation strips a Full-Time/Part-Time employment-status marker", () => {
  assert.equal(recoverLabelPrefixedLocation("Welding Instructor Full-Time Carrollton, KY"), "Carrollton, KY");
});

test("recoverLabelPrefixedLocation refuses to strip a bare Faculty/Staff marker (too ambiguous to recover by rule)", () => {
  // Kenyon's real city sits right after "Faculty", same shape as the safe
  // cases above -- but "Faculty" alone isn't a safe marker (see the UWF case
  // below), so these are left for hand verification instead of a guess.
  assert.equal(recoverLabelPrefixedLocation("Tenure-track Biology Faculty Gambier, OH"), null);
  assert.equal(recoverLabelPrefixedLocation("Environmental Studies Political Science Faculty Gambier, OH"), null);
  // UWF's "Usha Kundu, M.D." is a campus building, not a city -- "MD" is
  // being misread as Maryland the same way "MD, DO" was in #137. If a bare
  // "Faculty" marker were stripped here the leftover "Usha Kundu, MD" would
  // itself pass isPlausibleCityStateLocation and be silently accepted as a
  // (wrong) real place, which is exactly the failure mode this guards against.
  assert.equal(recoverLabelPrefixedLocation("Tenured and Tenure-Track Faculty Usha Kundu, MD"), null);
  assert.equal(recoverLabelPrefixedLocation("Non-Tenure-Track Faculty Usha Kundu, MD"), null);
});

test("recoverLabelPrefixedLocation returns null for markerless prefixes, already-plausible locations, and non-matching shapes", () => {
  assert.equal(recoverLabelPrefixedLocation("Nursing Instructor - LPN Carrollton, KY"), null);
  assert.equal(recoverLabelPrefixedLocation("Tulsa, OK"), null); // already plausible, nothing to recover
  assert.equal(recoverLabelPrefixedLocation("MD, DO"), null); // no city/state shape survives stripping
  assert.equal(recoverLabelPrefixedLocation(""), null);
});
