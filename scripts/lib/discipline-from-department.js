// discipline-from-department.js
//
// Fills the `discipline` field for free by reusing disciplines the AI
// enrichment pass (agent-job-enrichment.js) has already assigned elsewhere in
// the dataset -- no network calls, safe to run in CI. A cleaned `department`
// string is looked up against the vocabulary of discipline values the AI has
// already validated; a hit is trusted because it's an exact match against a
// term a model has independently confirmed names a real academic field, not a
// fresh guess at a novel string.
//
// This deliberately does NOT try to interpret department text the AI hasn't
// already vetted -- freeform cleanup of unvetted department strings (course
// codes, internal abbreviations, institution/city/state names that leak into
// the field from some sources) was tried and produced real false positives
// ("Pennsylvania", "Technical College of the Lowcountry", "OKLAHOMA CITY
// (OKC)" all "cleaned" into plausible-looking but wrong discipline values).
// Gating on the AI's own vocabulary avoids that: none of those strings will
// ever coincidentally equal a term the model has validated as an academic
// field, so the false-positive surface collapses to near zero.

// Values that occasionally leak into `discipline` from earlier AI passes but
// are not actually academic fields -- excluded from the reuse vocabulary so
// they're never propagated onto more jobs.
const NON_DISCIPLINE_VALUES = new Set([
  'unknown', 'other', 'instruction', 'clinical', 'staff', 'adjunct', 'various',
  'tbd', 'n/a', 'academic affairs', 'academic instruction', 'faculty',
  'general studies', 'general education', 'university studies',
  'university transfer', 'continuing education', 'human resources',
  "president's office", 'office of the provost',
]);

const DEPT_OF_PREFIX_RE = /^\s*(Department|Division|Dept\.?|School|College)\s+of\s+/i;
const OF_PREFIX_RE = /^\s*Of\s+/i;
const FACULTY_PREFIX_RE = /^\s*Faculty\s*[-–]\s*/i;
const REGION_SUFFIX_RE = /\s*Region:.*$/i;
const TRAILING_DEPT_SUFFIX_RE = /\s+(Department|Dept\.?|Programs?)\s*$/i;

// Strips the institutional wrapper text that surrounds an otherwise-clean
// discipline name in scraped `department` strings ("Department of Nursing",
// "School of Nursing", "Faculty - Business", "Biology Region: Finger Lakes
// Open until filled"). Never invents or expands abbreviations -- only removes
// known boilerplate, so the result is either the discipline itself or still
// unrecognizable junk that the vocabulary lookup will reject.
export function cleanDepartmentText(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(REGION_SUFFIX_RE, '').trim();
  s = s.replace(DEPT_OF_PREFIX_RE, '').trim();
  s = s.replace(OF_PREFIX_RE, '').trim();
  s = s.replace(FACULTY_PREFIX_RE, '').trim();
  s = s.replace(TRAILING_DEPT_SUFFIX_RE, '').trim();
  // A single unmatched paren is a scraping artifact ("Biochemistry)"), not a
  // meaningful part of the name -- but a balanced pair ("(Studio Art)") is.
  if (s.endsWith(')') && !s.includes('(')) s = s.slice(0, -1).trim();
  if (s.startsWith('(') && !s.includes(')')) s = s.slice(1).trim();
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/[.,;:]+$/, '').trim();
  return s;
}

export function isKnownDisciplineValue(value) {
  const s = String(value || '').trim();
  if (!s || s.length < 3 || s.toLowerCase() === 'null') return false;
  return !NON_DISCIPLINE_VALUES.has(s.toLowerCase());
}

// Builds a lowercase -> canonical-cased lookup of every discipline value the
// AI has already assigned somewhere in `jobs`, picking the most frequently
// seen casing as canonical so aggregation (e.g. "Top disciplines") doesn't
// fragment "computer science" vs "Computer Science".
export function buildKnownDisciplineVocabulary(jobs = []) {
  const counts = new Map(); // lowercase key -> Map(cased value -> count)
  for (const job of jobs) {
    const raw = job?.discipline;
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!isKnownDisciplineValue(value)) continue;
    const key = value.toLowerCase();
    const byCase = counts.get(key) || new Map();
    byCase.set(value, (byCase.get(value) || 0) + 1);
    counts.set(key, byCase);
  }

  const vocabulary = new Map();
  for (const [key, byCase] of counts) {
    const canonical = [...byCase.entries()].sort((a, b) => b[1] - a[1])[0][0];
    vocabulary.set(key, canonical);
  }
  return vocabulary;
}

// Returns a discipline value reused from `vocabulary`, or null if the cleaned
// department text isn't an exact (case-insensitive) match for a discipline
// the AI has already validated.
export function deriveDisciplineFromDepartment(department, vocabulary) {
  const cleaned = cleanDepartmentText(department);
  if (!cleaned) return null;
  return vocabulary.get(cleaned.toLowerCase()) || null;
}
