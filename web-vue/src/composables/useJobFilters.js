import { computed } from 'vue'
import { ALL_FILTER_VALUE, createDefaultFilters } from '../config/appConfig.js'
import { SOURCE_TO_STATE_ALIASES, US_STATES_BY_ABBREV } from '../config/jobTaxonomy.js'
import { getPositionType, getPositionTypes, normalizeTenureTrack } from '../lib/jobClassification.js'
import { classifySourceLink, institutionTitleConflict, sanitizePostingDate } from '../lib/listingTrust.js'
import { inferAlaskaCampus } from '../../../scripts/lib/alaska-campus.js'
import { normalizeSearchText } from '../../../scripts/lib/jobs-search-index.js'
import { deriveCandidateFields } from '../../../scripts/lib/job-candidate-fields.js'

export { getPositionType, getPositionTypes, normalizeTenureTrack } from '../lib/jobClassification.js'

// Today as YYYY-MM-DD for deadline comparisons; computed once per page load.
// closeDate values are date-only, so a UTC slice is the right granularity.
const TODAY_ISO = new Date().toISOString().slice(0, 10)

// A datePosted older than this looks like a bad scrape (e.g. a source exposing
// a page-creation date instead of an actual posting date) rather than a
// trustworthy "posted long ago" signal, so it shouldn't outrank a job that was
// merely first seen without a parsed date at all.
const STALE_DATE_CUTOFF_ISO = (() => {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - 12)
  return d.toISOString().slice(0, 10)
})()

