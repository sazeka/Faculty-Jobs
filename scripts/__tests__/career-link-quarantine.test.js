import test from "node:test";
import assert from "node:assert/strict";

import { isCareerLinkQuarantineApplicable } from "../lib/career-link-quarantine.js";

test("stale quarantine evidence does not suppress a repaired career URL", () => {
  assert.equal(
    isCareerLinkQuarantineApplicable({
      candidateCareerUrl: "https://example.edu/new-careers",
      quarantineCareerUrl: "https://example.edu/old-careers",
      quarantineCheckedAt: "2026-09-01T17:00:00Z",
    }),
    false
  );
});

test("a newer manual verification supersedes an older shallow-check failure", () => {
  assert.equal(
    isCareerLinkQuarantineApplicable({
      candidateCareerUrl: "https://example.edu/careers",
      quarantineCareerUrl: "https://example.edu/careers/",
      quarantineCheckedAt: "2026-09-01T17:00:00Z",
      manuallyVerifiedAt: "2026-09-01T18:00:00Z",
    }),
    false
  );
});

test("new quarantine evidence still applies to the same URL", () => {
  assert.equal(
    isCareerLinkQuarantineApplicable({
      candidateCareerUrl: "https://example.edu/careers",
      quarantineCareerUrl: "https://example.edu/careers",
      quarantineCheckedAt: "2026-09-02T17:00:00Z",
      manuallyVerifiedAt: "2026-09-01T18:00:00Z",
    }),
    true
  );
});
