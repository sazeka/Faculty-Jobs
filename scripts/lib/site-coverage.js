export function coverageSummaryFromReport(report) {
  const totals = report?.totals || {};
  const total = Number(totals.eligible_universe);
  const covered = Number(totals.covered);
  const excluded = Number(totals.excluded_policy);

  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(covered) || covered < 0) {
    return null;
  }

  return {
    covered,
    total,
    excluded: Number.isFinite(excluded) && excluded >= 0 ? excluded : 0,
    percent: Number(((covered / total) * 100).toFixed(2)),
  };
}

export function attachUniversityCoverage(siteStats, report) {
  const summary = coverageSummaryFromReport(report);
  return summary ? { ...(siteStats || {}), universityCoverage: summary } : { ...(siteStats || {}) };
}
