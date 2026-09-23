export function appointmentTrackHistory(history, limit = 12) {
  if (!Array.isArray(history)) return []

  return history
    .filter((week) => {
      const tenureTrack = Number(week?.tenureTrack)
      const nonTenureTrack = Number(week?.nonTenureTrack)
      const hasCompleteCategoryTracking = week?.variableTrack != null
      return hasCompleteCategoryTracking
        && Number.isFinite(tenureTrack) && tenureTrack >= 0
        && Number.isFinite(nonTenureTrack) && nonTenureTrack >= 0
        && tenureTrack + nonTenureTrack > 0
    })
    .map((week) => {
      const tenureTrack = Number(week.tenureTrack)
      const nonTenureTrack = Number(week.nonTenureTrack)
      const suppliedVariableTrack = week.variableTrack == null ? 0 : Number(week.variableTrack)
      const variableTrack = Number.isFinite(suppliedVariableTrack) && suppliedVariableTrack >= 0
        ? suppliedVariableTrack
        : 0
      const classified = tenureTrack + nonTenureTrack
      const suppliedUnknown = week.appointmentTrackUnknown ?? week.unknown
      const parsedUnknown = suppliedUnknown == null ? null : Number(suppliedUnknown)
      const suppliedTotal = Number(week.totalJobs)
      const minimumTotal = classified + variableTrack
      const total = Number.isFinite(suppliedTotal) && suppliedTotal >= minimumTotal
        ? suppliedTotal
        : minimumTotal + (Number.isFinite(parsedUnknown) && parsedUnknown >= 0 ? parsedUnknown : 0)
      const unknown = Number.isFinite(parsedUnknown) && parsedUnknown >= 0
        ? parsedUnknown
        : Math.max(0, total - minimumTotal)
      const suppliedTenurePct = week.tenureTrackPct == null ? null : Number(week.tenureTrackPct)
      const tenureTrackPct = Number.isFinite(suppliedTenurePct)
        ? Math.min(100, Math.max(0, suppliedTenurePct))
        : Number(((tenureTrack / classified) * 100).toFixed(1))
      const shareOfTotal = (count) => total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0

      return {
        weekEnd: week.weekEnd,
        total,
        tenureTrack,
        nonTenureTrack,
        variableTrack,
        unknown,
        classified,
        tenureTrackPct,
        nonTenureTrackPct: Number((100 - tenureTrackPct).toFixed(1)),
        tenureTrackTotalPct: shareOfTotal(tenureTrack),
        nonTenureTrackTotalPct: shareOfTotal(nonTenureTrack),
        variableTrackPct: shareOfTotal(variableTrack),
        unknownPct: shareOfTotal(unknown),
      }
    })
    .slice(-Math.max(1, Number(limit) || 12))
}
