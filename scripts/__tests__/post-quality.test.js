import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmedNonFacultyReason,
  deterministicStratifiedSample,
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

test("human labels produce a precision summary and ignore unfinished labels", () => {
  assert.deepEqual(summarizeHumanLabels([
    { label: "valid" }, { label: "invalid" }, { label: "valid" }, { label: null },
  ]), { reviewed: 3, valid: 2, invalid: 1, precisionPct: 66.67 });
});
