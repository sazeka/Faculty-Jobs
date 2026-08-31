import crypto from 'node:crypto'
import { isExpiredPastGrace } from './post-expiration.js'

export const POST_QUALITY_VERSION = 1

const PLACEHOLDER_TITLE_RE = /^(?:faculty|staff|faculty jobs|employment|careers?|view details|learn more|read more|click here)$/i
const RESOURCE_TITLE_RE = /^(?:faculty affairs|faculty support|faculty support services\b.*|faculty resources?|faculty development|academic affairs|human resources|office of faculty affairs(?:\s*&\s*strategic planning)?|contract faculty payroll calendar|staff,? faculty (?:&|and) student employment opportunities|view lecturer opportunities|access center resources for faculty|affiliate faculty resources|center for faculty excellence|faculty accompanying students(?: \(fas\))? grant|faculty awards|faculty employment handbook|faculty forms|faculty offer letter templates\b.*|faculty performance|faculty review|(?:msu denver )?faculty fellowships|recruiting excellent faculty workshops)$/i
const STRONG_ACADEMIC_TITLE_RE = /\b(?:assistant|associate|full|distinguished|endowed|visiting|adjunct|clinical|research|teaching)?\s*professor\b|\bprofessor of\b|\blecturer\b|\binstructor\b|\bpost[- ]?doctoral\b|\bpost[- ]?doc\b|\bfaculty fellow\b|\bresearch (?:scientist|associate|fellow)\b|\b(?:assistant|associate)?\s*dean\b|\bdepartment chair\b|\b(?:academic|assistant|associate|faculty) librarian\b/i
const STAFF_ROLE_RE = /\b(?:faculty affairs|faculty development|faculty support|human resources|hr associate|hr business|coordinator|specialist|recruiter|talent acquisition|administrative assistant|executive assistant|office manager|program assistant|assistant director|associate director|operations manager|business manager)\b/i
const CLEAR_NONACADEMIC_RE = /\b(?:custodian|groundskeeper|maintenance technician|police officer|security officer|bus driver|food service|payroll|accounts payable|facilities technician|electrician|plumber|carpenter|head coach|assistant coach|athletic trainer)\b/i
const STUDENT_RESOURCE_RE = /\b(?:student services|career services|career center|disability services|office for students|student employment)\b/i
const APPOINTMENT_CONTEXT_RE = /\b(?:12[- ]month|adjunct|clinical|core|ft|full[- ]time|instructional|non[- ]tenure|ntt|open[- ]rank|part[- ]time|professional|rank (?:doq|open|tbd)|research|teaching|tenure(?:d|[- ]track)?)\b/i
const NON_APPOINTMENT_FACULTY_CONTEXT_RE = /\b(?:faculty affairs|faculty development|faculty recruitment|faculty shared services|faculty support|recruit(?:er|ing|ment))\b/i
const GENERIC_INSTITUTION_WORDS = new Set(['and', 'at', 'college', 'institute', 'of', 'school', 'system', 'the', 'university'])

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function dateOnly(value) {
  const raw = clean(value)
  if (!raw) return null
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function institutionTokens(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !GENERIC_INSTITUTION_WORDS.has(token))
}

function explicitInstitutionInTitle(title) {
  const segments = clean(title).split(/\s+[—–-]\s+/).slice(1)
  for (const segment of segments.reverse()) {
    const match = segment.match(/\b(University\s+of\s+[A-Z][A-Za-z0-9&.'’()-]*(?:\s+(?:at|and|the|[A-Z][A-Za-z0-9&.'’()-]*)){0,6})\b/)
      || segment.match(/\b([A-Z][A-Za-z0-9&.'’()-]*(?:\s+(?:of|the|and|at|in|for|[A-Z][A-Za-z0-9&.'’()-]*)){1,9}\s+University)\b/)
    if (match) return clean(match[1])
  }
  return null
}

