import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmedNonFacultyReason,
  deterministicStratifiedSample,
  isPlaceholderLocation,
  scoreCatalog,
  scorePost,
  stableJobId,
  summarizeHumanLabels,
} from "../lib/post-quality.js";

const TODAY = new Date("2026-08-27T12:00:00Z");

function job(overrides = {}) {
  return {
    title: "Assistant Professor of Biology",
    college: "Example University",
    source: "EX",
    url: "https://jobs.example.edu/postings/1234",
    description: "Teach undergraduate biology courses, maintain a research program, and advise students in the department.",
    department: "Biology",
    location: "Phoenix, AZ",
    datePosted: "2026-08-01",
    closeDate: "2026-10-01",
    ...overrides,
  };
}

test("a complete direct faculty appointment passes with a high score", () => {
  const quality = scorePost(job(), { today: TODAY });
  assert.equal(quality.status, "pass");
  assert.ok(quality.score >= 95);
  assert.deepEqual(quality.reasons, []);
});

test("faculty resource page titles are quarantined with a reason code", () => {
  const quality = scorePost(job({ title: "Faculty Affairs" }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "resource_page_title"));
});

test("generic faculty handbooks, careers indexes, and staff portals are quarantined", () => {
  for (const title of [
    "Faculty Handbook",
    "Faculty Careers",
    "Faculty/Staff",
    "Faculty & Staff Resources",
    "/ Faculty/Staff Panel",
  ]) {
    assert.equal(confirmedNonFacultyReason(job({ title }), { today: TODAY }), "resource_page_title", title);
  }
});

