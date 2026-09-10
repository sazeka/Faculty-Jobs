// Conservative, title/description-only department inference for jobs where
// the scraper never captured a department field. Two methods, both high
// precision by design -- correctness over coverage, since a wrong department
// is worse than an honestly empty one:
//
//   1. inferDepartmentFromTitle: title patterns like "Professor of X",
//      "Lecturer in Y", "Chair, Z" -- the department is explicitly named
//      right after the rank.
//   2. inferDepartmentFromDescription: a genuine LABELED field ("Department:
//      X") in the posting body, terminated at a clear boundary (a double
//      space, or the next known label). Deliberately does NOT do loose prose
//      matching ("in the Department of X") -- tested against the live
//      dataset and that pattern caught real hits but also garbage (a
//      person's name, a UI label fragment leaking in).

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

export function inferDepartmentFromDescription(description) {
  const text = clean(description);
  if (!text) return null;

  const labelBoundary =
    "(?:\\s{2,}|(?=\\s+(?:Location|Salary|Posting|Position Type|Job Type|Category|Division|Campus|College|School|Job Family|Employee Class)\\s*:)|$)";
  const re = new RegExp(`\\bDepartment\\s*:\\s*([A-Za-z][A-Za-z0-9 &/'().,-]{2,60}?)${labelBoundary}`, "i");
  const m = text.match(re);
  if (!m || !m[1]) return null;

  const normalized = normalizeDepartmentValue(m[1]);
  return normalized && looksLikeSafeDepartmentValue(normalized) ? normalized : null;
}

// Title first (highest precision -- the department is part of the job's own
// stated title), then the description's labeled field.
export function inferDepartment(job) {
  return inferDepartmentFromTitle(job?.title) || inferDepartmentFromDescription(job?.description) || null;
}