function institutionConflict(title, college) {
  // A few scrapers truncate a trailing institution phrase at "University of".
  // Treat that as incomplete page text, not as evidence naming another school.
  if (/\bUniversity\s+of\s*$/i.test(clean(title))) return null
  const explicit = explicitInstitutionInTitle(title)
  if (!explicit || !clean(college)) return null
  const expected = new Set(institutionTokens(explicit))
  const actual = new Set(institutionTokens(college))
  if (!expected.size || !actual.size) return null
  return [...expected].some((token) => actual.has(token)) ? null : explicit
}

function classifyLink(url) {
  let parsed
  try {
    parsed = new URL(clean(url))
  } catch {
    return 'invalid'
  }
  if (!/^https?:$/.test(parsed.protocol)) return 'invalid'
  const path = parsed.pathname.replace(/\/+$/, '').toLowerCase()
  const combined = `${path}${parsed.search}${parsed.hash}`
  const directJobPlatform = /(?:myworkdayjobs|myworkdaysite|schooljobs|peopleadmin|interfolio|csod|oraclecloud)\./i.test(parsed.hostname)
  if (!directJobPlatform && /\/(?:directory|people|our-faculty|faculty-profiles?|faculty-staff|faculty-affairs|faculty-support|professional-development)\b/.test(path)) return 'resource-page'
  if (/hrs_(?:app_)?schjob|hrs_cg_search/.test(combined) && !/(?:jobopeningid|jobid|postingid)[=#]\d+/i.test(combined)) return 'search-page'
  if (/\/(?:jobs?|careers?|employment|postings?|search|openings?)$/.test(path) && !parsed.search && !parsed.hash) return 'search-page'
  return 'direct'
}

function addReason(reasons, dimensions, code, severity, dimension, deduction, detail) {
  dimensions[dimension] = clamp(dimensions[dimension] - deduction)
  reasons.push({ code, severity, dimension, deduction, detail })
}

export function stableJobId(job) {
  const identity = clean(job?.canonicalJobId) || clean(job?.url) || `${clean(job?.college)}|${clean(job?.title)}`
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20)
}

export function scorePost(job, { today = new Date() } = {}) {
  const title = clean(job?.title)
  const description = clean(job?.description || job?.summary)
  const college = clean(job?.college)
  const location = clean(job?.location)
  const department = clean(job?.department)
  const url = clean(job?.url)
  const todayIso = dateOnly(today) || new Date().toISOString().slice(0, 10)
  const dimensions = { relevance: 100, attribution: 100, link: 100, freshness: 100, completeness: 100, duplication: 100 }
  const reasons = []
  let hardQuarantine = false

  if (!title || PLACEHOLDER_TITLE_RE.test(title)) {
    addReason(reasons, dimensions, 'placeholder_title', 'error', 'relevance', 100, 'The title is empty or generic page chrome.')
    hardQuarantine = true
  }
  if (RESOURCE_TITLE_RE.test(title)) {
    addReason(reasons, dimensions, 'resource_page_title', 'error', 'relevance', 100, 'The title names a faculty resource office rather than an appointment.')
    hardQuarantine = true
  }

  const hasStrongAcademicTitle = STRONG_ACADEMIC_TITLE_RE.test(title)
  const startsWithAppointment = /^(?:adjunct\b|associate\s+faculty\b|faculty\b)/i.test(title) && !/^(?:faculty affairs|faculty support|faculty development|faculty resources?)\b/i.test(title)
  const contextualFacultyAppointment =
    /\bfaculty\b/i.test(title)
    && APPOINTMENT_CONTEXT_RE.test(title)
    && !NON_APPOINTMENT_FACULTY_CONTEXT_RE.test(title)
  const coordinatedFacultyAppointment =
    /\bfaculty\b/i.test(title)
    && /\bprogram coordinator\b|\bcoordinator\s*\/\s*faculty\b|\bfaculty\s*(?:\/|&)\s*(?:program\s+)?coordinator\b/i.test(title)
    && !NON_APPOINTMENT_FACULTY_CONTEXT_RE.test(title)
  const namedChairAppointment = /\b(?:distinguished|endowed|named)\b.*\bchairs?\b/i.test(title)
  const facultySpecialistAppointment = /\b(?:senior\s+)?faculty specialist\b/i.test(title) && !NON_APPOINTMENT_FACULTY_CONTEXT_RE.test(title)
  const adjunctAppointment = /\badjunct\b/i.test(title) && !/\badjunct\s+faculty\s+recruit(?:er|ing|ment)\b/i.test(title)
  const descriptionBackedFacultyAppointment =
    /\bfaculty\b/i.test(title)
    && /\b(?:classroom|courses?|curriculum|educat(?:e|ion)|instruct(?:ion|or)|students?|teach(?:er|es|ing)?)\b/i.test(description)
    && !NON_APPOINTMENT_FACULTY_CONTEXT_RE.test(title)
  const hasAcademicAppointmentTitle = hasStrongAcademicTitle || startsWithAppointment || contextualFacultyAppointment || coordinatedFacultyAppointment || namedChairAppointment || facultySpecialistAppointment || adjunctAppointment || descriptionBackedFacultyAppointment
  if (STAFF_ROLE_RE.test(title) && !hasAcademicAppointmentTitle) {
    addReason(reasons, dimensions, 'administrative_staff_title', 'error', 'relevance', 90, 'Administrative or support role lacks an academic appointment title.')
    hardQuarantine = true
  } else if (CLEAR_NONACADEMIC_RE.test(title) && !hasAcademicAppointmentTitle) {
    addReason(reasons, dimensions, 'nonacademic_staff_title', 'error', 'relevance', 100, 'Clearly nonacademic staff role.')
    hardQuarantine = true
  } else if (STUDENT_RESOURCE_RE.test(title) && !hasAcademicAppointmentTitle) {
    addReason(reasons, dimensions, 'student_service_title', 'error', 'relevance', 90, 'Student-facing service role lacks an academic appointment title.')
    hardQuarantine = true
  } else if (!hasAcademicAppointmentTitle && !clean(job?.positionType) && !clean(job?.tenureTrack)) {
    addReason(reasons, dimensions, 'weak_academic_evidence', 'warning', 'relevance', 30, 'No strong academic appointment signal appears in the title or normalized metadata.')
  }

  const linkType = classifyLink(url)
  if (linkType === 'invalid') {
    addReason(reasons, dimensions, 'invalid_url', 'error', 'link', 100, 'URL is missing or invalid.')
    hardQuarantine = true
  } else if (linkType === 'resource-page') {
    addReason(reasons, dimensions, 'resource_page_url', 'error', 'link', 90, 'URL points to a resource or directory page.')
    hardQuarantine = true
  } else if (linkType === 'search-page') {
    addReason(reasons, dimensions, 'search_page_url', 'warning', 'link', 45, 'URL appears to be a search or careers landing page rather than a stable posting.')
  }
  if (url && !/^https:\/\//i.test(url)) addReason(reasons, dimensions, 'non_https_url', 'warning', 'link', 20, 'URL is not HTTPS.')

  if (!college) {
    addReason(reasons, dimensions, 'missing_institution', 'error', 'attribution', 100, 'Institution is missing.')
    hardQuarantine = true
  }
  const conflict = institutionConflict(title, college)
  if (conflict) {
    addReason(reasons, dimensions, 'institution_title_conflict', 'error', 'attribution', 100, `Title names ${conflict}, but the listing is attributed to ${college}.`)
    hardQuarantine = true
  }

  const closeDate = dateOnly(job?.closeDate)
  const postedDate = dateOnly(job?.datePosted)
  if (closeDate && isExpiredPastGrace(job, { today, graceDays: 7 })) {
    addReason(reasons, dimensions, 'expired_posting', 'error', 'freshness', 100, `Deadline ${closeDate} has passed.`)
    hardQuarantine = true
  }
  if (postedDate && postedDate > todayIso) addReason(reasons, dimensions, 'future_posting_date', 'warning', 'freshness', 60, `Posting date ${postedDate} is in the future.`)
  if (!postedDate && !dateOnly(job?.firstSeen)) addReason(reasons, dimensions, 'missing_observation_date', 'info', 'freshness', 15, 'No source posting or first-seen date is available.')

  if (!description) addReason(reasons, dimensions, 'missing_description', 'info', 'completeness', 35, 'Description is missing.')
  else if (description.length < 80) addReason(reasons, dimensions, 'thin_description', 'info', 'completeness', 20, 'Description is unusually short.')
  if (!department) addReason(reasons, dimensions, 'missing_department', 'info', 'completeness', 10, 'Department is missing.')
  if (!location && !clean(job?.state)) addReason(reasons, dimensions, 'missing_location', 'info', 'completeness', 15, 'Location is missing.')
  if (!closeDate && !job?.openUntilFilled) addReason(reasons, dimensions, 'missing_deadline', 'info', 'completeness', 5, 'Deadline is not provided.')

  const duplicateCount = Number(job?.duplicateCount || 1)
  if (duplicateCount > 1) addReason(reasons, dimensions, 'grouped_duplicates', 'info', 'duplication', Math.min(30, (duplicateCount - 1) * 5), `${duplicateCount} source records are grouped.`)

  const weights = { relevance: 0.35, attribution: 0.2, link: 0.2, freshness: 0.1, completeness: 0.1, duplication: 0.05 }
  const score = Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + dimensions[key] * weight, 0))
  const hasError = reasons.some((reason) => reason.severity === 'error')
  const hasWarning = reasons.some((reason) => reason.severity === 'warning')
  const status = hardQuarantine || score < 50 ? 'quarantine' : (hasError || hasWarning || score < 80 ? 'review' : 'pass')

  return {
    id: stableJobId(job),
    score,
    status,
    dimensions,
    reasons,
    linkType,
    academicAppointment: hasAcademicAppointmentTitle,
  }
}