// Each top-level discipline is broken into labeled sub-disciplines so a user
// can narrow further once they've picked a discipline (progressive
// disclosure — see subdisciplineOptions below). The union of every
// sub-discipline's terms within a rule is exactly the old flat term list
// (Education's added subject-area terms below are the one deliberate
// exception — see the comment there), so top-level discipline classification
// is otherwise unchanged.
export const DISCIPLINE_RULES = [
  { label: 'Arts & Music', subdisciplines: [
    { label: 'Visual Arts',      terms: ['art', 'studio', 'visual art', 'fine art', 'sculpture', 'painting', 'ceramics', 'graphic design', 'illustration', 'photography'] },
    { label: 'Music',            terms: ['music'] },
    { label: 'Theatre & Dance',  terms: ['theatre', 'theater', 'dance', 'performing'] },
    { label: 'Film',             terms: ['film'] },
  ]},
  { label: 'Biological Sciences', subdisciplines: [
    { label: 'General & Organismal Biology',          terms: ['biology', 'biolog', 'botany', 'zoology', 'wildlife'] },
    { label: 'Ecology & Evolution',                   terms: ['ecology', 'evolutionary', 'marine biology'] },
    { label: 'Genetics & Genomics',                   terms: ['genetics', 'genomics'] },
    { label: 'Neuroscience',                          terms: ['neuroscience'] },
    { label: 'Biochemistry & Molecular Biology',      terms: ['biochemistry', 'molecular', 'cell biology'] },
    { label: 'Microbiology',                          terms: ['microbiology'] },
    { label: 'Anatomy & Physiology',                  terms: ['anatomy', 'physiology'] },
  ]},
  { label: 'Business & Economics', subdisciplines: [
    { label: 'Economics',                     terms: ['economics', 'econom'] },
    { label: 'Accounting & Finance',          terms: ['accounting', 'finance', 'taxation', 'audit'] },
    { label: 'Management & Entrepreneurship', terms: ['management', 'entrepreneurship'] },
    { label: 'Marketing',                     terms: ['marketing'] },
    { label: 'Operations & Supply Chain',     terms: ['supply chain', 'operations'] },
    { label: 'Hospitality & Real Estate',     terms: ['hospitality', 'real estate'] },
    // 'business', 'mba', and 'commerce' used to sit in Management &
    // Entrepreneurship, so a generically titled "Assistant Professor of
    // Business" was mislabeled as management/entrepreneurship-specific.
    // Placed last as the catch-all for the generic term.
    { label: 'General Business',              terms: ['business', 'mba', 'commerce'] },
  ]},
  { label: 'Computer Science & Engineering', subdisciplines: [
    { label: 'Computer Science & Software',          terms: ['computer science', 'software', 'data science', 'artificial intelligence', 'machine learning', 'cybersecurity'] },
    { label: 'Electrical & Computer Engineering',    terms: ['electrical engineering', 'computer engineering', 'robotics'] },
    { label: 'Mechanical & Aerospace Engineering',   terms: ['mechanical engineering', 'aerospace'] },
    { label: 'Civil & Industrial Engineering',       terms: ['civil engineering', 'industrial engineering', 'systems engineering'] },
    { label: 'Chemical & Materials Engineering',     terms: ['chemical engineering', 'materials science'] },
    { label: 'Biomedical Engineering',               terms: ['biomedical engineering'] },
  ]},
  { label: 'Education', subdisciplines: [
    // These subject-area terms are new (not in the original flat list) — the
    // old rule only distinguished HOW someone teaches (curriculum, early
    // childhood, ...), never WHAT subject. Every phrase here already
    // contains "education", which was already a term below, so adding them
    // only changes which sub-discipline a job lands in, never its top-level
    // discipline. They're listed first so a specific subject match (e.g.
    // "Mathematics Education") wins over the generic 'education' catch-all
    // in Curriculum & Instruction.
    { label: 'Mathematics Education',              terms: ['mathematics education', 'math education'] },
    { label: 'Science Education',                  terms: ['science education', 'stem education'] },
    { label: 'Social Studies Education',            terms: ['social studies education', 'history education', 'civics education'] },
    { label: 'Language & Literacy Education',       terms: ['literacy education', 'english education', 'language arts education', 'reading education', 'esl education'] },
    { label: 'Arts Education',                      terms: ['art education', 'music education', 'arts education'] },
    { label: 'Physical & Health Education',         terms: ['physical education', 'health education'] },
    { label: 'Curriculum & Instruction',            terms: ['curriculum', 'pedagogy', 'instructional design', 'teaching', 'education'] },
    { label: 'Early Childhood & Literacy',          terms: ['early childhood', 'literacy'] },
    { label: 'Special Education',                   terms: ['special education'] },
    { label: 'Educational Leadership & Higher Ed',  terms: ['educational leadership', 'higher education', 'school counseling'] },
  ]},
  { label: 'Health & Medicine', subdisciplines: [
    // Each clinical specialty gets its own label instead of being lumped
    // into one "Medicine & Clinical" bucket — they were already distinct
    // terms, just sharing a label. The specific specialties are listed
    // before the generic medicine/clinical/medical catch-all so, e.g., a
    // surgery posting that also happens to say "Department of Medicine"
    // still lands under Surgery rather than the generic bucket.
    { label: 'Surgery',                          terms: ['surgery'] },
    { label: 'Pediatrics',                       terms: ['pediatrics'] },
    { label: 'Psychiatry',                       terms: ['psychiatry'] },
    { label: 'Pathology',                        terms: ['pathology'] },
    { label: 'Anesthesiology',                   terms: ['anesthesiology'] },
    { label: 'Oncology',                         terms: ['oncology'] },
    { label: 'Radiology',                        terms: ['radiolog'] },
    { label: 'General & Internal Medicine',      terms: ['medicine', 'clinical', 'medical'] },
    { label: 'Nursing',                          terms: ['nursing'] },
    { label: 'Pharmacy',                         terms: ['pharmacy'] },
    { label: 'Dental',                           terms: ['dental'] },
    { label: 'Public Health & Epidemiology',     terms: ['public health', 'epidemiology', 'nutrition', 'health'] },
    { label: 'Rehabilitation Sciences',          terms: ['physical therapy', 'occupational therapy', 'kinesiology', 'exercise science', 'physician assistant'] },
  ]},
  { label: 'Humanities', subdisciplines: [
    { label: 'English & Literature',            terms: ['english', 'literature', 'writing', 'comparative literature'] },
    { label: 'History',                         terms: ['history', 'medieval', 'american studies'] },
    { label: 'Philosophy & Ethics',             terms: ['philosophy', 'ethics'] },
    { label: 'Religious Studies & Theology',    terms: ['religious studies', 'theology'] },
    { label: 'Classics & Rhetoric',             terms: ['classics', 'rhetoric'] },
    // 'humanities' and 'cultural studies' used to sit in Classics &
    // Rhetoric, so a generically titled "Assistant Professor of
    // Humanities" was mislabeled as classics/rhetoric-specific. Placed
    // last as the catch-all for the generic terms.
    { label: 'General Humanities & Cultural Studies', terms: ['humanities', 'cultural studies'] },
  ]},
  { label: 'Languages & Linguistics', subdisciplines: [
    { label: 'Linguistics & Applied Linguistics', terms: ['linguistics', 'applied linguistics', 'esl', 'tesol', 'second language', 'translation'] },
    { label: 'Romance Languages',                 terms: ['spanish', 'french', 'italian', 'portuguese'] },
    { label: 'Germanic Languages',                terms: ['german'] },
    { label: 'East Asian Languages',              terms: ['chinese', 'japanese', 'korean'] },
    { label: 'Other World Languages',             terms: ['arabic', 'russian', 'language'] },
  ]},
  { label: 'Law & Criminal Justice', subdisciplines: [
    { label: 'Law',                               terms: ['law', 'legal', 'jurisprudence', 'paralegal'] },
    { label: 'Criminal Justice & Criminology',    terms: ['criminology', 'criminal justice', 'forensic', 'corrections', 'policing', 'homeland security'] },
  ]},
  { label: 'Mathematics & Statistics', subdisciplines: [
    // 'analysis' alone used to sit here as a bare term, so substring matching
    // caught unrelated fields like "applied behavior analysis", "business
    // analysis", "data analysis" — see issue #116. Only the specific
    // mathematical-analysis subfields imply Mathematics.
    { label: 'Mathematics',                   terms: ['mathematics', 'math', 'applied math', 'calculus', 'algebra', 'real analysis', 'complex analysis', 'functional analysis', 'numerical analysis', 'harmonic analysis', 'mathematical analysis'] },
    { label: 'Statistics & Data Analytics',   terms: ['statistics', 'actuarial', 'probability', 'data analytics'] },
  ]},
  { label: 'Natural Sciences', subdisciplines: [
    { label: 'Physics & Astronomy',              terms: ['physics', 'astronomy', 'astrophysics'] },
    { label: 'Chemistry',                         terms: ['chemistry'] },
    { label: 'Earth & Environmental Sciences',    terms: ['geology', 'geophysics', 'environmental science', 'earth science', 'atmospheric', 'oceanography', 'climate', 'geoscience', 'material science'] },
  ]},
  { label: 'Psychology & Social Work', subdisciplines: [
    { label: 'Psychology',                    terms: ['psychology', 'behavioral', 'cognitive', 'developmental psychology', 'clinical psychology'] },
    { label: 'Social Work & Counseling',      terms: ['social work', 'counseling', 'mental health', 'human services'] },
  ]},
  { label: 'Social Sciences', subdisciplines: [
    { label: 'Sociology & Anthropology',              terms: ['sociology', 'anthropology', 'demography'] },
    { label: 'Political Science & Public Policy',     terms: ['political science', 'public administration', 'public policy', 'international relations'] },
    { label: 'Geography & Urban Planning',            terms: ['geography', 'urban planning'] },
    { label: 'Communications & Media',                terms: ['communications', 'journalism', 'media studies'] },
    // 'social science' used to sit in this group's term list, so a job
    // generically titled "Social Science" got mislabeled with the specific
    // Gender & Ethnic Studies tag. It now has its own generic bucket.
    { label: 'Gender & Ethnic Studies',               terms: ['gender studies', 'ethnic studies', 'african american', 'chicano', 'latinx'] },
    { label: 'General Social Sciences',                terms: ['social science'] },
  ]},
]

