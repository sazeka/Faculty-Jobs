import test from "node:test";
import assert from "node:assert/strict";

import { appointmentTrackHistory } from "../../web-vue/src/lib/trendsHistory.js";

test("appointment-track history ignores weeks recorded before classification began", () => {
  const history = appointmentTrackHistory([
    { weekEnd: "2026-08-16", tenureTrack: null, nonTenureTrack: null },
    { weekEnd: "2026-08-23", tenureTrack: 20, nonTenureTrack: 80, tenureTrackPct: 20 },
  ]);

  assert.deepEqual(history, [{
    weekEnd: "2026-08-23",
    tenureTrack: 20,
    nonTenureTrack: 80,
    tenureTrackPct: 20,
    nonTenureTrackPct: 80,
  }]);
});

test("appointment-track history calculates missing percentages and keeps the latest 12 weeks", () => {
  const input = Array.from({ length: 14 }, (_, index) => ({
    weekEnd: `week-${index + 1}`,
    tenureTrack: 1,
    nonTenureTrack: 3,
  }));
  const history = appointmentTrackHistory(input);

  assert.equal(history.length, 12);
  assert.equal(history[0].weekEnd, "week-3");
  assert.equal(history[11].weekEnd, "week-14");
  assert.equal(history[0].tenureTrackPct, 25);
  assert.equal(history[0].nonTenureTrackPct, 75);
});
