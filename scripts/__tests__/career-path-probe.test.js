import { test } from "node:test";
import assert from "node:assert/strict";
import { compareDiscoveryPriority, isRejectedCareerPage } from "../lib/career-path-probe.js";

test("career path probing rejects fabricated faculty/jobs and soft-404 pages", () => {
  assert.equal(isRejectedCareerPage("https://example.edu/faculty/jobs"), true);
  assert.equal(
    isRejectedCareerPage("https://example.edu/404-not-found?request=/faculty/jobs"),
    true
  );
  assert.equal(
    isRejectedCareerPage("https://example.edu/careers", "<title>404 - Page Not Found</title>"),
    true
  );
});

test("career path probing accepts a normal employment page", () => {
  assert.equal(
    isRejectedCareerPage("https://example.edu/human-resources/employment", "<title>Employment Opportunities</title>"),
    false
  );
});

test("career path probing rejects student-facing career and library resources", () => {
  assert.equal(
    isRejectedCareerPage("https://example.edu/career-readiness/experiential-learning/faculty-led-travel/"),
    true
  );
  assert.equal(
    isRejectedCareerPage("https://example.edu/distance-education-library-services/employment-resources/"),
    true
  );
  assert.equal(isRejectedCareerPage("https://example.edu/academics/academic-programs/careers-electric-academy/"), true);
  assert.equal(isRejectedCareerPage("https://example.edu/careers/career-exploration/faculty-services/"), true);
  assert.equal(isRejectedCareerPage("https://example.edu/about/news/student-employment-program/"), true);
});

test("career discovery prioritizes unattempted and least-recently attempted institutions", () => {
  const rows = [
    { name: "Recent", discovery_attempts: 1, last_discovery_attempt_at: "2026-08-20" },
    { name: "Unattempted", discovery_attempts: 0 },
    { name: "Older", discovery_attempts: 1, last_discovery_attempt_at: "2026-08-01" },
  ];
  rows.sort(compareDiscoveryPriority);
  assert.deepEqual(rows.map((row) => row.name), ["Unattempted", "Older", "Recent"]);
});
