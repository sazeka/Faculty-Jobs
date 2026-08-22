const NON_TENURE_EVIDENCE_RE = /\b(?:non[\s-]?tenure(?:[\s-]?track)?|ntt|fixed[\s-]?term|temporary|adjunct|visiting|post[\s-]?doctoral|teaching[\s-]?track|instructional[\s-]?track|clinical[\s-]?track|research[\s-]?track|practice[\s-]?track)\b/i;
const TENURE_EVIDENCE_RE = /\b(?:tenure[\s-]?track|tenure[\s-]?stream|tenure[\s-]?eligible|tenured)\b/i;

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function alignEnrichmentResults(results, expectedLength) {
  if (!Array.isArray(results) || results.length !== expectedLength) return null;
  const aligned = Array(expectedLength);
  for (const result of results) {
    const itemId = Number(result?.itemId);
    if (!Number.isInteger(itemId) || itemId < 1 || itemId > expectedLength || aligned[itemId - 1]) {
      return null;
    }
    aligned[itemId - 1] = result;
  }
  return aligned.every(Boolean) ? aligned : null;
}

export function validateAiTenureEvidence(value, evidence, job = {}) {
  if (!['tenure-track', 'non-tenure-track'].includes(value)) return null;
  const quote = normalizeText(evidence);
  if (quote.length < 6) return null;

  const source = normalizeText(`${job.title || ""} ${job.description || ""}`);
  if (!source.includes(quote)) return null;

  if (value === 'tenure-track') {
    const withoutNegative = quote.replace(new RegExp(NON_TENURE_EVIDENCE_RE.source, 'gi'), ' ');
    return TENURE_EVIDENCE_RE.test(withoutNegative) ? quote : null;
  }
  return NON_TENURE_EVIDENCE_RE.test(quote) ? quote : null;
}
