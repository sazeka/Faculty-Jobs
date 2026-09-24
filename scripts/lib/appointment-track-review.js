const BINARY_LABELS = new Set(["tenure-track", "non-tenure-track"]);
const VALID_LABELS = new Set([...BINARY_LABELS, "variable", "unclassified"]);

function pct(numerator, denominator) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(1)) : null;
}

function wilson95(successes, total) {
  if (!total) return null;
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return {
    lowPercent: Number((Math.max(0, center - margin) * 100).toFixed(1)),
    highPercent: Number((Math.min(1, center + margin) * 100).toFixed(1)),
  };
}

function metric(rows, pass) {
  const successes = rows.filter(pass).length;
  return {
    successes,
    total: rows.length,
    percent: pct(successes, rows.length),
    confidenceInterval95: wilson95(successes, rows.length),
  };
}

export function scoreAppointmentTrackReview({ benchmark, reviewRows, currentClassifications = null }) {
  const sample = Array.isArray(benchmark?.reviewSample) ? benchmark.reviewSample : [];
  const labelsById = new Map((Array.isArray(reviewRows) ? reviewRows : []).map((row) => [row.sampleId, row]));
  const currentById = new Map(
    (Array.isArray(currentClassifications) ? currentClassifications : []).map((row) => [row.sampleId, row.currentClassification])
  );
  const rows = sample.map((sampleRow) => {
    const review = labelsById.get(sampleRow.sampleId) || {};
    return {
      ...sampleRow,
      currentClassification: currentById.get(sampleRow.sampleId) || sampleRow.currentClassification,
      manualLabel: review.manualLabel || "",
      manualEvidenceUrl: review.manualEvidenceUrl || "",
      reviewer: review.reviewer || "",
      reviewNotes: review.reviewNotes || "",
    };
  });
  const invalid = rows.filter((row) => row.manualLabel && !VALID_LABELS.has(row.manualLabel));
  if (invalid.length) throw new Error(`Invalid manualLabel for ${invalid.map((row) => row.sampleId).join(", ")}`);

  const completed = rows.filter((row) => VALID_LABELS.has(row.manualLabel));
  const binaryTenure = completed.filter((row) => row.currentClassification === "tenure-track");
  const binaryNonTenure = completed.filter((row) => row.currentClassification === "non-tenure-track");
  const policy = completed.filter((row) => row.stratum.startsWith("policy-"));
  const explicit = completed.filter((row) => row.stratum.startsWith("explicit-"));
  const variable = completed.filter((row) => row.stratum === "variable-track");
  const abstentions = completed.filter((row) => row.stratum.startsWith("unclassified-"));
  const exactAgreement = (row) => row.currentClassification === row.manualLabel;

  return {
    benchmark: "Faculty Atlas appointment-track single-reviewer evidence audit",
    generatedAt: new Date().toISOString(),
    seed: benchmark?.seed || null,
    methodology: {
      reviewType: "Single-reviewer evidence audit",
      evidence: "Official posting text and cited official institution-policy sources.",
      limitation: "This is not an independent two-coder validation and does not satisfy the AT-16 inter-rater reliability benchmark.",
    },
    counts: {
      requested: sample.length,
      completed: completed.length,
      missing: sample.length - completed.length,
    },
    metrics: {
      tenureTrackPrecision: metric(binaryTenure, (row) => row.manualLabel === "tenure-track"),
      nonTenureTrackPrecision: metric(binaryNonTenure, (row) => row.manualLabel === "non-tenure-track"),
      institutionPolicyAgreement: metric(policy, exactAgreement),
      explicitControlAgreement: metric(explicit, exactAgreement),
      variableTrackAgreement: metric(variable, exactAgreement),
      unclassifiedAbstentionQuality: metric(abstentions, (row) => row.manualLabel === "unclassified"),
    },
    byStratum: Object.fromEntries(
      [...new Set(completed.map((row) => row.stratum))].map((stratum) => {
        const stratumRows = completed.filter((row) => row.stratum === stratum);
        return [stratum, metric(stratumRows, exactAgreement)];
      })
    ),
    disagreements: completed.filter((row) => !exactAgreement(row)).map((row) => ({
      sampleId: row.sampleId,
      stratum: row.stratum,
      college: row.college,
      title: row.title,
      classifier: row.currentClassification,
      reviewer: row.manualLabel,
      evidenceUrl: row.manualEvidenceUrl,
      notes: row.reviewNotes,
    })),
    reviewSample: rows,
  };
}
