import assert from "node:assert/strict";
import test from "node:test";
import { findCoverageRegressions } from "../lib/coverage-health.js";

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
