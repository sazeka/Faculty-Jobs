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

// Bare generic organizational nouns with no qualifying name attached --
// "School", "Department" on their own aren't department names, just a word
// that happened to appear (often in unrelated boilerplate like "...within
// the framework of common syllabi provided by the school."). A qualified
// form like "School of Nursing" or "Department of Radiology" is fine and
// won't match here since it's more than one word.
const BARE_GENERIC_NOUNS = new Set([
  "school", "department", "division", "program", "office", "institute",
  "college", "unit", "faculty", "staff", "center", "centre", "area",
  "group", "team", "district",
]);

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
  if (BARE_GENERIC_NOUNS.has(v.toLowerCase())) return false;
  // A run of 3+ consecutive digits is a strong signal of a leaked street
  // number, zip code, or requisition ID rather than an actual department --
  // some job boards (e.g. Fresno-area community colleges) glue the campus
  // address directly onto the title with no separator ("...in Criminology1717
  // S Chestnut Ave, Fresno").
  if (/\d{3,}/.test(v)) return false;
  // A department name is a noun phrase, not a sentence -- these words show
  // up almost exclusively when the capture ran on into an unrelated
  // sentence fragment (e.g. a title like "Faculty Opportunities Clinical,
  // research and leadership positions are available in our world-renowned
  // clinics and labs." leaking "...positions are available in our...").
  if (/\b(?:is|are|were|have been|will be|available|located|responsible for|include[s]?)\b/i.test(v)) return false;
  // "Faculty of Practice" is itself a rank/classification (like "Clinical
  // Faculty"), not a department -- "Practice" as the leading word is this
  // false positive nearly every time ("Contracted Faculty of Practice
  // (Adjunct): EdD and PhD Kinesiology Dissertation Advisors...").
  if (/^practice\b/i.test(v)) return false;
  // A central administrative office, not an academic department -- shows up
  // when a job posting's contact-info boilerplate ("...let Human Resources
  // know by submitting your information...") gets mistaken for the actual
  // department. A faculty posting is essentially never itself "in" HR.
  if (/^human resources$/i.test(v)) return false;
  return true;
}

function normalizeDepartmentValue(value) {
  let v = clean(value).replace(/[.;,:]+\s*$/g, "");
  // Strip a leaked academic-year prefix ("2026/2027: ...", "AY 2026-27 - ...").
  v = v.replace(/^(?:AY\s*)?'?\d{2,4}\s*[/-]\s*\d{2,4}\b\s*[:\-]?\s*/i, "");
  // Strip a leaked leading article ("...in the Department of X").
  v = v.replace(/^(?:the|an?)\s+/i, "");
  // Strip a leaked "Unit Name" form-field label -- some HR systems
  // (PeopleAdmin-style) render structured posting fields glued together with
  // no separator ("...Position Title X Unit Name Academic Affairs Salary
  // Grade..."), and the model quotes the label along with the value.
  v = v.replace(/^unit name\s+/i, "");
  v = v.replace(/\s{2,}/g, " ").trim();
  return v || null;
}

export function inferDepartmentFromTitle(title) {
  const t = clean(title);
  if (!t) return null;

  let m = t.match(/\b(?:Professor|Lecturer|Instructor|Chair|Faculty)\s+(?:of|in)\s+(.+)$/i);
  if (!m) m = t.match(/\bPost(?:doc|doctoral)\b.*?\bin\s+(.+)$/i);
  if (!m) {
    const commaMatch = t.match(/\b(?:Professor|Lecturer|Instructor|Chair|Faculty)[^,]*,\s*([A-Za-z][A-Za-z0-9 &/'().-]{2,100})$/i);
    if (commaMatch) m = [commaMatch[0], commaMatch[1]];
  }
  if (!m) {
    // "Adjunct Faculty – English, Literature, & Writing" -- an em/en-dash
    // (or plain hyphen set off by spaces, to avoid matching a hyphenated
    // compound word) after "Faculty" instead of a comma or "of/in".
    const dashMatch = t.match(/\bFaculty\s*[-–—]\s*([A-Za-z][A-Za-z0-9 &,/'().-]{2,100})$/i);
    if (dashMatch) m = [dashMatch[0], dashMatch[1]];
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

  // The institution's own name (or a shortened/aliased form of it) is not a
  // department -- generic "About Us" boilerplate gives the model a real,
  // grounded quote containing the college's name, and it sometimes extracts
  // that as if it were the department: an exact repeat ("Aims Community
  // College" for a college of the same name), or a shortened alias ("Harper
  // College" for "William Rainey Harper College"; "Forsyth Tech" for
  // "Forsyth Technical Community College"). Only check department-inside-
  // college, one direction: a real (if verbose) department legitimately
  // cites the full institution name as part of a longer, genuine value
  // ("Department of Anesthesiology at the Medical College of Wisconsin"),
  // so the reverse direction is NOT safe to reject on.
  if (job.college) {
    const collegeLower = clean(job.college).toLowerCase();
    const deptLower = dept.toLowerCase();
    if (collegeLower.includes(deptLower)) return null;
  }

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
