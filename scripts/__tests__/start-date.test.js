import assert from "node:assert/strict";
import test from "node:test";
import { extractStartDate, isImplausibleStartDate } from "../lib/start-date.js";

// Regression coverage for issue #118: Workday's administrative/HR metadata
// fields ("Recruiting Start Date", "Posting Start Date", "Application Start
// Date", "Review Start Date") describe the hiring process, not the faculty
// appointment, and were being extracted as the anticipated appointment start.

test("rejects administrative/HR start-date labels", () => {
  assert.equal(extractStartDate("Recruiting Start Date: 2026-09-15. We are excited to invite applications."), null);
  assert.equal(extractStartDate("This position has a Posting Start Date: 2026-01-01 and closes soon."), null);
  assert.equal(extractStartDate("Application Start Date: 2026-03-01, review begins immediately."), null);
  assert.equal(extractStartDate("Review Start Date: 2026-02-15, applications accepted until filled."), null);
  assert.equal(extractStartDate("The Recruiting Start Date is August 4, 2025."), null);
});

test("still extracts genuine appointment start-date phrasing", () => {
  assert.equal(extractStartDate("The anticipated start date is August 15, 2026."), "2026-08-15");
  assert.equal(extractStartDate("Position start date: Fall 2026."), "Fall 2026");
  assert.equal(extractStartDate("The appointment is expected to begin in August 2026."), "August 2026");
  assert.equal(extractStartDate("Start Date: 2026-09-01, subject to final approval."), "2026-09-01");
  assert.equal(extractStartDate("The faculty start date will be August 2026."), "August 2026");
  assert.equal(extractStartDate("Desired Start Date 08/14/2026 Review Start Date Open Until Filled"), "2026-08-14");
});

test("returns null for text with no start-date signal at all", () => {
  assert.equal(extractStartDate("A tenure-track faculty position in the Department of Biology."), null);
  assert.equal(extractStartDate(""), null);
});

// Regression coverage for issue #156: 18 listings displayed a structured
// startDate more than 90 days before their own datePosted -- e.g. a source
// posting recycled/left stale while only its posting date was refreshed. All
// eight confirmed examples from the issue table are covered here (matching
// the confirmed titles/institutions/dates verbatim).
test("isImplausibleStartDate flags the issue's confirmed examples (gaps of 93-688 days)", () => {
  assert.equal(isImplausibleStartDate("2024-08-19", "2026-07-08"), true); // Eastern Maine CC, 688 days
  assert.equal(isImplausibleStartDate("2024-01-08", "2025-05-22"), true); // USC Sumter, 500 days
  assert.equal(isImplausibleStartDate("2025-01-06", "2026-05-10"), true); // State College of Florida, 489 days
  assert.equal(isImplausibleStartDate("2024-08-12", "2025-09-24"), true); // UNF, 408 days
  assert.equal(isImplausibleStartDate("2025-08-16", "2026-08-28"), true); // University of Alabama, 377 days
  assert.equal(isImplausibleStartDate("2025-12-01", "2026-09-15"), true); // MGH Institute, 288 days
  assert.equal(isImplausibleStartDate("2026-01-12", "2026-08-13"), true); // Texas A&M, 213 days
  assert.equal(isImplausibleStartDate("2025-09-01", "2026-02-11"), true); // Northeastern, 163 days
});

test("isImplausibleStartDate uses a 90-day tolerance, not a hair-trigger one", () => {
  // A start date genuinely a couple of months before posting (a late-posted
  // listing for an already-planned appointment) is still plausible.
  assert.equal(isImplausibleStartDate("2026-06-01", "2026-08-01"), false); // 61 days
  assert.equal(isImplausibleStartDate("2026-05-01", "2026-08-01"), true); // 92 days -- just past the tolerance
  // A start date AFTER datePosted (the normal case) is never implausible.
  assert.equal(isImplausibleStartDate("2026-12-01", "2026-08-01"), false);
});

test("isImplausibleStartDate leaves season/month-only values alone (no reliable comparison possible)", () => {
  assert.equal(isImplausibleStartDate("Fall 2020", "2026-08-01"), false);
  assert.equal(isImplausibleStartDate("August 2020", "2026-08-01"), false);
});

test("isImplausibleStartDate never flags when either date is missing/unparseable", () => {
  assert.equal(isImplausibleStartDate(null, "2026-08-01"), false);
  assert.equal(isImplausibleStartDate("2024-01-01", null), false);
  assert.equal(isImplausibleStartDate("2024-01-01", "not a date"), false);
  assert.equal(isImplausibleStartDate("", ""), false);
});
