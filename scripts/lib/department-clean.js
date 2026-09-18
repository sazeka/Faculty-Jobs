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
export function cleanDepartment(dept) {
  if (!dept) return null
  const s = String(dept).replace(/\s+/g, ' ').trim()
  if (!s || s.length < 3) return null
  if (s.length > 80) return null // likely a description, not a department
  if (/^[\d()\-,]/.test(s)) return null // starts with digit, bracket, or punctuation
  if (/\.\s[a-z]/.test(s)) return null // sentence break mid-string
  if (/\)\s/.test(s)) return null // leftover parenthetical noise
  if (/^\d{4}\s/.test(s)) return null // starts with year
  if (/\b(position|posted|internal only|open until filled|all ranks|region:)\b/i.test(s)) return null
  return s
}
