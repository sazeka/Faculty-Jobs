import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { attachCanonicalIds } from "../lib/canonical-id.js";
import { dedupeByCanonicalJobId, dedupeExactListings } from "../lib/exact-job-dedup.js";
import { repairKnownSourceOwnership } from "../lib/institution-attribution.js";
import { readJobsFile, writeJobsFile } from "../lib/jobs-file.js";
import { healCrateredSources } from "../lib/scrape-guard.js";

// The 2026-09-25 scrape: SUNY Brockport's schooljobs.com postings were scraped
// under "Finger Lakes Community College", so the "NY / SUNY Brockport" group
// looked cratered (0 vs 76) and the heal step restored the previous copies
// while the fresh, mislabeled copies stayed. agent:job-presence then rewrote the
// fresh copies' college to SUNY Brockport, leaving 122 canonicalJobIds stored twice.
const brockport = (n) => ({
  title: `Adjunct Lecturer ${n}`,
  url: `https://www.schooljobs.com/careers/brockport/jobs/52569${String(n).padStart(2, "0")}`,
  source: "NY",
  category: "Faculty",
  college: "Finger Lakes Community College",
  location: "Canandaigua, NY",
});

function tmpJobs() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "canonical-dup-")), "jobs.json");
}

// Previous snapshot: ids hashed while mislabeled, college repaired afterwards
// (the pre-fix pipeline), exactly what public/jobs.json carried.
const previous = {
  jobs: attachCanonicalIds(Array.from({ length: 12 }, (_, i) => brockport(i))).map((job) => ({
    ...repairKnownSourceOwnership(job),
    discipline: "Accounting",
    firstSeen: "2026-09-19",
  })),
};

test("source heal does not restore a posting the fresh scrape already has under another college", () => {
  const fresh = { jobs: attachCanonicalIds(Array.from({ length: 12 }, (_, i) => brockport(i))) };
  const heal = healCrateredSources(fresh, previous, { minBaseline: 10, dropPct: 60 });

  assert.equal(heal.healed.some((h) => h.college === "SUNY Brockport"), true, "the group still reads as cratered");
  assert.equal(heal.jobsRestored, 0, "no previous copy is appended next to its fresh copy");

  const exact = dedupeExactListings(heal.data.jobs).jobs.map(repairKnownSourceOwnership);
  const ids = exact.map((job) => job.canonicalJobId);
  assert.equal(new Set(ids).size, ids.length);
});

test("attributing before ids keeps the heal from seeing a crater at all", () => {
  const fresh = { jobs: attachCanonicalIds(Array.from({ length: 12 }, (_, i) => repairKnownSourceOwnership(brockport(i)))) };
  const heal = healCrateredSources(fresh, previous, { minBaseline: 10, dropPct: 60 });

  assert.equal(heal.healed.length, 0);
  assert.ok(heal.data.jobs.every((job) => job.college === "SUNY Brockport"));
});

test("dedupeByCanonicalJobId keeps one most-complete copy in the first copy's position", () => {
  const base = { canonicalJobId: "job_a", title: "Instructor - Psychology", url: "https://x/1", college: "Monroe Community College" };
  const result = dedupeByCanonicalJobId([
    { ...base, firstSeen: "2026-09-19" },
    { canonicalJobId: "job_b", title: "Other" },
    { title: "No id" },
    { title: "No id" },
    { ...base, firstSeen: "2026-09-19", department: "Psychology", departmentInferredFrom: "title" },
  ]);

  assert.equal(result.removed, 1);
  assert.deepEqual(result.jobs.map((job) => job.canonicalJobId), ["job_a", "job_b", undefined, undefined]);
  assert.equal(result.jobs[0].department, "Psychology");
  assert.equal(result.jobs[0].departmentInferredFrom, "title");
});

test("writeJobsFile stores each canonicalJobId once, whatever the caller passes", () => {
  const p = tmpJobs();
  const job = { canonicalJobId: "job_a", title: "A", url: "https://x/a", college: "SUNY Brockport" };
  writeJobsFile(p, {
    scrapedAt: "x",
    count: 3,
    jobs: [job, { canonicalJobId: "job_b", title: "B" }, { ...job, department: "Accounting", description: "Full text" }],
  });

  const stored = readJobsFile(p);
  assert.equal(stored.count, 2);
  assert.deepEqual(stored.jobs.map((j) => j.canonicalJobId), ["job_a", "job_b"]);
  assert.equal(stored.jobs[0].department, "Accounting");
  assert.equal(stored.jobs[0].description, "Full text");
});