// Conservative publishing gate: only these combinations are precise enough to
// remove without manual review. Other errors remain visible in the review report.
export function confirmedNonFacultyReason(job, options = {}) {
  const quality = scorePost(job, options)
  const codes = new Set(quality.reasons.map((reason) => reason.code))
  if (codes.has('resource_page_title')) return 'resource_page_title'
  if (codes.has('administrative_staff_title')) return 'administrative_staff_title'
  if (codes.has('student_service_title')) return 'student_service_title'
  if (codes.has('resource_page_url') && !quality.academicAppointment) return 'resource_page_url'
  return null
}

export function scoreCatalog(jobs, options = {}) {
  return (Array.isArray(jobs) ? jobs : []).map((job) => ({ job, quality: scorePost(job, options) }))
}

export function deterministicStratifiedSample(scoredRows, { size = 200 } = {}) {
  const rows = Array.isArray(scoredRows) ? scoredRows : []
  const buckets = new Map()
  for (const row of rows) {
    const key = `${clean(row?.job?.source) || 'Unknown'}|${row?.quality?.status || 'unknown'}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(row)
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) => a.quality.id.localeCompare(b.quality.id))

  const selected = []
  const orderedBuckets = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
  let cursor = 0
  while (selected.length < size && orderedBuckets.some(([, bucket]) => bucket.length > 0)) {
    const [, bucket] = orderedBuckets[cursor % orderedBuckets.length]
    if (bucket.length) selected.push(bucket.shift())
    cursor += 1
  }
  return selected
}

export function summarizeHumanLabels(labels) {
  const rows = Array.isArray(labels) ? labels.filter((row) => ['valid', 'invalid'].includes(row?.label)) : []
  const valid = rows.filter((row) => row.label === 'valid').length
  const invalid = rows.length - valid
  return {
    reviewed: rows.length,
    valid,
    invalid,
    precisionPct: rows.length ? Number(((valid / rows.length) * 100).toFixed(2)) : null,
  }
}
