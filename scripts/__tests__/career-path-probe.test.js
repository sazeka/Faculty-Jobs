import { test } from "node:test";
import assert from "node:assert/strict";
import { isRejectedCareerPage } from "../lib/career-path-probe.js";

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
