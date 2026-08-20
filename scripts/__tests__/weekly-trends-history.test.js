import assert from "node:assert/strict";
import test from "node:test";

import { latestPriorWeek } from "../lib/weekly-trends-history.js";

test("weekly reruns compare against the preceding week, not themselves", () => {
  const history = [
    { weekEnd: "2026-08-09", totalJobs: 100 },
    { weekEnd: "2026-08-16", totalJobs: 110 },
    { weekEnd: "2026-08-23", totalJobs: 120 },
  ];
  assert.deepEqual(latestPriorWeek(history, "2026-08-23"), history[1]);
});

test("returns null when no preceding week exists", () => {
  assert.equal(latestPriorWeek([{ weekEnd: "2026-08-23" }], "2026-08-23"), null);
});