// Most terms deliberately rely on plain substring matching so they also
// catch inflected/compound forms — 'math' → 'mathematical', 'health' →
// 'healthcare', 'medicine' → 'paramedicine', 'radiolog' → 'neuroradiology',
// etc. — so that behavior stays as-is here. The single reported exception is
// 'art' (issue #115): as a bare 3-letter term it also matched mid-word
// inside completely unrelated words ('department', 'part-time',
// 'artificial'), which substring matching can't tell apart from a real
// match. 'art' is a complete word on its own, so it doesn't need that
// compound-catching behavior — require it to appear as a whole word instead
// (tolerant of a trailing plural "s" so "arts" still matches).
const ART_TERM_REGEX = /\barts?\b/i

function matchesTerm(hay, term) {
  if (term === 'art') return ART_TERM_REGEX.test(hay)
  return hay.includes(term)
}

export function getDiscipline(job) {
  const hay = `${job.title || ''} ${job.department || ''}`.toLowerCase()
  for (const rule of DISCIPLINE_RULES) {
    if (rule.subdisciplines.some((sub) => sub.terms.some((t) => matchesTerm(hay, t)))) return rule.label
  }
  return 'Other'
}

// Finds which sub-discipline within the job's already-determined discipline
// matched. Returns null for 'Other' jobs, or a discipline whose matched term
// doesn't map to a specific sub-group.
export function getSubdiscipline(job) {
  const rule = DISCIPLINE_RULES.find((r) => r.label === job.discipline)
  if (!rule) return null
  const hay = `${job.title || ''} ${job.department || ''}`.toLowerCase()
  for (const sub of rule.subdisciplines) {
    if (sub.terms.some((t) => matchesTerm(hay, t))) return sub.label
  }
  return null
}

export function subdisciplinesForDiscipline(label) {
  return DISCIPLINE_RULES.find((r) => r.label === label)?.subdisciplines || []
}

function stripDateTextFromTitle(value) {
  let t = String(value || '')
  if (!t) return t
  t = t.replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi, '')
  t = t.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '')
  t = t.replace(/\b(?:AY\s*)?'?\d{2,4}\s*[-/]\s*'?\d{2,4}\b/gi, '')
  t = t.replace(/\(\s*initial\s+review\s+date[^)]*\)/gi, '')
  t = t.replace(/\s*[—-]\s*$/g, '')
  t = t.replace(/\s{2,}/g, ' ').trim()
  return t
}

export function inferState(job) {
  if (job?.state) return job.state
  const source = String(job?.source || '').trim()
  if (!source) return null
  if (SOURCE_TO_STATE_ALIASES[source]) return SOURCE_TO_STATE_ALIASES[source]
  if (US_STATES_BY_ABBREV[source]) return US_STATES_BY_ABBREV[source]
  return source
}

