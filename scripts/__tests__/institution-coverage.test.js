import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveCoverageStatus,
  deriveJobPresenceStatus,
} from "../lib/institution-coverage.js";

test("a healthy configured source remains covered when it has no current jobs", () => {
  assert.equal(
    deriveCoverageStatus({
      isConfigured: true,
      careerUrl: "https://example.edu/careers",
      verificationStatus: "healthy",
      jobCount: 0,
    }),
    "covered"
  );
  assert.equal(deriveJobPresenceStatus(0), "no_jobs_found");
});

test("a bot-blocked configured source is not treated as a broken source", () => {
  assert.equal(
    deriveCoverageStatus({
      isConfigured: true,
      careerUrl: "https://example.edu/careers",
      verificationStatus: "bot_blocked",
      jobCount: 0,
    }),
    "covered"
  );
});

test("a single broken check does not remove configured source coverage", () => {
  assert.equal(
    deriveCoverageStatus({
      isConfigured: true,
      careerUrl: "https://example.edu/careers",
      verificationStatus: "broken",
      jobCount: 0,
    }),
    "covered"
  );
});

test("quarantined, invalid, and unconfigured sources remain missing", () => {
  assert.equal(
    deriveCoverageStatus({
      isConfigured: true,
      careerUrl: "https://example.edu/careers",
      verificationStatus: "quarantined_broken_link",
      jobCount: 0,
    }),
    "missing"
  );
  assert.equal(
    deriveCoverageStatus({
      isConfigured: true,
      careerUrl: "not-a-valid-url",
      verificationStatus: "invalid",
      jobCount: 0,
    }),
    "missing"
  );
  assert.equal(
    deriveCoverageStatus({
      isConfigured: false,
      careerUrl: "https://example.edu/careers",
      verificationStatus: "healthy",
      jobCount: 0,
    }),
    "missing"
  );
});

test("jobs found are direct evidence of coverage despite link-check status", () => {
  assert.equal(
    deriveCoverageStatus({
      isConfigured: false,
      careerUrl: null,
      verificationStatus: "quarantined_broken_link",
      jobCount: 2,
    }),
    "covered"
  );
  assert.equal(deriveJobPresenceStatus(2), "jobs_found");
});

test("a campus attributed through a shared system source remains covered", () => {
  assert.equal(
    deriveCoverageStatus({
      hasSharedSource: true,
      careerUrl: null,
      verificationStatus: "unchecked",
      jobCount: 0,
    }),
    "covered"
  );
});
