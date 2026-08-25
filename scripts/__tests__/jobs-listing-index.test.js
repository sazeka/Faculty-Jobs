import test from "node:test";
import assert from "node:assert/strict";
import { buildListingIndex, compactListingJob } from "../lib/jobs-listing-index.js";

test("listing index keeps card/filter evidence but omits full descriptions", () => {
  const compact = compactListingJob({
    title: "Assistant Professor of Biology",
    url: "https://example.edu/jobs/1",
    college: "Example University",
    department: "Biology",
    tenureTrack: "tenure-track",
    tenureEvidence: "title-explicit",
    canonicalJobId: "job_1",
    canonicalGroupId: "grp_1",
    datePosted: "2026-08-24",
    description: "A very long full posting body",
    summary: "Posting summary",
  });

  assert.equal(compact.title, "Assistant Professor of Biology");
  assert.equal(compact.tenureTrack, "tenure-track");
  assert.equal("tenureEvidence" in compact, false);
  assert.equal(compact.hasDescription, true);
  assert.equal("description" in compact, false);
  assert.equal("summary" in compact, false);
});

test("listing index preserves scrape metadata and record count", () => {
  const index = buildListingIndex({
    scrapedAt: "2026-08-25T01:02:03.000Z",
    jobs: [{ title: "Professor", description: "" }, { title: "Lecturer", description: "Body" }],
  });

  assert.equal(index.scrapedAt, "2026-08-25T01:02:03.000Z");
  assert.equal(index.generatedAt, index.scrapedAt);
  assert.equal(index.count, 2);
  assert.deepEqual(index.jobs.map((job) => job.hasDescription), [false, true]);
});