export function normalizeSystemCollege(job) {
  const original = String(job?.college || '').trim()
  if (!original) return null

  const hay = `${job?.title || ''} ${job?.location || ''} ${job?.url || ''}`.toLowerCase()

  if (original === 'University of Alaska System') {
    return inferAlaskaCampus(job) || original
  }

  if (original === 'University of Hawaii System') {
    if (hay.includes('hilo')) return 'University of Hawaii at Hilo'
    if (hay.includes('west oahu') || hay.includes('west-oahu')) return 'University of Hawaii-West Oahu'
    if (hay.includes('maui')) return 'University of Hawaii Maui College'
    if (hay.includes('honolulu') || hay.includes('manoa')) return 'University of Hawaii at Manoa'
  }

  if (original === 'University of Maine System') {
    if (hay.includes('orono')) return 'University of Maine'
    if (hay.includes('portland')) return 'University of Southern Maine'
    if (hay.includes('machias')) return 'University of Maine at Machias'
    if (hay.includes('fort kent')) return 'University of Maine at Fort Kent'
    if (hay.includes('farmington')) return 'University of Maine at Farmington'
    if (hay.includes('augusta')) return 'University of Maine at Augusta'
    if (hay.includes('presque isle')) return 'University of Maine at Presque Isle'
  }

  if (original === 'University of New Hampshire System') {
    if (hay.includes('durham')) return 'University of New Hampshire'
    if (hay.includes('manchester')) return 'University of New Hampshire at Manchester'
    if (hay.includes('plymouth')) return 'Plymouth State University'
    if (hay.includes('keene')) return 'Keene State College'
  }

  return original
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function selectedValues(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  return value && value !== ALL_FILTER_VALUE ? [value] : []
}

function isSelected(value, option) {
  return selectedValues(value).includes(option)
}

// Returns a sanitised department string or null if the value looks like garbage
// (scraped job title, truncated description, etc.)
const INSTITUTION_WORDS = ['university', 'college', 'institute', 'school', 'academy']
function cleanDepartment(dept) {
  if (!dept) return null
  const s = clean(String(dept))
  if (!s || s.length < 3) return null
  if (s.length > 80) return null                   // likely a description
  if (/^[\d()\-,]/.test(s)) return null            // starts with digit, bracket, or punctuation
  if (/\.\s[a-z]/.test(s)) return null             // sentence break mid-string
  if (/\)\s/.test(s)) return null                  // leftover parenthetical noise
  if (/^\d{4}\s/.test(s)) return null              // starts with year
  if (/\b(position|posted|internal only|open until filled|all ranks|region:)\b/i.test(s)) return null
  return s
}

// Extracts "City, ST" from raw location strings like "Campus - Philadelphia, PA".
// `college` lets this reject a placeholder location that's just the
// institution's own name plus a state suffix ("Wilson Community College,
// NC", "SUNY Cortland, NY") — those aren't real cities, even when they don't
// contain an obvious institution word like "university"/"college" (see
// issue #120). Institutions actually named after their own city (Santa
// Clara University → "Santa Clara, CA") are exact-string-compared against
// `college`, not token-matched, so they aren't caught by this.
export function extractCity(location, college) {
  if (!location) return null
  const parts = String(location).split(' - ')
  const candidate = parts[parts.length - 1].trim()
  const match = candidate.match(/^(.+),\s*([A-Z]{2})$/)
  if (!match) return null
  const cityPart = match[1].trim()
  const statePart = match[2]
  const lower = cityPart.toLowerCase()
  if (INSTITUTION_WORDS.some((w) => lower.includes(w))) return null
  if (cityPart.split(/\s+/).length > 4) return null
  if (college && candidate.toLowerCase() === `${clean(college)}, ${statePart}`.toLowerCase()) return null
  return `${cityPart}, ${statePart}`
}

function normalizeForKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ')
}

function deriveConfidenceBadges(job, { datePosted, linkQuality, institutionConflict }) {
  const badges = []
  if (/^https:\/\//i.test(String(job?.url || ''))) {
    badges.push({ kind: 'good', label: 'Verified Link' })
  }
  if (clean(job?.department)) {
    badges.push({ kind: 'good', label: 'Department Tagged' })
  } else {
    badges.push({ kind: 'warn', label: 'Missing Department' })
  }
  if (!(job?.hasDescription || clean(job?.description)) || !clean(job?.location)) {
    badges.push({ kind: 'warn', label: 'Missing Metadata' })
  }
  if (job?.datePosted && !datePosted) badges.push({ kind: 'warn', label: 'Posting date suppressed', detail: 'The supplied posting date was invalid or in the future.' })
  if (linkQuality === 'search-page') badges.push({ kind: 'warn', label: 'Search-page link', detail: 'This source did not provide a stable direct link to the posting.' })
  if (linkQuality === 'invalid') badges.push({ kind: 'warn', label: 'Invalid source link', detail: 'The supplied source link could not be safely opened.' })
  if (institutionConflict) {
    badges.push({
      kind: 'warn',
      label: 'Institution needs review',
      detail: `The title names ${institutionConflict.explicitInstitution}, but the source record names ${institutionConflict.listedInstitution}.`,
    })
  }
  return badges
}

