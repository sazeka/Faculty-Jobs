import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  diffIdSets,
  computeSourceCanonicalIds,
  computeIndexCanonicalIds,
  sumChunkCanonicalIds,
  verifyDataSync,
} from "../verify-data-sync.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Regression coverage for issue #164: the deployed jobs-index.json/chunks
// reported 412 more jobs than the authoritative public/jobs.json -- a
// stale-derived-artifact drift with matching-looking timestamps on both
// sides, so only a full id-set comparison (not counts) can catch it.

test("diffIdSets reports stale (extra) and missing ids separately", () => {
  const source = new Set(["a", "b", "c"]);
  const derived = new Set(["a", "b", "d"]); // has a stale "d", missing "c"
  const diff = diffIdSets(source, derived);
  assert.deepEqual(diff.stale, ["d"]);
  assert.deepEqual(diff.missing, ["c"]);
  assert.equal(diff.inSync, false);
});

test("diffIdSets reports inSync when both sets match exactly", () => {
  const source = new Set(["a", "b"]);
  const derived = new Set(["b", "a"]);
  assert.equal(diffIdSets(source, derived).inSync, true);
});

test("computeSourceCanonicalIds derives canonicalJobIds the same way the live pipeline does", () => {
  const payload = {
    jobs: [
      { title: "Adjunct Faculty - Biology", college: "Example College", url: "https://example.com/postings/1" },
      { title: "Adjunct Faculty - Chemistry", college: "Example College", url: "https://example.com/postings/2" },
    ],
  };
  const ids = computeSourceCanonicalIds(payload);
  assert.equal(ids.size, 2);
  for (const id of ids) assert.match(id, /^job_[0-9a-f]{16}$/);
});

test("computeIndexCanonicalIds reads canonicalJobId off each compact index row", () => {
  const ids = computeIndexCanonicalIds({ jobs: [{ canonicalJobId: "job_1" }, { canonicalJobId: "job_2" }, {}] });
  assert.deepEqual([...ids].sort(), ["job_1", "job_2"]);
});

test("sumChunkCanonicalIds unions ids across multiple per-source chunk payloads", () => {
  const ids = sumChunkCanonicalIds([
    { jobs: [{ canonicalJobId: "job_1" }] },
    { jobs: [{ canonicalJobId: "job_2" }, { canonicalJobId: "job_1" }] },
  ]);
  assert.deepEqual([...ids].sort(), ["job_1", "job_2"]);
});

// Reproduces the #164 symptom end to end against synthetic fixtures: an
// index/chunk directory that still carries a since-removed job's id is
// flagged as out of sync, purely from comparing full id sets (this dataset's
// job COUNTS would even coincidentally match if a stale id and a genuinely
// new id happened to swap places -- the bug this test guards against is
// exactly why counts alone were insufficient in the real incident).
test("verifyDataSync flags a stale derived index/chunk directory (issue #164 shape)", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(ROOT, "generated", ".verify-data-sync-test-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const jobs = [
    { title: "Adjunct Faculty - Biology", college: "Example College", url: "https://example.com/postings/1" },
    { title: "Adjunct Faculty - Chemistry", college: "Example College", url: "https://example.com/postings/2" },
  ];
  fs.mkdirSync(path.join(tmpRoot, "public"), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, "public", "jobs.json"), JSON.stringify({ jobs }));

  const sourceIds = [...computeSourceCanonicalIds({ jobs })];
  const staleDir = path.join(tmpRoot, "public", "data");
  fs.mkdirSync(path.join(staleDir, "chunks"), { recursive: true });
  // Index/chunks still carry BOTH real ids plus one stale id from a job that
  // public/jobs.json (above) no longer has -- the exact #164 shape.
  const staleJobs = [...sourceIds.map((id) => ({ canonicalJobId: id })), { canonicalJobId: "job_stale_removed" }];
  fs.writeFileSync(path.join(staleDir, "jobs-index.json"), JSON.stringify({ jobs: staleJobs }));
  fs.writeFileSync(path.join(staleDir, "chunks", "example.json"), JSON.stringify({ jobs: staleJobs }));

  const inSyncDir = path.join(tmpRoot, "web-vue", "public", "data");
  fs.mkdirSync(path.join(inSyncDir, "chunks"), { recursive: true });
  const freshJobs = sourceIds.map((id) => ({ canonicalJobId: id }));
  fs.writeFileSync(path.join(inSyncDir, "jobs-index.json"), JSON.stringify({ jobs: freshJobs }));
  fs.writeFileSync(path.join(inSyncDir, "chunks", "example.json"), JSON.stringify({ jobs: freshJobs }));

  const result = verifyDataSync({ root: tmpRoot, dirs: ["public/data", "web-vue/public/data"] });
  assert.equal(result.allInSync, false);
  const [staleResult, freshResult] = result.results;
  assert.equal(staleResult.inSync, false);
  assert.deepEqual(staleResult.indexDiff.stale, ["job_stale_removed"]);
  assert.deepEqual(staleResult.indexDiff.missing, []);
  assert.equal(freshResult.inSync, true);
});

// Live guard: the actual committed public/jobs.json and its three derived
// directories must match exactly right now (this migration ran
// scripts/rebuild-data-chunks-all.js specifically to guarantee it, and any
// future data change that skips the rebuild step should fail this test).
test("the repo's live public/jobs.json and derived data directories are in sync", () => {
  const result = verifyDataSync({ root: ROOT });
  if (!result.allInSync) {
    console.error(JSON.stringify(result.results, null, 2));
  }
  assert.equal(result.allInSync, true);
});
