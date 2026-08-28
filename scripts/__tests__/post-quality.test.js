import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("an expired posting is quarantined unless marked open until filled", () => {
  const expired = scorePost(job({ closeDate: "2026-01-01" }), { today: TODAY });
  const open = scorePost(job({ closeDate: "2026-01-01", openUntilFilled: true }), { today: TODAY });
  assert.equal(expired.status, "quarantine");
  assert.ok(expired.reasons.some((reason) => reason.code === "expired_posting"));
  assert.notEqual(open.status, "quarantine");
});

test("a strong academic title on a search page is routed to review", () => {
  const quality = scorePost(job({ url: "https://jobs.example.edu/search" }), { today: TODAY });
  assert.equal(quality.status, "review");
  assert.ok(quality.reasons.some((reason) => reason.code === "search_page_url"));
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
