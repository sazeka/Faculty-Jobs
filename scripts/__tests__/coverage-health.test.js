import assert from "node:assert/strict";
import test from "node:test";
import { findCoverageRegressions, lowerCoverageThresholds } from "../lib/coverage-health.js";

test("zero missing and pending institutions is healthy", () => {
  assert.deepEqual(findCoverageRegressions({ totals: { missing: 0, pending_review: 0 } }), []);
});

test("new missing and pending institutions trigger coverage regressions", () => {
  assert.deepEqual(
    findCoverageRegressions({ totals: { missing: 2, pending_review: 1 } }),
    [
      { kind: "missing", actual: 2, allowed: 0 },
      { kind: "pending_review", actual: 1, allowed: 0 },
    ]
  );
});

test("an accepted discovery backlog does not trigger a coverage regression", () => {
  const report = { totals: { missing: 1785, pending_review: 0 } };
  assert.deepEqual(findCoverageRegressions(report, { maxMissing: 1785, maxPending: 0 }), []);
  assert.deepEqual(
    findCoverageRegressions({ totals: { missing: 1786, pending_review: 0 } }, { maxMissing: 1785 }),
    [{ kind: "missing", actual: 1786, allowed: 1785 }]
  );
});

test("coverage watermark follows improvements but never accepts regressions", () => {
  const current = { maxMissing: 1785, maxPending: 0, note: "keep" };
  assert.deepEqual(
    lowerCoverageThresholds(current, { totals: { missing: 1740, pending_review: 0 } }),
    { maxMissing: 1740, maxPending: 0, note: "keep" }
  );
  assert.deepEqual(
    lowerCoverageThresholds(current, { totals: { missing: 1800, pending_review: 2 } }),
    current
  );
});
