import { test } from "node:test";
import assert from "node:assert/strict";
import { countBySource, shouldBlockOverwrite, healCrateredSources, isConfirmedDeadUrl } from "../lib/scrape-guard.js";

const mk = (source, n) =>
  Array.from({ length: n }, (_, i) => ({ source, url: `https://x/${source}/${i}`, title: `t${i}` }));

test("countBySource tallies and ignores blank sources", () => {
  const by = countBySource({ jobs: [...mk("NM", 3), ...mk("NY", 2), { source: "  " }] });
  assert.deepEqual(by, { NM: 3, NY: 2 });
});

test("healCrateredSources restores a cratered source, keeps healthy ones", () => {
  const prev = { jobs: [...mk("NM", 46), ...mk("NY", 1420), ...mk("OK", 1)] };
  const next = { jobs: [...mk("NM", 3), ...mk("NY", 1430), ...mk("OK", 1)] };
  const r = healCrateredSources(next, prev, { minBaseline: 20, dropPct: 70 });
  const by = countBySource(r.data);
  assert.equal(by.NM, 46, "cratered NM restored from previous");
  assert.equal(by.NY, 1430, "healthy NY keeps fresh data");
  assert.equal(by.OK, 1, "small-baseline OK untouched");
  assert.equal(r.jobsRestored, 46);
  assert.equal(r.healed[0].source, "NM");
});

test("healCrateredSources ignores normal fluctuation (no false positive)", () => {
  const prev = { jobs: [...mk("NM", 46)] };
  const next = { jobs: [...mk("NM", 40)] };
  const r = healCrateredSources(next, prev, { minBaseline: 20, dropPct: 70 });
  assert.equal(r.healed.length, 0);
  assert.equal(countBySource(r.data).NM, 40);
});

test("healCrateredSources protects alert-sized small sources", () => {
  const prev = { jobs: mk("ND", 16) };
  const next = { jobs: mk("ND", 5) };
  const result = healCrateredSources(next, prev, { minBaseline: 10, dropPct: 60 });

  assert.equal(countBySource(result.data).ND, 16);
  assert.deepEqual(result.healed[0], {
    source: "ND",
    baseline: 16,
    current: 5,
    restoredTo: 16,
  });
});

test("healCrateredSources restores one cratered college inside a partially healthy source", () => {
  const collegeJobs = (college, n) =>
    Array.from({ length: n }, (_, i) => ({ source: "NM", college, url: `https://x/${college}/${i}`, title: `t${i}` }));
  const prev = { jobs: [...collegeJobs("University of New Mexico", 33), ...collegeJobs("Other NM", 14)] };
  const next = { jobs: [...collegeJobs("University of New Mexico", 2), ...collegeJobs("Other NM", 16)] };

  const result = healCrateredSources(next, prev, { minBaseline: 20, dropPct: 70 });
  const unm = result.data.jobs.filter((job) => job.college === "University of New Mexico");
  const other = result.data.jobs.filter((job) => job.college === "Other NM");

  assert.equal(unm.length, 33);
  assert.equal(other.length, 16, "healthy colleges retain fresh results");
  assert.deepEqual(result.healed[0], {
    source: "NM",
    college: "University of New Mexico",
    baseline: 33,
    current: 2,
    restoredTo: 33,
  });
});

test("healCrateredSources is a no-op without a previous snapshot", () => {
  const next = { jobs: mk("NM", 3) };
  const r = healCrateredSources(next, null, { minBaseline: 20, dropPct: 70 });
  assert.equal(r.healed.length, 0);
  assert.equal(r.data, next);
});

test("shouldBlockOverwrite is a no-op when no allowlist is set", () => {
  const prev = { jobs: mk("NM", 100) };
  const next = { jobs: mk("NM", 0) };
  assert.equal(shouldBlockOverwrite(next, prev, "").block, false);
});

test("shouldBlockOverwrite blocks when an allowlisted source drops to zero", () => {
  const prev = { jobs: [...mk("NM", 60), ...mk("NY", 100)] };
  const next = { jobs: [...mk("NM", 0), ...mk("NY", 100)] };
  const r = shouldBlockOverwrite(next, prev, "NM");
  assert.equal(r.block, true);
  assert.match(r.reasons[0], /NM dropped from 60 to 0/);
});

test("shouldBlockOverwrite blocks on >50% allowlisted-total collapse", () => {
  const prev = { jobs: [...mk("NM", 60), ...mk("NY", 60)] };
  const next = { jobs: [...mk("NM", 10), ...mk("NY", 10)] };
  const r = shouldBlockOverwrite(next, prev, "NM,NY");
  assert.equal(r.block, true);
});

test("isConfirmedDeadUrl requires a sustained dead streak", () => {
  assert.equal(isConfirmedDeadUrl(undefined), false);
  assert.equal(isConfirmedDeadUrl({ status: "ok", httpCode: 200 }), false);
  // single 404 is not yet confirmed (guards against transient failures)
  assert.equal(isConfirmedDeadUrl({ status: "dead", deadStreak: 1 }), false);
  assert.equal(isConfirmedDeadUrl({ status: "dead", deadStreak: 2 }), true);
  // legacy entry with no deadStreak field is treated as unconfirmed
  assert.equal(isConfirmedDeadUrl({ status: "dead" }), false);
  // homepage redirect is a stable "gone" signal → confirmed immediately
  assert.equal(isConfirmedDeadUrl({ status: "homepage-redirect" }), true);
  // blocked/timeout are never dead
  assert.equal(isConfirmedDeadUrl({ status: "blocked", deadStreak: 5 }), false);
  // custom threshold
  assert.equal(isConfirmedDeadUrl({ status: "dead", deadStreak: 1 }, 1), true);
});
