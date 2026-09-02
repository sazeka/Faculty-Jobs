const NON_TENURE_RE = /\b(?:non[\s-]?tenure(?:[\s-]?(?:track|accru(?:ing|al)|eligible))?|non[\s-]?tenurable|without\s+tenure|not\s+(?:a\s+)?tenure[\s-]?(?:track|eligible|accruing)|not\s+eligible\s+for\s+tenure|ntt|teaching[\s-]?track|instructional[\s-]?track|professional[\s-]?track|practice[\s-]?track|clinical[\s-]?track|research[\s-]?track|fixed[\s-]?term|term[\s-]?faculty|contingent)\b/i;
const TENURE_RE = /\b(?:tenure[\s-]?(?:track|stream|eligible|accru(?:ing|al)|earning|line)|eligible\s+for\s+tenure|(?:appoint(?:ed|ment)|position|rank|role)\b.{0,40}\bwith\s+tenure|tenured)\b/i;
const CLEARLY_NON_TENURE_TITLE_RE = /\b(?:adjunct|visiting|post[\s-]?doc(?:toral)?|temporary|part[\s-]?time|professor\s+of\s+practice)\b/i;

function explicitSignals(raw) {
  const text = String(raw || "");
  const nonTenure = NON_TENURE_RE.test(text);
  // Remove negative/alternative phrases before testing for a positive tenure
  // signal; otherwise "non-tenure-track" also matches "tenure-track".
  const positiveText = text.replace(new RegExp(NON_TENURE_RE.source, "gi"), " ");
  const tenure = TENURE_RE.test(positiveText);
  return { tenure, nonTenure };
}

export function classifyTenureTrackWithEvidence(job = {}) {
  const value = job.tenureTrack;
  if (value === true || value === false) {
    return { value, evidence: job.tenureEvidence || "stored" };
  }

  const status = String(value || "").toLowerCase().trim();
  const stored = explicitSignals(status);
  if (stored.nonTenure && !stored.tenure) return { value: false, evidence: job.tenureEvidence || "stored" };
  if (stored.tenure && !stored.nonTenure) return { value: true, evidence: job.tenureEvidence || "stored" };

  const title = String(job.title || "");
  const titleSignals = explicitSignals(title);
  if (titleSignals.nonTenure && !titleSignals.tenure) return { value: false, evidence: "title-explicit" };
  if (titleSignals.tenure && !titleSignals.nonTenure) return { value: true, evidence: "title-explicit" };

  // These ranks or appointment qualifiers are definitionally non-tenure-track.
  // Do not extend this shortcut to lecturer, instructor, clinical, research,
  // or professor generally: those can be on either track by institution.
  const rankText = `${title} ${job.positionType || ""}`;
  if (CLEARLY_NON_TENURE_TITLE_RE.test(rankText)) return { value: false, evidence: "title-rank" };

  const descriptionSignals = explicitSignals(job.description);
  if (descriptionSignals.nonTenure && !descriptionSignals.tenure) return { value: false, evidence: "description-explicit" };
  if (descriptionSignals.tenure && !descriptionSignals.nonTenure) return { value: true, evidence: "description-explicit" };
  return { value: null, evidence: null };
}

export function classifyTenureTrack(job = {}) {
  return classifyTenureTrackWithEvidence(job).value;
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
