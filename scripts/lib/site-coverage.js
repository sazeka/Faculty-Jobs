export function coverageSummaryFromReport(report) {
  const totals = report?.totals || {};
  const total = Number(totals.eligible_universe);
  const covered = Number(totals.covered);
  const excluded = Number(totals.excluded_policy);
  const quality = report?.qualityLevels?.totals || {};

  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(covered) || covered < 0) {
    return null;
  }

  return {
    covered,
    total,
    excluded: Number.isFinite(excluded) && excluded >= 0 ? excluded : 0,
    percent: Number(((covered / total) * 100).toFixed(2)),
    quality: {
      directJobBoard: Number(quality.direct_job_board) || 0,
      sharedSystemBoard: Number(quality.verified_shared_system_board) || 0,
      officialEmploymentPage: Number(quality.official_employment_page) || 0,
      homepageFallback: Number(quality.homepage_fallback) || 0,
      noPublicHiringSource: Number(quality.no_public_hiring_source) || 0,
      unresolved: Number(quality.unresolved) || 0,
      closedOrOutOfScope: Number(quality.closed_or_out_of_scope) || 0,
    },
  };
}

export function attachUniversityCoverage(siteStats, report) {
  const summary = coverageSummaryFromReport(report);
  return summary ? { ...(siteStats || {}), universityCoverage: summary } : { ...(siteStats || {}) };
}
