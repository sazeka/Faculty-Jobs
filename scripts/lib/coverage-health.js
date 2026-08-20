export function findCoverageRegressions(report, { maxMissing = 0, maxPending = 0 } = {}) {
  const totals = report?.totals || {};
  const missing = Number(totals.missing || 0);
  const pending = Number(totals.pending_review || 0);
  const issues = [];
  if (missing > maxMissing) issues.push({ kind: "missing", actual: missing, allowed: maxMissing });
  if (pending > maxPending) issues.push({ kind: "pending_review", actual: pending, allowed: maxPending });
  return issues;
}

export function lowerCoverageThresholds(current, report) {
  const totals = report?.totals || {};
  const missing = Number(totals.missing || 0);
  const pending = Number(totals.pending_review || 0);
  const maxMissing = Number.isFinite(Number(current?.maxMissing)) ? Number(current.maxMissing) : missing;
  const maxPending = Number.isFinite(Number(current?.maxPending)) ? Number(current.maxPending) : pending;
  return {
    ...current,
    maxMissing: Math.min(maxMissing, missing),
    maxPending: Math.min(maxPending, pending),
  };
}
