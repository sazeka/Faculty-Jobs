// Conservative title-only department inference for jobs where the scraper
// never captured a department field. High precision by design -- correctness
// over coverage, since a wrong department is worse than an honestly empty
// one.
//
// inferDepartmentFromTitle: title patterns like "Professor of X", "Lecturer
// in Y", "Chair, Z" -- the department is explicitly named right after the
// rank, right in the job's own stated title.
//
// A separate, more sophisticated extractor already exists for the
// description-label case ("Department: X" in the posting body) --
// scripts/lib/labeled-posting-fields.js's extractDepartmentFromText -- so
// this module intentionally does not duplicate that.

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// Reject candidate values that don't look like a plausible department name,
// even if they matched the extraction regex -- a cheap backstop against
// leaked boilerplate, contact info, or clearly-too-long fragments. Exported
// for reuse by the AI-assisted extractor (agent-department-enrichment.js),
// which needs the same sanity bar applied to a model's free-text answer.
export function looksLikeSafeDepartmentValue(value) {
  const v = clean(value);
  if (!v || v.length < 3 || v.length > 90) return false;
  if (/https?:\/\/|@|\.(com|edu|org|gov)\b/i.test(v)) return false;
  if (/^\d+$/.test(v)) return false;
  if (/\b(?:apply|click here|read more|learn more|link is external|external link)\b/i.test(v)) return false;
  return true;
}

function normalizeDepartmentValue(value) {
  let v = clean(value).replace(/[.;,:]+\s*$/g, "");
  // Strip a leaked academic-year prefix ("2026/2027: ...", "AY 2026-27 - ...").
  v = v.replace(/^(?:AY\s*)?'?\d{2,4}\s*[/-]\s*\d{2,4}\b\s*[:\-]?\s*/i, "");
  v = v.replace(/\s{2,}/g, " ").trim();
  return v || null;
}

export function inferDepartmentFromTitle(title) {
  const t = clean(title);
  if (!t) return null;

  let m = t.match(/\b(?:Professor|Lecturer|Instructor|Chair)\s+(?:of|in)\s+(.+)$/i);
  if (!m) m = t.match(/\bPost(?:doc|doctoral)\b.*?\bin\s+(.+)$/i);
  if (!m) {
    const commaMatch = t.match(/\b(?:Professor|Lecturer|Instructor|Chair)[^,]*,\s*([A-Za-z][A-Za-z0-9 &/'().-]{2,100})$/i);
    if (commaMatch) m = [commaMatch[0], commaMatch[1]];
  }
  if (!m || !m[1]) return null;

  const normalized = normalizeDepartmentValue(m[1]);
  return normalized && looksLikeSafeDepartmentValue(normalized) ? normalized : null;
}

// Grounding check for AI-extracted department values (used by
// agent-department-enrichment.js): the model must supply a short verbatim
// quote from the job's own title/description that names the department, and
// that exact quote must actually appear in the source text. This is the same
// anti-hallucination pattern already used for AI-extracted tenure evidence in
// scripts/lib/enrichment-response.js's validateAiTenureEvidence -- a model
// asked to "extract" a field will sometimes just invent a plausible-sounding
// one instead, and a free-text quote is far harder to fabricate consistently
// with the actual source than a bare department name is.
export function validateAiDepartmentEvidence(department, quote, job = {}) {
  const dept = normalizeDepartmentValue(department);
  if (!dept || !looksLikeSafeDepartmentValue(dept)) return null;

  const normalizedQuote = clean(quote).toLowerCase();
  if (normalizedQuote.length < 6) return null;

  const source = clean(`${job.title || ""} ${job.description || ""}`).toLowerCase();
  if (!source.includes(normalizedQuote)) return null;

  // The quote must also plausibly be about *this* department -- require the
  // department name (or its first significant word, since the model may quote
  // a longer surrounding phrase than the department value itself) to appear
  // within the quote.
  const deptWords = dept.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const firstWord = deptWords[0];
  if (firstWord && !normalizedQuote.includes(firstWord)) return null;

  return dept;
}
