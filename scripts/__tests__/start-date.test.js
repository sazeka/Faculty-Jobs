import assert from "node:assert/strict";
import test from "node:test";
import { extractStartDate } from "../lib/start-date.js";

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
