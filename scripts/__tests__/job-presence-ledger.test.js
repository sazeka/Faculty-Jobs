import { test } from "node:test";
import assert from "node:assert/strict";
import { updatePresenceLedger, validFirstSeen } from "../lib/job-presence-ledger.js";
import { preserveEnrichment } from "../lib/enrichment-merge.js";

const TODAY = "2026-09-19";

test("re-keyed canonicalJobIds keep the firstSeen carried from the previous snapshot (2026-09-19 regression)", () => {
  // Yesterday's snapshot and ledger, keyed by the pre-#166 IDs.
  const prev = {
    jobs: [
      { canonicalJobId: "job_old1", url: "https://x/1", firstSeen: "2026-08-28" },
      { canonicalJobId: "job_old2", url: "https://x/2", firstSeen: "2026-03-02" },
    ],
  };
  const presence = {
    jobs: {
      job_old1: { firstSeen: "2026-08-28", lastSeen: "2026-09-18", consecutiveMisses: 0 },
      job_old2: { firstSeen: "2026-03-02", lastSeen: "2026-09-18", consecutiveMisses: 0 },
    },
  };
  // Today's scrape: same URLs, new ID formula, plus one genuinely new job.
  const fresh = {
    jobs: [
      { canonicalJobId: "job_new1", url: "https://x/1" },
      { canonicalJobId: "job_new2", url: "https://x/2" },
      { canonicalJobId: "job_new3", url: "https://x/3" },
    ],
  };
  const { data } = preserveEnrichment(fresh, prev);

  const seen = updatePresenceLedger(presence, data.jobs, TODAY);

  assert.deepEqual([...seen].sort(), ["job_new1", "job_new2", "job_new3"]);
  assert.equal(presence.jobs.job_new1.firstSeen, "2026-08-28");
  assert.equal(presence.jobs.job_new2.firstSeen, "2026-03-02");
  assert.equal(presence.jobs.job_new3.firstSeen, TODAY);
  assert.equal(presence.jobs.job_old1.consecutiveMisses, 1);
});

test("an earlier carried firstSeen lowers an existing ledger entry (so a backfill self-heals the ledger)", () => {
  const presence = { jobs: { job_a: { firstSeen: "2026-09-19", lastSeen: "2026-09-30", consecutiveMisses: 2 } } };
  updatePresenceLedger(presence, [{ canonicalJobId: "job_a", firstSeen: "2026-02-23" }], "2026-10-01");
  assert.deepEqual(presence.jobs.job_a, { firstSeen: "2026-02-23", lastSeen: "2026-10-01", consecutiveMisses: 0 });
});

test("a later or invalid carried firstSeen never moves the ledger forward", () => {
  const presence = { jobs: { job_a: { firstSeen: "2026-05-01", lastSeen: "2026-09-30", consecutiveMisses: 0 } } };
  updatePresenceLedger(
    presence,
    [{ canonicalJobId: "job_a", firstSeen: "2026-09-01" }, { canonicalJobId: "job_b", firstSeen: "2027-01-01" }, { canonicalJobId: "job_c", firstSeen: "soon" }],
    "2026-10-01",
  );
  assert.equal(presence.jobs.job_a.firstSeen, "2026-05-01");
  assert.equal(presence.jobs.job_b.firstSeen, "2026-10-01");
  assert.equal(presence.jobs.job_c.firstSeen, "2026-10-01");
});

test("validFirstSeen accepts ISO timestamps and rejects future dates", () => {
  assert.equal(validFirstSeen("2026-08-28T10:00:00Z", TODAY), "2026-08-28");
  assert.equal(validFirstSeen("2026-09-20", TODAY), null);
  assert.equal(validFirstSeen(null, TODAY), null);
});
