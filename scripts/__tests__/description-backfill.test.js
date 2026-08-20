import assert from "node:assert/strict";
import test from "node:test";

import {
  descriptionAttemptCount,
  needsDescriptionFetch,
  prioritizeDescriptionCandidates,
} from "../lib/description-backfill.js";

const NOW = Date.parse("2026-08-20T00:00:00.000Z");

test("fetches new descriptions and retries one stale empty result", () => {
  assert.equal(needsDescriptionFetch({ url: "https://example.edu/1" }, NOW), true);
  assert.equal(needsDescriptionFetch({ url: "https://example.edu/1", description: "Already filled" }, NOW), false);
  assert.equal(needsDescriptionFetch({ url: "javascript:void(0)" }, NOW), false);
  assert.equal(needsDescriptionFetch({
    url: "https://example.edu/1",
    descriptionFetchedAt: "2026-08-01T00:00:00.000Z",
  }, NOW), true);
  assert.equal(needsDescriptionFetch({
    url: "https://example.edu/1",
    descriptionFetchedAt: "2026-08-19T00:00:00.000Z",
  }, NOW), false);
  assert.equal(needsDescriptionFetch({
    url: "https://example.edu/1",
    descriptionFetchedAt: "2026-08-01T00:00:00.000Z",
    descriptionFetchAttempts: 2,
  }, NOW), false);
  assert.equal(descriptionAttemptCount({ descriptionFetchedAt: "2026-08-01" }), 1);
});

test("prioritizes unknown tenure and then newer postings", () => {
  const jobs = [
    { canonicalJobId: "known", url: "https://example.edu/known", tenureTrack: false, datePosted: "2026-08-20" },
    { canonicalJobId: "old", url: "https://example.edu/old", datePosted: "2026-08-01" },
    { canonicalJobId: "new", url: "https://example.edu/new", datePosted: "2026-08-19" },
  ];
  assert.deepEqual(
    prioritizeDescriptionCandidates(jobs, NOW).map(job => job.canonicalJobId),
    ["new", "old", "known"]
  );
});
