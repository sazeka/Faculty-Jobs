export function classifyTenureTrack(job = {}) {
  const value = job.tenureTrack;
  if (value === true || value === false) return value;

  const status = String(value || "").toLowerCase().trim();
  if (/\bnon[\s-]?tenure|\bntt\b/.test(status)) return false;
  if (/tenure[\s-]?track|tenure[\s-]?stream|tenure[\s-]?eligible|\btenured\b/.test(status)) return true;

  // Only explicit title language is strong enough to fill an unknown stored
  // value. Professor rank alone does not imply tenure status.
  const title = String(job.title || "").toLowerCase();
  if (/\bnon[\s-]?tenure|\bntt\b/.test(title)) return false;
  if (/tenure[\s-]?track|tenure[\s-]?stream|tenure[\s-]?eligible|\btenured\b/.test(title)) return true;
  return null;
}

export function computeTenureTrackBreakdown(jobs = []) {
  let tenureTrack = 0;
  let nonTenureTrack = 0;
  let unknown = 0;

  for (const job of jobs) {
    const classification = classifyTenureTrack(job);
    if (classification === true) tenureTrack++;
    else if (classification === false) nonTenureTrack++;
    else unknown++;
  }

  const classified = tenureTrack + nonTenureTrack;
  return {
    tenureTrack,
    nonTenureTrack,
    unknown,
    classified,
    tenureTrackPct: classified ? Number(((tenureTrack / classified) * 100).toFixed(1)) : 0,
    nonTenureTrackPct: classified ? Number(((nonTenureTrack / classified) * 100).toFixed(1)) : 0,
  };
}
