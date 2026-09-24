import assert from "node:assert/strict";
import test from "node:test";
import { scoreAppointmentTrackReview } from "../lib/appointment-track-review.js";

test("scores completed labels without treating unreviewed rows as validated", () => {
  const benchmark = {
    seed: "test",
    reviewSample: [
      { sampleId: "AT-001", stratum: "policy-tenure-track", currentClassification: "tenure-track" },
      { sampleId: "AT-002", stratum: "policy-tenure-track", currentClassification: "tenure-track" },
      { sampleId: "AT-003", stratum: "unclassified-general", currentClassification: "unclassified" },
    ],
  };
  const reviewRows = [
    { sampleId: "AT-001", manualLabel: "tenure-track" },
    { sampleId: "AT-002", manualLabel: "non-tenure-track" },
  ];
  const report = scoreAppointmentTrackReview({ benchmark, reviewRows });
  assert.deepEqual(report.counts, { requested: 3, completed: 2, missing: 1 });
  assert.equal(report.metrics.tenureTrackPrecision.percent, 50);
  assert.equal(report.disagreements.length, 1);
  assert.equal(report.disagreements[0].sampleId, "AT-002");
});

test("can rescore the frozen review against corrected classifications", () => {
  const benchmark = {
    reviewSample: [{ sampleId: "AT-001", stratum: "policy-tenure-track", currentClassification: "tenure-track" }],
  };
  const reviewRows = [{ sampleId: "AT-001", manualLabel: "non-tenure-track" }];
  const report = scoreAppointmentTrackReview({
    benchmark,
    reviewRows,
    currentClassifications: [{ sampleId: "AT-001", currentClassification: "non-tenure-track" }],
  });
  assert.equal(report.disagreements.length, 0);
  assert.equal(report.metrics.nonTenureTrackPrecision.percent, 100);
});
