import test from "node:test";
import assert from "node:assert/strict";

import { appointmentTrackHistory, disciplineClassificationHistory } from "../../web-vue/src/lib/trendsHistory.js";

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

test("discipline-classification history ignores weeks recorded before the metric was tracked", () => {
  const history = disciplineClassificationHistory([
    { weekEnd: "2026-08-16", disciplineClassifiedPct: null },
    { weekEnd: "2026-08-23", disciplineClassified: 40, disciplineUnknown: 60, disciplineClassifiedPct: 40 },
  ]);

  assert.deepEqual(history, [{
    weekEnd: "2026-08-23",
    classified: 40,
    unknown: 60,
    classifiedPct: 40,
  }]);
});

test("discipline-classification history keeps only the latest 12 weeks", () => {
  const input = Array.from({ length: 14 }, (_, index) => ({
    weekEnd: `week-${index + 1}`,
    disciplineClassified: 20,
    disciplineUnknown: 80,
    disciplineClassifiedPct: 20,
  }));
  const history = disciplineClassificationHistory(input);

  assert.equal(history.length, 12);
  assert.equal(history[0].weekEnd, "week-3");
  assert.equal(history[11].weekEnd, "week-14");
});
