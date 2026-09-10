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
// leaked boilerplate, contact info, or clearly-too-long fragments.
function looksLikeSafeDepartmentValue(value) {
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
