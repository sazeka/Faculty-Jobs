// Shared department validator/normalizer (issue #130).
//
// Several call sites independently decided whether a raw scraped `department`
// value was usable: the frontend's display path rejected garbage before
// rendering it, but `scorePost()`'s completeness scoring and the confidence
// badges in `useJobFilters.js` both trusted the raw, unvalidated string. That
// let a record with an obviously-malformed department (a truncated sentence,
// a scraper artifact like "Region: Finger Lakes Open until filled" appended
// to the real value, leftover parenthetical text, digit/punctuation-prefixed
// noise) still earn "Department Tagged" / completeness credit even though the
// UI itself would refuse to display it.
//
// This is the one validator all of those call sites should use, so a
// record's completeness score, confidence badges, and rendered department
// always agree on what counts as a real value.
//
// Pass the listing's `college` and `location` when they are known so a
// Department field that only repeats the institution or campus city is not
// counted as a hiring unit. `cleanJobDepartment(job)` does that for a job.
export function cleanDepartment(dept, { college, location } = {}) {
  if (!dept) return null
  const s = String(dept).replace(/\s+/g, ' ').trim()
  if (!s || s.length < 3) return null
  if (s.length > 80) return null // likely a description, not a department
  if (/^[\d()\-,]/.test(s)) return null // starts with digit, bracket, or punctuation
  if (/\.\s[a-z]/.test(s)) return null // sentence break mid-string
  if (/\)\s/.test(s)) return null // leftover parenthetical noise
  if (/^\d{4}\s/.test(s)) return null // starts with year
  if (/\b(position|posted|internal only|open until filled|all ranks|region:)\b/i.test(s)) return null
  // Administrative hiring buckets and copied job titles are not academic units.
  if (/^(?:human resources|academic affairs|provost(?:\/|\b)|faculty\s*[-–—]\s*university transfer|(?:associate|adjunct|assistant|visiting)\s+faculty\s*[-–—])/i.test(s)) return null
  // Some sources put the job role in the Department field. A standalone role
  // cannot identify a hiring unit, even when it is a non-empty string.
  if (/^(?:adjunct(?: faculty)?|instructor|lecturer|professor|faculty(?:\s*\(open rank\))?|open pool|visiting faculty|research faculty|clinical faculty)$/i.test(s)) return null
  // Offices and instruction-wide buckets hire across every subject, so they
  // cannot say which unit a listing belongs to.
  if (/\b(?:academic|student) affairs\b|\bguided career pathways\b|\bdean'?s?'? office\b|\boffice of the (?:dean|president|provost)\b|^district office$|^office of instruction$|^vpi\b/i.test(s)) return null
  if (/^(?:academic\s+)?instruction(?:al services)?(?:\s+(?:[\w-]+\s+)?campus)?$/i.test(s)) return null
  // Appointment types and hiring terms describe the job, not the unit.
  if (/^(?:non[- ])?tenure[- ]track$|^(?:full|part)[- ]?time$/i.test(s)) return null
  if (/^(?:(?:fall|spring|summer|winter)(?:\s+term)?\s+\d{4}(?:\s*(?:&|and|\/|,)\s*)?)+$/i.test(s)) return null
  // A campus or an institution's own name is a location, not a hiring unit.
  if (/^(?:[A-Za-z.']+\s+){0,3}campus$/i.test(s)) return null
  if (isInstitutionName(s)) return null
  // Nothing left but pools, terms, roles, campuses or institution names.
  if (s.replace(/\s*\([^)]*\)/g, ' ').split(DEPARTMENT_SEPARATOR).every(isNoiseSegment)) return null
  if (sameName(s, college)) return null
  const city = String(location || '').split(',')[0]
  if (sameName(s.replace(/\s*\([^)]*\)\s*$/, ''), city)) return null
  return s
}

export function cleanJobDepartment(job) {
  return cleanDepartment(job?.department, { college: job?.college, location: job?.location })
}

function nameKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f'’ʻ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim()
}

function sameName(a, b) {
  const left = nameKey(a)
  return Boolean(left) && left === nameKey(b)
}

// Whole-value institution names such as "Piedmont Technical College",
// "University of Hawai'i at Hilo" or "State University". A value with a
// subject attached ("Biology - Idabel Campus") is left for
// canonicalDepartment() to trim.
function isInstitutionName(s) {
  if (/\s[-–—]\s|[,;]/.test(s)) return false
  if (/^(?:the\s+)?(?:college|technical college|community college|state university|university)$/i.test(s)) return true
  if (/\b(?:community|technical|junior)\s+college$/i.test(s)) return true
  return /^university of\b/i.test(s) && !/\b(?:department|school|college of|program)\b/i.test(s)
}

export const DEPARTMENT_SEPARATOR = /\s+[-–—]\s+|\s*;\s*/

// A whole segment that names a hiring pool, term, role, campus, posting code
// or institution rather than an academic unit.
export function isNoiseSegment(segment) {
  const s = String(segment || '').trim()
  if (!s) return true
  if (/^(?:creating an?\s+)?(?:open\s+|adjunct\s+|department\s+)?pool(?:\s+posting)?$/i.test(s)) return true
  if (/^(?:adjunct|part[- ]?time|full[- ]?time|open)(?:\s+(?:faculty|pool|posting))*$/i.test(s)) return true
  if (/^(?:non[- ])?tenure[- ]track$|^open rank$/i.test(s)) return true
  if (/^(?:(?:associate|assistant|adjunct|visiting|clinical|research|full)\s+)*(?:faculty|instructor|lecturer|professor)(?:\s*[-–—]?\s*open (?:pool|rank))?$/i.test(s)) return true
  if (/^(?:fy|ay)\s*\d{2,4}(?:[-–/]\d{2,4})?$|^\d{1,2}[- ]month$|^(?:fall|spring|summer|winter)(?:\s+term)?\s+\d{4}\)?$|^\d{4}(?:[-–/]\d{2,4})?$/i.test(s)) return true
  if (/^\d+$/.test(s)) return true // posting codes
  if (/^(?:[A-Za-z.']+\s+){0,3}campus(?:-\d+)?$|^e-campus$/i.test(s)) return true
  if (/^(?:university of\b[^,]*|[^,]*\b(?:university|community college|technical college))$/i.test(s) && !/\b(?:school|college) of\b/i.test(s)) return true
  return false
}