function normalizeJob(job) {
  const normalizedTitle = stripDateTextFromTitle(job?.titleClean || job?.title || '(No title)')
  const title = normalizedTitle || '(No title)'
  const college = normalizeSystemCollege(job)
  const institutionConflict = institutionTitleConflict(title, college)
  const department = cleanDepartment(job?.department)
  const state = inferState(job)
  const datePosted = sanitizePostingDate(job?.datePosted)
  const linkQuality = classifySourceLink(job?.url)
  const derivedGroupKey = [normalizeForKey(title), normalizeForKey(college), normalizeForKey(department || ''), normalizeForKey(state || '')]
    .filter(Boolean)
    .join('|')
  const canonicalGroupId = clean(job?.canonicalGroupId) || (derivedGroupKey ? `grp_${derivedGroupKey}` : null)
  const canonicalJobId = clean(job?.canonicalJobId) || clean(job?.url) || `${title}|${college || ''}`

  const candidateFields = deriveCandidateFields(job)
  const normalized = {
    title,
    url: linkQuality === 'invalid' ? '#' : (job?.url || '#'),
    source: job?.source || null,
    college,
    location: job?.location || null,
    city: extractCity(job?.location, job?.college),
    department,
    description: job?.description || null,
    summary: job?.summary || null,
    hasDescription: Boolean(job?.hasDescription || clean(job?.description) || clean(job?.summary)),
    specialization: job?.specialization || null,
    ...candidateFields,
    discipline: null, // set after object creation
    subdiscipline: null, // set after object creation, depends on discipline
    openUntilFilled: Boolean(job?.openUntilFilled),
    closeDateRaw: job?.closeDateRaw || null,
    closeDate: job?.closeDate || null,
    startDate: job?.startDate || null,
    // Closed = a real close date in the past, and not an open-until-filled
    // (rolling) posting. Used to default-hide expired listings.
    isClosed: Boolean(job?.closeDate && !job?.openUntilFilled && String(job.closeDate) < TODAY_ISO),
    tenureTrack: normalizeTenureTrack(job?.tenureTrack, job?.titleClean || job?.title || ''),
    positionTypes: job?.rank ? [job.rank] : getPositionTypes(job?.titleClean || job?.title || ''),
    positionType: job?.rank || getPositionType(job?.titleClean || job?.title || ''),
    state,
    datePosted,
    dateProvenance: datePosted ? 'source' : (job?.firstSeen ? 'atlas' : null),
    firstSeen: job?.firstSeen || null,
    isNew: Boolean(job?._isNew),
    linkQuality,
    institutionConflict,
    confidenceBadges: deriveConfidenceBadges(job, { datePosted, linkQuality, institutionConflict }),
    canonicalJobId,
    canonicalGroupId,
    duplicateGroupKey: canonicalGroupId || normalizeForKey(job?.url || title),
    duplicateCount: 1,
    duplicateUrls: [job?.url || '#'],
    searchText: job?.searchText || normalizeSearchText([
      title,
      job?.source,
      college,
      job?.location,
      department,
      job?.specialization,
      state,
    ].filter(Boolean).join(' ')),
    searchTitle: normalizeSearchText(title),
    searchDepartment: normalizeSearchText(department),
    searchCollege: normalizeSearchText(college),
  }
  normalized.discipline = getDiscipline(normalized)
  normalized.subdiscipline = getSubdiscipline(normalized)
  return normalized
}

function truncate(value, length) {
  const str = String(value || '')
  return str.length > length ? `${str.slice(0, length - 1)}...` : str
}

function matchSearchTerms(job, terms, fullTextMatches = null) {
  if (terms.length === 0) return { matched: true, score: 0 }
  const groupId = job.canonicalGroupId || job.canonicalJobId
  if (!terms.every((term) => job.searchText.includes(term) || fullTextMatches?.get(term)?.has(groupId))) {
    return { matched: false, score: 0 }
  }

  let score = 0
  for (const term of terms) {
    if (job.searchTitle.includes(term)) score += 12
    if (job.searchDepartment.includes(term)) score += 5
    if (job.searchCollege.includes(term)) score += 4
    if (fullTextMatches?.get(term)?.has(groupId)) score += 1
  }
  return { matched: true, score }
}

