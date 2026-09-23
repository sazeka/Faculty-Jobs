import test from "node:test";
import assert from "node:assert/strict";

import { appointmentTrackHistory } from "../../web-vue/src/lib/trendsHistory.js";

test("appointment-track history starts when all four categories are tracked", () => {
  const history = appointmentTrackHistory([
    { weekEnd: "2026-08-16", tenureTrack: null, nonTenureTrack: null },
    { weekEnd: "2026-08-23", tenureTrack: 20, nonTenureTrack: 80, tenureTrackPct: 20 },
    { weekEnd: "2026-09-27", totalJobs: 125, tenureTrack: 20, nonTenureTrack: 80, variableTrack: 5 },
  ]);

  assert.deepEqual(history, [{
    weekEnd: "2026-09-27",
    total: 125,
    tenureTrack: 20,
    nonTenureTrack: 80,
    variableTrack: 5,
    unknown: 20,
    classified: 100,
    tenureTrackPct: 20,
    nonTenureTrackPct: 80,
    tenureTrackTotalPct: 16,
    nonTenureTrackTotalPct: 64,
    variableTrackPct: 4,
    unknownPct: 16,
  }]);
});

test("appointment-track history calculates missing percentages and keeps the latest 12 weeks", () => {
  const input = Array.from({ length: 14 }, (_, index) => ({
    weekEnd: `week-${index + 1}`,
    tenureTrack: 1,
    nonTenureTrack: 3,
    variableTrack: 0,
  }));
  const history = appointmentTrackHistory(input);

  assert.equal(history.length, 12);
  assert.equal(history[0].weekEnd, "week-3");
  assert.equal(history[11].weekEnd, "week-14");
  assert.equal(history[0].tenureTrackPct, 25);
  assert.equal(history[0].nonTenureTrackPct, 75);
});

test("appointment-track history includes variable and unclassified listings in every bar", () => {
  const history = appointmentTrackHistory([{
    weekEnd: "2026-09-27",
    totalJobs: 1000,
    tenureTrack: 200,
    nonTenureTrack: 650,
    variableTrack: 50,
  }]);

  assert.deepEqual(history[0], {
    weekEnd: "2026-09-27",
    total: 1000,
    tenureTrack: 200,
    nonTenureTrack: 650,
    variableTrack: 50,
    unknown: 100,
    classified: 850,
    tenureTrackPct: 23.5,
    nonTenureTrackPct: 76.5,
    tenureTrackTotalPct: 20,
    nonTenureTrackTotalPct: 65,
    variableTrackPct: 5,
    unknownPct: 10,
  });
});

test("appointment-track history excludes earlier weeks without complete category tracking", () => {
  const history = appointmentTrackHistory([{
    weekEnd: "2026-09-20",
    totalJobs: 125,
    tenureTrack: 20,
    nonTenureTrack: 80,
    variableTrack: null,
  }]);

  assert.deepEqual(history, []);
});
