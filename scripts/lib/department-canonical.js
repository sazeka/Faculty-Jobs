// Department labels for counting. Job cards keep the source spelling; trend
// counts need "Accounting (Pool)", "Accounting Department" and
// "Department of Accounting" to land on one name, and need schools and
// colleges kept apart from the departments inside them.
import { cleanDepartment, DEPARTMENT_SEPARATOR, isNoiseSegment } from './department-clean.js'

const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with'])

function titleCase(value) {
  return value.toLowerCase().replace(/[a-z][a-z'’]*/g, (word, index) =>
    index > 0 && SMALL_WORDS.has(word) ? word : word[0].toUpperCase() + word.slice(1))
}

export function departmentUnitLevel(name) {
  const s = String(name || '')
  if (/^(?:faculty|college|school)\s+of\b/i.test(s)) return 'school'
  if (/\b(?:school|college)$/i.test(s)) return 'school'
  if (/^(?:liberal\s+)?arts\s+(?:and|&)\s+sciences$/i.test(s)) return 'school'
  return 'department'
}

// Returns the counting label for a usable Department value, or null when
// nothing subject-like is left after trimming.
export function canonicalDepartment(value, context) {
  const cleaned = cleanDepartment(value, context)
  if (!cleaned) return null
  let s = cleaned
    .replace(/\s*[([][^)\]]*[)\]]/g, ' ')
    .replace(/["“”]/g, '')
    .replace(/\b(?:fall|spring|summer|winter)\s+(?:term\s+)?\d{4}\b|\b(?:fy|ay)\s*\d{2,4}\b/gi, ' ')
  // Trailing ", Columbia University" or " at Stanford University".
  s = s.replace(/(?:,|\s+at)\s+(?:the\s+)?[^,]*\b(?:university|college)$/i, (match) =>
    /\b(?:school|college)\s+of\b/i.test(match) ? match : '')
  let segments = s.split(DEPARTMENT_SEPARATOR).map((part) => part.trim()).filter((part) => !isNoiseSegment(part))
  // Short uppercase segments beside a subject are org codes ("ABE ESL - AM");
  // alone they are often the subject itself ("HVAC", "EMS").
  const named = segments.filter((part) => !/^[A-Z]{1,4}$/.test(part))
  if (named.length) segments = named
  // "College of Natural Sciences - Chemistry": the last department-level
  // segment is the most specific hiring unit.
  segments = segments.filter((part) => cleanDepartment(part))
  if (segments.length > 1) {
    const departments = segments.filter((part) => departmentUnitLevel(part) === 'department')
    segments = departments.length ? [departments.at(-1)] : [segments.at(-1)]
  }
  s = (segments[0] || '')
    .replace(/,\s*(?:[\w.'-]+\s+){0,3}campus(?:-\d+)?$/i, '')
    .replace(/^(?:the\s+)?(?:department|dept\.?)\s+of\s+(?:the\s+)?/i, '')
    .replace(/\s+(?:department|dept\.?)(?:\s+(?:adjunct\s+)?pool)?$/i, '')
    .replace(/\s+(?:adjunct\s+)?pool(?:\s+posting)?$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;/-]+|[\s,.:;/-]+$/g, '')
  // Title-case shouted labels, but leave acronym-only labels such as "ABE ESL".
  if (/[A-Z]{5}/.test(s) && s === s.toUpperCase()) s = titleCase(s)
  if (!s || !cleanDepartment(s)) return null
  return s
}

// Key that merges spelling variants of one canonical label.
export function departmentKey(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