function sortedDistinct(items, selector) {
  return [...new Set(items.map(selector).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function formatOptionLabel(value, count, maxLabelLength = 40) {
  return `${truncate(value, maxLabelLength)} (${count})`
}

function dedupeGroupedJobs(jobs) {
  const grouped = new Map()
  for (const job of jobs) {
    const key = job.duplicateGroupKey || job.url || job.title
    if (!grouped.has(key)) {
      grouped.set(key, { ...job, duplicateCount: 1, duplicateUrls: [job.url] })
      continue
    }

    const existing = grouped.get(key)
    const mergedUrls = [...new Set([...(existing.duplicateUrls || []), job.url])]
    grouped.set(key, {
      ...existing,
      duplicateCount: mergedUrls.length,
      duplicateUrls: mergedUrls,
      description: existing.description || job.description,
      summary: existing.summary || job.summary,
      location: existing.location || job.location,
      datePosted: existing.datePosted || job.datePosted,
      firstSeen: existing.firstSeen || job.firstSeen,
      startDate: existing.startDate || job.startDate,
      // A grouped posting is only "closed" if every duplicate is closed.
      isClosed: existing.isClosed && job.isClosed,
      isNew: existing.isNew || job.isNew,
    })
  }

  return [...grouped.values()]
}

export function useJobFilters({ jobsRef, filtersRef, isSavedJob, searchTermMatchesRef = null }) {
  const normalizedJobs = computed(() => dedupeGroupedJobs(jobsRef.value.map(normalizeJob)))
  const catalogSummary = computed(() => {
    const groupedPostings = normalizedJobs.value.length
    const closedPostings = normalizedJobs.value.filter((job) => job.isClosed).length
    return {
      sourceRecords: jobsRef.value.length,
      groupedPostings,
      searchablePostings: groupedPostings - closedPostings,
      duplicateRecords: Math.max(0, jobsRef.value.length - groupedPostings),
      closedPostings,
    }
  })
  const allStateValues = computed(() => sortedDistinct(normalizedJobs.value, (job) => job.state))
  const allPositionTypeValues = computed(() =>
    [...new Set(normalizedJobs.value.flatMap((job) => job.positionTypes || []).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  )
  const allCollegeValues = computed(() => sortedDistinct(normalizedJobs.value, (job) => job.college))
  const allDepartmentValues = computed(() => sortedDistinct(normalizedJobs.value, (job) => job.department))
  const allCityValues = computed(() => sortedDistinct(normalizedJobs.value, (job) => job.city))
  const allEmploymentTypeValues = computed(() => sortedDistinct(normalizedJobs.value, (job) => job.employmentType))
  const allWorkModeValues = computed(() => sortedDistinct(normalizedJobs.value, (job) => job.workMode))

  function increment(counts, key) {
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
  }

  function evaluateFilters(filterValues, collectFacets = true) {
    const query = normalizeSearchText(filterValues.q)
    const terms = query.split(/\s+/).filter((term) => term.length >= 2)
    const loadedSearch = searchTermMatchesRef?.value
    const fullTextMatches = loadedSearch?.query === query ? loadedSearch.byTerm : null
    const results = []
    const facets = {
      state: new Map(),
      positionType: new Map(),
      college: new Map(),
      department: new Map(),
      discipline: new Map(),
      subdiscipline: new Map(),
      city: new Map(),
      employmentType: new Map(),
      workMode: new Map(),
      tenureTrack: 0,
    }

    for (const job of normalizedJobs.value) {
      const search = matchSearchTerms(job, terms, fullTextMatches)
      if (!search.matched) continue

      const states = selectedValues(filterValues.state)
      const positionTypes = selectedValues(filterValues.positionType)
      const disciplines = selectedValues(filterValues.discipline)
      const subdisciplines = selectedValues(filterValues.subdiscipline)
      const stateOk = states.length === 0 || states.includes(job.state)
      const positionTypeOk = positionTypes.length === 0 || positionTypes.some((type) => (job.positionTypes || []).includes(type))
      const collegeOk = filterValues.college === ALL_FILTER_VALUE || job.college === filterValues.college
      const departmentOk = filterValues.department === ALL_FILTER_VALUE || job.department === filterValues.department
      const disciplineOk = disciplines.length === 0 || disciplines.includes(job.discipline)
      const subdisciplineOk = subdisciplines.length === 0 || subdisciplines.includes(job.subdiscipline)
      const cityOk = filterValues.city === ALL_FILTER_VALUE || job.city === filterValues.city
      const employmentTypeOk = filterValues.employmentType === ALL_FILTER_VALUE || job.employmentType === filterValues.employmentType
      const workModeOk = filterValues.workMode === ALL_FILTER_VALUE || job.workMode === filterValues.workMode
      const tenureTrackOk = !filterValues.tenureTrackOnly || job.tenureTrack === true
      const savedOk = !filterValues.savedOnly || job.duplicateUrls.some((url) => isSavedJob(url))
      const newOk = !filterValues.newOnly || job.isNew === true
      const closedOk = filterValues.showClosed || !job.isClosed
      const commonOk = savedOk && newOk && closedOk
      const allFacetsOk = stateOk && positionTypeOk && collegeOk && departmentOk && disciplineOk && subdisciplineOk && cityOk && employmentTypeOk && workModeOk && tenureTrackOk

      if (commonOk && allFacetsOk) results.push(search.score ? { ...job, _score: search.score } : job)
      if (!collectFacets || !commonOk) continue

      if (positionTypeOk && collegeOk && departmentOk && disciplineOk && subdisciplineOk && cityOk && employmentTypeOk && workModeOk && tenureTrackOk) increment(facets.state, job.state)
      if (stateOk && collegeOk && departmentOk && disciplineOk && subdisciplineOk && cityOk && employmentTypeOk && workModeOk && tenureTrackOk) {
        for (const positionType of job.positionTypes || []) increment(facets.positionType, positionType)
      }
      if (stateOk && positionTypeOk && departmentOk && disciplineOk && subdisciplineOk && cityOk && employmentTypeOk && workModeOk && tenureTrackOk) increment(facets.college, job.college)
      if (stateOk && positionTypeOk && collegeOk && disciplineOk && subdisciplineOk && cityOk && employmentTypeOk && workModeOk && tenureTrackOk) increment(facets.department, job.department)
      if (stateOk && positionTypeOk && collegeOk && departmentOk && subdisciplineOk && cityOk && employmentTypeOk && workModeOk && tenureTrackOk) increment(facets.discipline, job.discipline)
      if (stateOk && positionTypeOk && collegeOk && departmentOk && disciplineOk && cityOk && employmentTypeOk && workModeOk && tenureTrackOk) increment(facets.subdiscipline, job.subdiscipline)
      if (stateOk && positionTypeOk && collegeOk && departmentOk && disciplineOk && subdisciplineOk && employmentTypeOk && workModeOk && tenureTrackOk) increment(facets.city, job.city)
      if (stateOk && positionTypeOk && collegeOk && departmentOk && disciplineOk && subdisciplineOk && cityOk && workModeOk && tenureTrackOk) increment(facets.employmentType, job.employmentType)
      if (stateOk && positionTypeOk && collegeOk && departmentOk && disciplineOk && subdisciplineOk && cityOk && employmentTypeOk && tenureTrackOk) increment(facets.workMode, job.workMode)
      if (stateOk && positionTypeOk && collegeOk && departmentOk && disciplineOk && subdisciplineOk && cityOk && employmentTypeOk && workModeOk && job.tenureTrack === true) facets.tenureTrack += 1
    }

    return { results, facets }
  }

  const filterEvaluation = computed(() => evaluateFilters(filtersRef.value))

  const stateOptions = computed(() => {
    const counts = filterEvaluation.value.facets.state
    return allStateValues.value.map((value) => {
      const count = counts.get(value) || 0
      return {
        value,
        count,
        label: formatOptionLabel(value, count, 30),
        fullLabel: `${value} (${count})`,
        disabled: count === 0 && !isSelected(filtersRef.value.state, value),
      }
    })
  })

  const positionTypeOptions = computed(() => {
    const counts = filterEvaluation.value.facets.positionType
    return allPositionTypeValues.value.map((value) => {
      const count = counts.get(value) || 0
      return {
        value,
        count,
        label: formatOptionLabel(value, count, 30),
        fullLabel: `${value} (${count})`,
        disabled: count === 0 && !isSelected(filtersRef.value.positionType, value),
      }
    })
  })

  const tenureTrackCount = computed(() => filterEvaluation.value.facets.tenureTrack)

  const collegeOptions = computed(() => {
    const counts = filterEvaluation.value.facets.college
    return allCollegeValues.value.map((value) => {
      const count = counts.get(value) || 0
      return {
        value,
        count,
        label: formatOptionLabel(value, count, 38),
        fullLabel: `${value} (${count})`,
        disabled: count === 0 && filtersRef.value.college !== value,
      }
    })
  })

  const departmentOptions = computed(() => {
    const counts = filterEvaluation.value.facets.department
    return allDepartmentValues.value.map((value) => {
      const count = counts.get(value) || 0
      return {
        value,
        count,
        label: formatOptionLabel(value, count, 40),
        fullLabel: `${value} (${count})`,
        disabled: count === 0 && filtersRef.value.department !== value,
      }
    })
  })

  const disciplineOptions = computed(() => {
    const counts = filterEvaluation.value.facets.discipline
    const allLabels = [...new Set(DISCIPLINE_RULES.map(r => r.label).concat(['Other']))]
    return allLabels
      .map(label => ({ value: label, count: counts.get(label) || 0 }))
      .filter(opt => opt.count > 0 || isSelected(filtersRef.value.discipline, opt.value))
      .sort((a, b) => b.count - a.count)
  })

  // Only meaningful once at least one discipline is selected — the options
  // are the union of the sub-disciplines belonging to the selected
  // discipline(s), so the list narrows/grows as the parent selection changes.
  const subdisciplineOptions = computed(() => {
    const selectedDisciplines = selectedValues(filtersRef.value.discipline)
    if (selectedDisciplines.length === 0) return []
    const counts = filterEvaluation.value.facets.subdiscipline
    const labels = [...new Set(selectedDisciplines.flatMap((d) => subdisciplinesForDiscipline(d).map((s) => s.label)))]
    return labels
      .map((label) => ({ value: label, count: counts.get(label) || 0 }))
      .filter((opt) => opt.count > 0 || isSelected(filtersRef.value.subdiscipline, opt.value))
      .sort((a, b) => b.count - a.count)
  })

  const cityOptions = computed(() => {
    const counts = filterEvaluation.value.facets.city
    return allCityValues.value.map((value) => {
      const count = counts.get(value) || 0
      return {
        value,
        count,
        label: formatOptionLabel(value, count, 30),
        fullLabel: `${value} (${count})`,
        disabled: count === 0 && filtersRef.value.city !== value,
      }
    })
  })

  const employmentTypeOptions = computed(() => {
    const counts = filterEvaluation.value.facets.employmentType
    return allEmploymentTypeValues.value.map((value) => ({ value, count: counts.get(value) || 0 }))
  })

  const workModeOptions = computed(() => {
    const counts = filterEvaluation.value.facets.workMode
    return allWorkModeValues.value.map((value) => ({ value, count: counts.get(value) || 0 }))
  })

  const filteredJobs = computed(() => {
    const out = filterEvaluation.value.results.slice()

    if (filtersRef.value.sortBy === 'title-asc') {
      out.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    } else if (filtersRef.value.sortBy === 'title-desc') {
      out.sort((a, b) => (b.title || '').localeCompare(a.title || ''))
    } else if (filtersRef.value.sortBy === 'university') {
      out.sort((a, b) => (a.college || '').localeCompare(b.college || ''))
    } else if (filtersRef.value.sortBy === 'state') {
      out.sort((a, b) => (a.state || '').localeCompare(b.state || ''))
    } else if (filtersRef.value.sortBy === 'recent') {
      // Most recent POSTED first: jobs with a trustworthy source posting date
      // (datePosted, from JSON-LD/API/listing, no older than
      // STALE_DATE_CUTOFF_ISO) rank above those without, newest posting date at
      // the very top. Jobs with no usable posting date follow, ordered by
      // firstSeen (when our scrape first saw the listing) — this also catches
      // datePosted values so old they're more likely a bad scrape (e.g. a
      // page-creation date) than a real "posted a year+ ago" signal, so they
      // don't bury a listing that was genuinely first seen today. When a search
      // query is active, keep relevance primary so the best match isn't buried.
      const hasQuery = Boolean(clean(filtersRef.value.q))
      out.sort((a, b) => {
        if (hasQuery) {
          const s = (b._score || 0) - (a._score || 0)
          if (s) return s
        }
        const ad = a.datePosted || '', bd = b.datePosted || ''
        const aUsable = Boolean(ad) && ad >= STALE_DATE_CUTOFF_ISO
        const bUsable = Boolean(bd) && bd >= STALE_DATE_CUTOFF_ISO
        // A trustworthy posting date always ranks above a job that has none.
        if (aUsable !== bUsable) return aUsable ? -1 : 1
        if (aUsable && bUsable) {
          if (ad !== bd) return bd.localeCompare(ad) // newest posted first
        } else {
          const af = a.firstSeen || '', bf = b.firstSeen || ''
          if (af !== bf) return bf.localeCompare(af)
        }
        return (a.title || '').localeCompare(b.title || '')
      })
    } else {
      out.sort((a, b) => (b._score || 0) - (a._score || 0))
    }

    return out
  })

  const activeFilterChips = computed(() => {
    const chips = []
    if (clean(filtersRef.value.q)) {
      chips.push({ key: 'search', label: `Search: "${truncate(clean(filtersRef.value.q), 20)}"` })
    }
    for (const value of selectedValues(filtersRef.value.state)) chips.push({ id: `state:${value}`, key: 'state', value, label: value })
    if (filtersRef.value.tenureTrackOnly) chips.push({ key: 'tenureTrackOnly', label: 'Tenure Track' })
    if (filtersRef.value.savedOnly) chips.push({ key: 'savedOnly', label: 'Saved Jobs' })
    if (filtersRef.value.newOnly) chips.push({ key: 'newOnly', label: 'New Since Visit' })
    if (filtersRef.value.showClosed) chips.push({ key: 'showClosed', label: 'Including Closed' })
    for (const value of selectedValues(filtersRef.value.positionType)) chips.push({ id: `positionType:${value}`, key: 'positionType', value, label: value })
    if (filtersRef.value.college !== ALL_FILTER_VALUE) chips.push({ key: 'college', label: truncate(filtersRef.value.college, 25) })
    if (filtersRef.value.department !== ALL_FILTER_VALUE) chips.push({ key: 'department', label: truncate(filtersRef.value.department, 30) })
    for (const value of selectedValues(filtersRef.value.discipline)) chips.push({ id: `discipline:${value}`, key: 'discipline', value, label: value })
    for (const value of selectedValues(filtersRef.value.subdiscipline)) chips.push({ id: `subdiscipline:${value}`, key: 'subdiscipline', value, label: value })
    if (filtersRef.value.city !== ALL_FILTER_VALUE) chips.push({ key: 'city', label: filtersRef.value.city })
    if (filtersRef.value.employmentType !== ALL_FILTER_VALUE) chips.push({ key: 'employmentType', label: filtersRef.value.employmentType })
    if (filtersRef.value.workMode !== ALL_FILTER_VALUE) chips.push({ key: 'workMode', label: filtersRef.value.workMode })
    return chips
  })

  function updateFilters(patch) {
    const next = { ...filtersRef.value, ...patch }
    if ('state' in patch && !('college' in patch)) {
      next.college = ALL_FILTER_VALUE
    }
    // Sub-disciplines are only meaningful under their parent discipline(s), so
    // whenever the discipline selection changes (and the caller isn't already
    // setting subdiscipline explicitly), drop any selected sub-discipline that
    // no longer belongs to a still-selected discipline.
    if ('discipline' in patch && !('subdiscipline' in patch)) {
      const validLabels = new Set(
        selectedValues(next.discipline).flatMap((d) => subdisciplinesForDiscipline(d).map((s) => s.label)),
      )
      next.subdiscipline = selectedValues(next.subdiscipline).filter((label) => validLabels.has(label))
    }
    filtersRef.value = next
  }

  function clearFilterChip(key, value) {
    if (key === 'search') updateFilters({ q: '' })
    if (key === 'state') updateFilters({ state: selectedValues(filtersRef.value.state).filter((item) => item !== value) })
    if (key === 'tenureTrackOnly') updateFilters({ tenureTrackOnly: false })
    if (key === 'savedOnly') updateFilters({ savedOnly: false })
    if (key === 'newOnly') updateFilters({ newOnly: false })
    if (key === 'showClosed') updateFilters({ showClosed: false })
    if (key === 'positionType') updateFilters({ positionType: selectedValues(filtersRef.value.positionType).filter((item) => item !== value) })
    if (key === 'college') updateFilters({ college: ALL_FILTER_VALUE })
    if (key === 'department') updateFilters({ department: ALL_FILTER_VALUE })
    if (key === 'discipline') updateFilters({ discipline: selectedValues(filtersRef.value.discipline).filter((item) => item !== value) })
    if (key === 'subdiscipline') updateFilters({ subdiscipline: selectedValues(filtersRef.value.subdiscipline).filter((item) => item !== value) })
    if (key === 'city') updateFilters({ city: ALL_FILTER_VALUE })
    if (key === 'employmentType') updateFilters({ employmentType: ALL_FILTER_VALUE })
    if (key === 'workMode') updateFilters({ workMode: ALL_FILTER_VALUE })
  }

  function resetFilters() {
    filtersRef.value = createDefaultFilters()
  }

  function countMatches(filterSnapshot) {
    const defaults = createDefaultFilters()
    const merged = { ...defaults, ...(filterSnapshot || {}) }
    return evaluateFilters(merged, false).results.length
  }

  return {
    catalogSummary,
    stateOptions,
    positionTypeOptions,
    tenureTrackCount,
    disciplineOptions,
    subdisciplineOptions,
    collegeOptions,
    departmentOptions,
    cityOptions,
    employmentTypeOptions,
    workModeOptions,
    filteredJobs,
    activeFilterChips,
    updateFilters,
    clearFilterChip,
    resetFilters,
    countMatches,
  }
}
