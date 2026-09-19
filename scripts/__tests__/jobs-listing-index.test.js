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
    description: "A full-time hybrid appointment. Salary is $72,000 to $84,000 per year.",
    summary: "Posting summary",
  });

  assert.equal(compact.title, "Assistant Professor of Biology");
  // The legacy string enum is normalized to the canonical public boolean at
  // this write boundary (issue #163) -- jobs-index.json/chunks must never
  // re-leak "tenure-track"/"non-tenure-track" strings to the web client.
  assert.equal(compact.tenureTrack, true);
  assert.equal("tenureEvidence" in compact, false);
  assert.equal(compact.hasDescription, true);
  assert.equal(compact.employmentType, "Full-time");
  assert.equal(compact.workMode, "Hybrid");
  assert.equal(compact.salaryText, "$72,000 to $84,000 per year");
  assert.equal(compact.searchText, "assistant professor of biology example university biology");
  assert.equal("description" in compact, false);
  assert.equal("summary" in compact, false);
});

test("compactListingJob normalizes legacy tenureTrack strings to boolean/null (issue #163)", () => {
  assert.equal(compactListingJob({ title: "Lecturer", tenureTrack: "non-tenure-track" }).tenureTrack, false);
  assert.equal(compactListingJob({ title: "Lecturer", tenureTrack: true }).tenureTrack, true);
  assert.equal(compactListingJob({ title: "Lecturer", tenureTrack: false }).tenureTrack, false);
  assert.equal("tenureTrack" in compactListingJob({ title: "Lecturer", tenureTrack: null }), false);
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
