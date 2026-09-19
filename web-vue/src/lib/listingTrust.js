const GENERIC_INSTITUTION_WORDS = new Set([
  'and', 'at', 'college', 'institute', 'of', 'school', 'system', 'the', 'university',
])

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function dateOnly(value) {
  const raw = clean(value)
  if (!raw) return null
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

export function sanitizePostingDate(value, referenceDate = new Date()) {
  const normalized = dateOnly(value)
  if (!normalized) return null
  const reference = dateOnly(referenceDate) || new Date().toISOString().slice(0, 10)
  return normalized <= reference ? normalized : null
}

export function classifySourceLink(value) {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    return 'invalid'
  }
  if (!/^https?:$/.test(url.protocol)) return 'invalid'

  const path = url.pathname.replace(/\/+$/, '').toLowerCase()
  const isPeopleSoftSearch = /hrs_(?:app_)?schjob|hrs_cg_search/.test(`${path}${url.search}`)
  const hasStablePeopleSoftId = /(?:jobopeningid|jobid|postingid)=\d+/i.test(url.search)
  if (isPeopleSoftSearch && !hasStablePeopleSoftId) return 'search-page'

  if (/\/(?:jobs?|careers?|employment|postings?|search)$/.test(path) && !url.search) {
    return 'search-page'
  }
  return 'direct'
}

function institutionTokens(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !GENERIC_INSTITUTION_WORDS.has(token))
}

// Words that never appear inside a real "<Words> University" institution
// name, but do commonly appear in a department/division/facility phrase that
// happens to precede the unrelated word "University" elsewhere in the same
// title segment (issue #140's "Research and Learning Services University
// Libraries" false positive, e.g.). Scoped to the "<leading phrase>
// University" fallback pattern only.
const NON_INSTITUTION_LEADING_WORDS = new Set([
  'department', 'division', 'school', 'program', 'center', 'centre', 'office',
  'research', 'learning', 'services', 'library', 'libraries', 'unit', 'section',
  'laboratory', 'lab',
])

// Only treat an institution name as explicit when it appears in a dash-delimited
// title segment. This catches source attribution mistakes without interpreting
// ordinary phrases such as "university studies" as an employer name.
export function explicitInstitutionInTitle(title) {
  const segments = clean(title).split(/\s+[—–-]\s+/).slice(1)
  for (const segment of segments.reverse()) {
    // A title truncated right after "University of" (a corrupted/incomplete
    // scrape, not a real institution reference) has no usable evidence in
    // this segment -- skip it rather than let the fallback pattern below
    // match an unrelated capitalized phrase earlier in the same segment.
    if (/\bUniversity\s+of\s*$/i.test(segment)) continue

    // Prefer the full "University of X[ at/in Y]" construction. Matching only
    // up to the bare word "University" (the fallback pattern below) silently
    // dropped the actual institution name whenever it was spelled "University
    // of X" -- e.g. "... Department of Sciences and Mathematics University of
    // Washington" was truncated to the invented name "... Mathematics
    // University", which obviously never matches the real college,
    // "University of Washington". Anchoring on the literal "University of"
    // instead captures the real name regardless of what precedes it.
    const ofMatch = segment.match(
      /\bUniversity\s+of\s+(?:[A-Z][A-Za-z.'’-]*\s*){1,4}(?:(?:at|in)\s+(?:[A-Z][A-Za-z.'’-]*\s*){1,3})?/
    )
    if (ofMatch) return clean(ofMatch[0])

    // Fallback: a proper-noun-leading name such as "Wake Forest University"
    // or "Arizona State University" that isn't spelled "University of X".
    // University names are sufficiently distinctive for a hard contradiction
    // check. "College" and "Institute" frequently occur in department/program
    // names (for example, "High School College Partnership"), which produced
    // noisy false positives when treated as employers.
    const match = segment.match(/\b([A-Z][A-Za-z0-9&.'’()-]*(?:\s+(?:of|the|and|at|in|for|[A-Z][A-Za-z0-9&.'’()-]*)){1,9}\s+University)\b/)
    if (match) {
      const words = clean(match[1]).toLowerCase().split(/\s+/)
      if (words.some((word) => NON_INSTITUTION_LEADING_WORDS.has(word))) continue
      return clean(match[1])
    }
  }
  return null
}

export function institutionTitleConflict(title, college) {
  const explicit = explicitInstitutionInTitle(title)
  if (!explicit || !clean(college)) return null
  const expected = new Set(institutionTokens(explicit))
  const actual = new Set(institutionTokens(college))
  if (expected.size === 0 || actual.size === 0) return null
  const overlaps = [...expected].some((token) => actual.has(token))
  return overlaps ? null : { explicitInstitution: explicit, listedInstitution: clean(college) }
}

export function summarizeCatalog(jobs, today = new Date()) {
  const rows = Array.isArray(jobs) ? jobs : []
  const groups = new Map()
  const todayIso = dateOnly(today) || new Date().toISOString().slice(0, 10)

  for (const job of rows) {
    const key = clean(job?.canonicalGroupId) || clean(job?.canonicalJobId) || clean(job?.url) || `${clean(job?.title)}|${clean(job?.college)}`
    const isClosed = Boolean(job?.closeDate && !job?.openUntilFilled && String(job.closeDate).slice(0, 10) < todayIso)
    const existing = groups.get(key)
    groups.set(key, existing ? { isClosed: existing.isClosed && isClosed } : { isClosed })
  }

  const groupedPostings = groups.size
  const closedPostings = [...groups.values()].filter((group) => group.isClosed).length
  return {
    sourceRecords: rows.length,
    groupedPostings,
    searchablePostings: groupedPostings - closedPostings,
    duplicateRecords: Math.max(0, rows.length - groupedPostings),
    closedPostings,
  }
}
