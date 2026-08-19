import { test } from "node:test";
import assert from "node:assert/strict";
import { synchronizeJobCount } from "../lib/dataset-invariants.js";

test("synchronizes stale count metadata with the jobs array", () => {
  const payload = { scrapedAt: "2026-08-19T00:00:00Z", count: 3, jobs: [{ id: 1 }, { id: 2 }] };
  const result = synchronizeJobCount(payload);

  assert.equal(result.count, 2);
  assert.deepEqual(result.jobs, payload.jobs);
  assert.equal(result.scrapedAt, payload.scrapedAt);
});

test("leaves non-job payloads unchanged", () => {
  const payload = { count: 7 };
  assert.equal(synchronizeJobCount(payload), payload);
});
