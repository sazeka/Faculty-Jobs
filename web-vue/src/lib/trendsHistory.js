export function appointmentTrackHistory(history, limit = 12) {
  if (!Array.isArray(history)) return []

  return history
    .filter((week) => {
      const tenureTrack = Number(week?.tenureTrack)
      const nonTenureTrack = Number(week?.nonTenureTrack)
      return Number.isFinite(tenureTrack) && tenureTrack >= 0
        && Number.isFinite(nonTenureTrack) && nonTenureTrack >= 0
        && tenureTrack + nonTenureTrack > 0
    })
    .map((week) => {
      const tenureTrack = Number(week.tenureTrack)
      const nonTenureTrack = Number(week.nonTenureTrack)
      const classified = tenureTrack + nonTenureTrack
      const suppliedTenurePct = week.tenureTrackPct == null ? null : Number(week.tenureTrackPct)
      const tenureTrackPct = Number.isFinite(suppliedTenurePct)
        ? Math.min(100, Math.max(0, suppliedTenurePct))
        : Number(((tenureTrack / classified) * 100).toFixed(1))

      return {
        weekEnd: week.weekEnd,
        tenureTrack,
        nonTenureTrack,
        tenureTrackPct,
        nonTenureTrackPct: Number((100 - tenureTrackPct).toFixed(1)),
      }
    })
    .slice(-Math.max(1, Number(limit) || 12))
}
