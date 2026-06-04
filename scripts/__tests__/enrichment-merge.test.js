import { test } from "node:test";
import assert from "node:assert/strict";
import { preserveEnrichment, ENRICHMENT_FIELDS } from "../lib/enrichment-merge.js";

const enriched = (over = {}) => ({
  canonicalJobId: "job_aaa",
  url: "https://x/1",
  title: "Assistant Professor of Biology",
  discipline: "Biology",
  positionType: "Assistant Professor",
  tenureTrack: "tenure-track",
  ...over,
});

test("fills enrichment on a fresh job that matches by canonicalJobId", () => {
  const prev = { jobs: [enriched()] };
  const fresh = { jobs: [{ canonicalJobId: "job_aaa", url: "https://x/1", title: "Assistant Professor of Biology" }] };
  const r = preserveEnrichment(fresh, prev);
  assert.equal(r.matched, 1);
  assert.equal(r.jobsTouched, 1);
  assert.equal(r.restoredFields, 3);
  assert.deepEqual(
    ENRICHMENT_FIELDS.map((f) => r.data.jobs[0][f]),
    ["Biology", "tenure-track", "Assistant Professor"]
  );
});

test("matches by URL when canonicalJobId differs", () => {
  const prev = { jobs: [enriched({ canonicalJobId: "job_old" })] };
  const fresh = { jobs: [{ canonicalJobId: "job_new", url: "https://x/1", title: "Assistant Professor of Biology" }] };
  const r = preserveEnrichment(fresh, prev);
  assert.equal(r.matched, 1);
  assert.equal(r.data.jobs[0].discipline, "Biology");
});

test("never overwrites fields the fresh scrape already produced", () => {
  const prev = { jobs: [enriched({ positionType: "Adjunct" })] };
  const fresh = {
    jobs: [{ canonicalJobId: "job_aaa", url: "https://x/1", positionType: "Full Professor" }],
  };
  const r = preserveEnrichment(fresh, prev);
  assert.equal(r.data.jobs[0].positionType, "Full Professor", "fresh value kept");
  // discipline + tenureTrack still filled from prev
  assert.equal(r.data.jobs[0].discipline, "Biology");
  assert.equal(r.restoredFields, 2);
});

test("treats empty string / null as missing and fills them", () => {
  const prev = { jobs: [enriched()] };
  const fresh = {
    jobs: [{ canonicalJobId: "job_aaa", url: "https://x/1", discipline: "", tenureTrack: null }],
  };
  const r = preserveEnrichment(fresh, prev);
  assert.equal(r.data.jobs[0].discipline, "Biology");
  assert.equal(r.data.jobs[0].tenureTrack, "tenure-track");
});

test("leaves genuinely-new jobs (no match) untouched and identity-stable", () => {
  const prev = { jobs: [enriched()] };
  const newJob = { canonicalJobId: "job_zzz", url: "https://x/999", title: "Lecturer" };
  const fresh = { jobs: [newJob] };
  const r = preserveEnrichment(fresh, prev);
  assert.equal(r.matched, 0);
  assert.equal(r.jobsTouched, 0);
  assert.equal(r.data.jobs[0], newJob, "unmatched job object is not copied");
});

test("no previous snapshot is a safe no-op", () => {
  const fresh = { jobs: [{ canonicalJobId: "job_aaa", url: "https://x/1" }] };
  assert.equal(preserveEnrichment(fresh, null).restoredFields, 0);
  assert.equal(preserveEnrichment(fresh, { jobs: [] }).restoredFields, 0);
});
