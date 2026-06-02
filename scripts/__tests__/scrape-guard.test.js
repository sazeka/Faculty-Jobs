import { test } from "node:test";
import assert from "node:assert/strict";
import { countBySource, shouldBlockOverwrite, healCrateredSources } from "../lib/scrape-guard.js";

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
