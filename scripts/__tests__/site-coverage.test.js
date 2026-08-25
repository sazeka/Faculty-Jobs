import assert from "node:assert/strict";
import test from "node:test";
import { attachUniversityCoverage, coverageSummaryFromReport } from "../lib/site-coverage.js";

test("coverage summary uses the complete eligible U.S. institution universe", () => {
  const report = {
    totals: {
      eligible_universe: 3312,
      covered: 2392,
      missing: 813,
      excluded_policy: 107,
    },
  };

  assert.deepEqual(coverageSummaryFromReport(report), {
    covered: 2392,
    total: 3312,
    excluded: 107,
    percent: 72.22,
  });
  assert.deepEqual(attachUniversityCoverage({ total: 19116 }, report), {
    total: 19116,
    universityCoverage: {
      covered: 2392,
      total: 3312,
      excluded: 107,
      percent: 72.22,
    },
  });
});

test("invalid coverage reports do not publish a misleading percentage", () => {
  assert.equal(coverageSummaryFromReport({ totals: { eligible_universe: 0, covered: 0 } }), null);
  assert.deepEqual(attachUniversityCoverage({ total: 12 }, null), { total: 12 });
});