test("faculty affairs staff roles are quarantined", () => {
  const quality = scorePost(job({ title: "Faculty Affairs Coordinator" }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("academic program names containing staff-role words remain eligible", () => {
  const quality = scorePost(job({ title: "Adjunct Faculty - Healthcare Specialist" }), { today: TODAY });
  assert.notEqual(quality.status, "quarantine");
  assert.ok(!quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("open-rank and coordinated faculty appointments are not mistaken for staff roles", () => {
  for (const title of [
    "Glaucoma Ophthalmology Specialist - Faculty (Open Rank)",
    "Full Time Faculty (Program Coordinator) – Business Administration",
    "Program Coordinator / Clinical Assistant Faculty at 50% FTE",
    "Medical Assisting Program Coordinator/Faculty",
    "Retina/Uveitis Specialist - Faculty Rank DOQ",
    "Senior Faculty Specialist",
    "Specialist - Post Doc Psychology Fellow",
    "Distinguished and Faculty Development Chairs in Materials Science",
    "Assistant Librarian - Faculty Support Librarian",
  ]) {
    const quality = scorePost(job({ title }), { today: TODAY });
    assert.notEqual(quality.status, "quarantine", title);
    assert.ok(!quality.reasons.some((reason) => reason.code === "administrative_staff_title"), title);
  }
});

test("truncated institution text does not create a false attribution conflict", () => {
  const quality = scorePost(job({
    college: "University of Washington",
    title: "Restorative Neurosurgeon — Assistant Professor, WOT Neurological Surgery University of",
  }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "institution_title_conflict"));
});

test("the publishing gate removes only confirmed non-postings", () => {
  assert.equal(confirmedNonFacultyReason(job({ title: "Faculty Affairs Coordinator" }), { today: TODAY }), "administrative_staff_title");
  assert.equal(confirmedNonFacultyReason(job({
    title: "Faculty Awards",
    url: "https://www.example.edu/faculty-affairs/faculty-awards",
  }), { today: TODAY }), "resource_page_title");
  assert.equal(confirmedNonFacultyReason(job({ title: "Staff, Faculty & Student Employment Opportunities" }), { today: TODAY }), "resource_page_title");
  assert.equal(confirmedNonFacultyReason(job({
    title: "Electrician Faculty - Greenville Center",
    description: "Teach electrician courses and provide quality education to students.",
  }), { today: TODAY }), null);
  assert.equal(confirmedNonFacultyReason(job({ title: "Assistant Professor of Biology" }), { today: TODAY }), null);
});

test("adjunct appointments remain eligible when their subject resembles student services", () => {
  const quality = scorePost(job({ title: "Career Services Adjunct - Pet Grooming" }), { today: TODAY });
  assert.notEqual(quality.status, "quarantine");
  assert.ok(!quality.reasons.some((reason) => reason.code === "student_service_title"));
});

test("adjunct faculty recruitment remains an administrative role", () => {
  const quality = scorePost(job({ title: "Coordinator, Adjunct Faculty Recruitment" }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("associate faculty teaching human resources is not mistaken for HR staff", () => {
  const quality = scorePost(job({ title: "Associate Faculty - Labor Relations (Human Resources)" }), { today: TODAY });
  assert.equal(quality.status, "pass");
  assert.ok(!quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("job-platform URLs containing faculty-affairs are not treated as resource pages", () => {
  const quality = scorePost(job({
    title: "Faculty Affairs Coordinator",
    url: "https://example.wd1.myworkdayjobs.com/careers/job/campus/Faculty-Affairs-Coordinator_R123",
  }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "resource_page_url"));
  assert.ok(quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("academic leadership titles are not mistaken for staff roles", () => {
  const quality = scorePost(job({ title: "Associate Dean and Professor for Faculty Affairs" }), { today: TODAY });
  assert.notEqual(quality.status, "quarantine");
  assert.ok(!quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("a conflicting institution explicitly named in the title is quarantined", () => {
  const quality = scorePost(job({ title: "Assistant Professor — Other State University" }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "institution_title_conflict"));
});

test("an expired posting is quarantined after the grace period unless marked open until filled", () => {
  const expired = scorePost(job({ closeDate: "2026-01-01" }), { today: TODAY });
  const grace = scorePost(job({ closeDate: "2026-08-22" }), { today: TODAY });
  const open = scorePost(job({ closeDate: "2026-01-01", openUntilFilled: true }), { today: TODAY });
  assert.equal(expired.status, "quarantine");
  assert.ok(expired.reasons.some((reason) => reason.code === "expired_posting"));
  assert.ok(!grace.reasons.some((reason) => reason.code === "expired_posting"));
  assert.notEqual(open.status, "quarantine");
});

test("a strong academic title on a search page is routed to review", () => {
  const quality = scorePost(job({ url: "https://jobs.example.edu/search" }), { today: TODAY });
  assert.equal(quality.status, "review");
  assert.ok(quality.reasons.some((reason) => reason.code === "search_page_url"));
});

test("CUNY DirectEmployers job routes are recognized as direct postings", () => {
  const quality = scorePost(job({
    url: "https://cuny.jobs/new-york-ny/assistant-professor/6052470F8928436B9A3681F255F3B7AF/job",
  }), { today: TODAY });
  assert.equal(quality.linkType, "direct");
  assert.ok(!quality.reasons.some((reason) => reason.code === "search_page_url"));
});

test("generic faculty page chrome is quarantined only on search pages", () => {
  const chrome = scorePost(job({
    title: "Faculty & Staff Jobs",
    url: "https://www.example.edu/about/employment",
  }), { today: TODAY });
  const posting = scorePost(job({
    title: "Full-Time Faculty",
    url: "https://www.example.edu/jobs/full-time-faculty-123",
  }), { today: TODAY });
  assert.equal(chrome.status, "quarantine");
  assert.ok(chrome.reasons.some((reason) => reason.code === "resource_page_title"));
  assert.ok(!posting.reasons.some((reason) => reason.code === "resource_page_title"));
});

test("reviewed academic and inline-listing evidence clears known false warnings", () => {
  const quality = scorePost(job({
    title: "Accounting Faculty",
    url: "https://www.example.edu/employment",
    qualityEvidence: "reviewed-academic-appointment",
    qualityLinkEvidence: "verified-inline-posting",
  }), { today: TODAY });
  assert.equal(quality.academicAppointment, true);
  assert.equal(quality.linkType, "reviewed-direct");
  assert.ok(!quality.reasons.some((reason) => reason.code === "weak_academic_evidence"));
  assert.ok(!quality.reasons.some((reason) => reason.code === "search_page_url"));
});

test("reviewed faculty resources and non-faculty fellowships are quarantined", () => {
  for (const candidate of [
    job({ title: "Chemistry Faculty & Staff", url: "https://example.edu/academics/chemistry/faculty-staff", qualityEvidence: "reviewed-non-posting" }),
    job({ title: "Faculty Resource Guide", url: "https://example.edu/faculty-handbook", qualityEvidence: "reviewed-non-posting" }),
    job({ title: "Athletic Training Fellow", url: "https://example.edu/jobs/123", qualityEvidence: "reviewed-non-posting" }),
  ]) {
    const quality = scorePost(candidate, { today: TODAY });
    assert.equal(quality.status, "quarantine");
    assert.ok(quality.reasons.some((reason) => reason.code === "reviewed_non_posting"));
  }
});

test("missing optional metadata lowers completeness without quarantining", () => {
  const quality = scorePost(job({ description: "", department: "", location: "", closeDate: "" }), { today: TODAY });
  assert.equal(quality.status, "pass");
  assert.ok(quality.score < 100);
  assert.ok(quality.reasons.some((reason) => reason.code === "missing_description"));
});

test("stable IDs and deterministic samples are repeatable and stratified", () => {
  const jobs = [
    job({ url: "https://jobs.example.edu/postings/1", source: "A" }),
    job({ url: "https://jobs.example.edu/postings/2", source: "B" }),
    job({ url: "https://jobs.example.edu/postings/3", source: "A", title: "Faculty Support" }),
  ];
  const scored = scoreCatalog(jobs, { today: TODAY });
  const first = deterministicStratifiedSample(scored, { size: 3 }).map((row) => row.quality.id);
  const second = deterministicStratifiedSample(scored, { size: 3 }).map((row) => row.quality.id);
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, 3);
  assert.equal(stableJobId(jobs[0]), stableJobId({ ...jobs[0], title: "Changed title" }));
});

test("detects institution-name-as-city location placeholders (issue #120)", () => {
  assert.equal(isPlaceholderLocation("Wilson Community College, NC", "Wilson Community College"), true);
  assert.equal(isPlaceholderLocation("Harvard University, MA", "Harvard University"), true);
  assert.equal(isPlaceholderLocation("Medical College of Wisconsin, WI", "Medical College of Wisconsin"), true);
  // Real cities, including one that happens to share a word with the college name.
  assert.equal(isPlaceholderLocation("Milwaukee, WI", "Medical College of Wisconsin"), false);
  assert.equal(isPlaceholderLocation("Cambridge, MA", "Harvard University"), false);
  assert.equal(isPlaceholderLocation("Tempe, AZ", "Arizona State University"), false);
  // Institutions actually named after (and located in) a real city of the
  // same name — a looser "location's words are a subset of college's words"
  // check would wrongly flag every one of these as a placeholder.
  assert.equal(isPlaceholderLocation("Santa Clara, CA", "Santa Clara University"), false);
  assert.equal(isPlaceholderLocation("Houston, TX", "University of Houston"), false);
  assert.equal(isPlaceholderLocation("Radford, VA", "Radford University"), false);
  assert.equal(isPlaceholderLocation("Villanova, PA", "Villanova University"), false);
  // A campus name that's a real, distinct place should not be flagged.
  assert.equal(isPlaceholderLocation("Remote", "Harvard University"), false);
  assert.equal(isPlaceholderLocation("", "Harvard University"), false);
  // "Main Campus - City, ST" is a legitimate convention for a real satellite
  // campus, even when the college name itself embeds that campus suffix
  // (so the whole location string would otherwise equal `${college}, ${state}`).
  assert.equal(isPlaceholderLocation("Saint Joseph's University - Lancaster, PA", "Saint Joseph's University - Lancaster"), false);
  // Institutions without "university"/"college"/etc. in the name (SUNY
  // campuses, seminaries) are still real placeholder candidates.
  assert.equal(isPlaceholderLocation("SUNY Cortland, NY", "SUNY Cortland"), true);
  assert.equal(isPlaceholderLocation("Midwestern Baptist Theological Seminary, MO", "Midwestern Baptist Theological Seminary"), true);
});

test("scorePost flags a placeholder location as a completeness reason, distinct from missing_location", () => {
  const placeholder = scorePost(job({ location: "Wilson Community College, NC", college: "Wilson Community College" }), { today: TODAY });
  assert.ok(placeholder.reasons.some((r) => r.code === "placeholder_location"));
  assert.ok(!placeholder.reasons.some((r) => r.code === "missing_location"));

  const realLocation = scorePost(job({ location: "Milwaukee, WI", college: "Medical College of Wisconsin" }), { today: TODAY });
  assert.ok(!realLocation.reasons.some((r) => r.code === "placeholder_location"));

  const missing = scorePost(job({ location: "", state: "", college: "Example University" }), { today: TODAY });
  assert.ok(missing.reasons.some((r) => r.code === "missing_location"));
  assert.ok(!missing.reasons.some((r) => r.code === "placeholder_location"));
});

// --- Issue #129: confirmed non-job examples (resource/directory/marketing
// pages, test records, staff roles with weak-evidence title matches) ---

test("faculty directory, biography, leadership, overview, and video pages are quarantined (issue #129)", () => {
  for (const title of [
    "Academic Leadership & Faculty",
    "Faculty Biographies",
    "Faculty Directory",
    "Faculty Experience",
    "Faculty Overview",
    "Faculty Videos",
  ]) {
    const quality = scorePost(job({ title, url: "https://example.edu/about/faculty" }), { today: TODAY });
    assert.equal(quality.status, "quarantine", title);
    assert.ok(quality.reasons.some((reason) => reason.code === "resource_page_title"), title);
  }
});

test("a page naming faculty applicants as an audience, not a role, is quarantined (issue #129)", () => {
  const quality = scorePost(job({
    title: "Information for Santa Fe Faculty Applicants",
    url: "https://www.sjc.edu/santa-fe/offices-services/human-resources/faculty-applicants",
  }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "resource_page_title"));
});

test("a legitimate 'Applicant Pool' posting title is not caught by the applicant-information-page check (issue #129)", () => {
  const quality = scorePost(job({
    title: "Adjunct Faculty - Communication Studies Applicant Pool",
    description: "Teach communication studies courses on a part-time basis; applications remain on file for future openings.",
  }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "resource_page_title"));
});

test("campus-visit marketing copy that mentions faculty in passing is quarantined (issue #129)", () => {
  const quality = scorePost(job({
    title: "Visit — Explore campus, meet faculty, and see student life",
    url: "https://www.sebts.edu/admissions/visit",
  }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "resource_page_title"));
});

test("explicit test/do-not-apply records are quarantined and removed by the publishing gate (issue #129)", () => {
  const quality = scorePost(job({
    title: "New Test for Faculty — Do NOT Apply",
    url: "https://centrecollege.wd501.myworkdayjobs.com/CentreF/job/Danville-Kentucky/New-Test-for-Faculty---Do-NOT-Apply_JR100243",
  }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "test_or_placeholder_posting"));
  assert.equal(confirmedNonFacultyReason(job({
    title: "New Test for Faculty — Do NOT Apply",
    url: "https://centrecollege.wd501.myworkdayjobs.com/CentreF/job/Danville-Kentucky/New-Test-for-Faculty---Do-NOT-Apply_JR100243",
  }), { today: TODAY }), "test_or_placeholder_posting");
});

test("'assistant to the Dean' is an incidental reporting relationship, not a dean appointment (issue #129)", () => {
  const quality = scorePost(job({
    title: "Office Manager and Executive Assistant to the Dean",
    url: "https://howardcc.peopleadmin.com/postings/6159",
  }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("a real Dean appointment is still recognized as a strong academic title (issue #129 regression guard)", () => {
  const quality = scorePost(job({ title: "Dean of the College of Business", description: "" }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
  assert.equal(quality.academicAppointment, true);
});

test("academic advising staff roles without an appointment title are quarantined (issue #129)", () => {
  const quality = scorePost(job({
    title: "Academic Advisor 3",
    url: "https://careers.uh.edu/jobs/academic-advisor-3-undergraduate-business-programs-houston-texas-united-states-6abac11b-ddb9-4708-8ada-489a04ba450a",
  }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "student_service_title"));
});

test("positionType 'Other' is treated as absence of evidence, not positive evidence (issue #129)", () => {
  const other = scorePost(job({ title: "Assessment Support", description: "", positionType: "Other" }), { today: TODAY });
  assert.ok(other.reasons.some((reason) => reason.code === "weak_academic_evidence"));
  assert.notEqual(other.status, "pass");

  const missing = scorePost(job({ title: "Assessment Support", description: "", positionType: "" }), { today: TODAY });
  assert.ok(missing.reasons.some((reason) => reason.code === "weak_academic_evidence"));

  const real = scorePost(job({ title: "Assessment Support", description: "", positionType: "Lecturer" }), { today: TODAY });
  assert.ok(!real.reasons.some((reason) => reason.code === "weak_academic_evidence"));
});

// --- Issue #130: completeness/badges must reject malformed metadata ---

test("a malformed department (scraper noise) does not earn completeness credit (issue #130)", () => {
  for (const department of [
    "s. Come work alongside a committed group of faculty and staff to provide transformational",
    "Biology Region: Finger Lakes Open until filled",
    "222720 - UGE Some Program",
    "Biology (Adjunct) Search",
  ]) {
    const quality = scorePost(job({ department }), { today: TODAY });
    assert.ok(quality.reasons.some((reason) => reason.code === "missing_department"), department);
  }
});

test("a valid department still earns completeness credit (issue #130 regression guard)", () => {
  const quality = scorePost(job({ department: "Department of Chemistry" }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "missing_department"));
});

test("a bot-challenge description is treated as missing and flagged distinctly, not accepted as real content (issue #130)", () => {
  const quality = scorePost(job({ description: "Performing security verification. This may take a few seconds." }), { today: TODAY });
  assert.ok(quality.reasons.some((reason) => reason.code === "bot_challenge_description"));
  assert.ok(!quality.reasons.some((reason) => reason.code === "missing_description"));
  assert.ok(!quality.reasons.some((reason) => reason.code === "thin_description"));
});

// --- Issue #131: freshness must not give decade-old postings full credit
// without an evergreen/pool signal ---

test("an old individual vacancy with no evergreen signal loses freshness confidence (issue #131, UNC Nutrigenomics example)", () => {
  const quality = scorePost(job({
    title: "Assistant Professor of Nutrigenomics",
    college: "University of North Carolina",
    url: "https://unc.peopleadmin.com/postings/318489",
    datePosted: "2016-05-16",
    closeDate: "",
    openUntilFilled: true,
  }), { today: TODAY });
  assert.ok(quality.reasons.some((reason) => reason.code === "stale_posting_no_evergreen_signal"));
  assert.notEqual(quality.status, "pass");
  assert.equal(quality.evergreenPool, false);
});

test("an explicit evergreen/applicant-pool posting keeps full freshness credit despite its age (issue #131, Villanova example)", () => {
  const quality = scorePost(job({
    title: "Adjunct Faculty Applicant Pool - Communication",
    college: "Villanova University",
    url: "https://jobs.villanova.edu/postings/33397",
    description: "The university accepts applications for this pool at any time and will contact qualified candidates when a teaching need arises.",
    datePosted: "2012-01-01",
    closeDate: "",
    openUntilFilled: true,
  }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "stale_posting_no_evergreen_signal"));
  assert.ok(!quality.reasons.some((reason) => reason.code === "aging_posting_no_evergreen_signal"));
  assert.equal(quality.evergreenPool, true);
  assert.equal(quality.status, "pass");
});

test("'Open Until Filled' alone is not treated as an evergreen signal (issue #131)", () => {
  const quality = scorePost(job({
    datePosted: "2018-01-01",
    closeDate: "",
    openUntilFilled: true,
  }), { today: TODAY });
  assert.equal(quality.evergreenPool, false);
  assert.ok(quality.reasons.some((reason) => reason.code === "stale_posting_no_evergreen_signal"));
});

test("freshness age penalties are graduated and a recent posting is unaffected (issue #131)", () => {
  const recent = scorePost(job({ datePosted: "2026-08-01" }), { today: TODAY });
  assert.ok(!recent.reasons.some((reason) => reason.dimension === "freshness" && reason.code.includes("evergreen")));

  const aging = scorePost(job({ datePosted: "2025-01-01", closeDate: "", openUntilFilled: true }), { today: TODAY });
  assert.ok(aging.reasons.some((reason) => reason.code === "aging_posting_no_evergreen_signal" && reason.severity === "info"));

  const stale = scorePost(job({ datePosted: "2023-01-01", closeDate: "", openUntilFilled: true }), { today: TODAY });
  assert.ok(stale.reasons.some((reason) => reason.code === "stale_posting_no_evergreen_signal" && reason.severity === "warning"));
});

test("human labels produce a precision summary and ignore unfinished labels", () => {
  assert.deepEqual(summarizeHumanLabels([
    { label: "valid" }, { label: "invalid" }, { label: "valid" }, { label: null },
  ]), { reviewed: 3, valid: 2, invalid: 1, precisionPct: 66.67 });
});
