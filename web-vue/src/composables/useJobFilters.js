import { computed } from 'vue'
import { ALL_FILTER_VALUE, createDefaultFilters } from '../config/appConfig.js'
import { SOURCE_TO_STATE_ALIASES, US_STATES_BY_ABBREV } from '../config/jobTaxonomy.js'
import { getPositionType, getPositionTypes, normalizeTenureTrack } from '../lib/jobClassification.js'
import { classifySourceLink, institutionTitleConflict, sanitizePostingDate } from '../lib/listingTrust.js'
import { inferAlaskaCampus } from '../../../scripts/lib/alaska-campus.js'
import { normalizeSearchText } from '../../../scripts/lib/jobs-search-index.js'

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

export const DISCIPLINE_RULES = [
  { label: 'Arts & Music',            terms: ['art', 'music', 'theatre', 'theater', 'dance', 'film', 'studio', 'visual art', 'fine art', 'performing', 'sculpture', 'painting', 'ceramics', 'graphic design', 'illustration', 'photography'] },
  { label: 'Biological Sciences',     terms: ['biology', 'biolog', 'botany', 'zoology', 'ecology', 'genetics', 'genomics', 'neuroscience', 'biochemistry', 'microbiology', 'molecular', 'cell biology', 'evolutionary', 'anatomy', 'physiology', 'marine biology', 'wildlife'] },
  { label: 'Business & Economics',    terms: ['business', 'economics', 'econom', 'accounting', 'finance', 'marketing', 'management', 'entrepreneurship', 'supply chain', 'operations', 'mba', 'commerce', 'hospitality', 'real estate', 'taxation', 'audit'] },
  { label: 'Computer Science & Engineering', terms: ['computer science', 'software', 'computer engineering', 'electrical engineering', 'mechanical engineering', 'civil engineering', 'chemical engineering', 'aerospace', 'biomedical engineering', 'industrial engineering', 'systems engineering', 'data science', 'artificial intelligence', 'machine learning', 'cybersecurity', 'robotics', 'materials science'] },
  { label: 'Education',               terms: ['education', 'teaching', 'curriculum', 'pedagogy', 'early childhood', 'literacy', 'special education', 'educational leadership', 'school counseling', 'instructional design', 'higher education'] },
  { label: 'Health & Medicine',       terms: ['medicine', 'nursing', 'health', 'pharmacy', 'clinical', 'medical', 'dental', 'physical therapy', 'occupational therapy', 'public health', 'epidemiology', 'nutrition', 'kinesiology', 'exercise science', 'radiolog', 'surgery', 'pediatrics', 'psychiatry', 'pathology', 'anesthesiology', 'oncology', 'physician assistant'] },
  { label: 'Humanities',              terms: ['english', 'literature', 'history', 'philosophy', 'classics', 'rhetoric', 'writing', 'humanities', 'religious studies', 'theology', 'ethics', 'medieval', 'cultural studies', 'american studies', 'comparative literature'] },
  { label: 'Languages & Linguistics', terms: ['linguistics', 'language', 'spanish', 'french', 'german', 'chinese', 'japanese', 'arabic', 'portuguese', 'italian', 'russian', 'korean', 'translation', 'applied linguistics', 'esl', 'tesol', 'second language'] },
  { label: 'Law & Criminal Justice',  terms: ['law', 'legal', 'criminology', 'criminal justice', 'jurisprudence', 'paralegal', 'forensic', 'corrections', 'policing', 'homeland security'] },
  { label: 'Mathematics & Statistics',terms: ['mathematics', 'statistics', 'math', 'actuarial', 'applied math', 'calculus', 'algebra', 'analysis', 'probability', 'data analytics'] },
  { label: 'Natural Sciences',        terms: ['physics', 'chemistry', 'geology', 'astronomy', 'astrophysics', 'geophysics', 'environmental science', 'earth science', 'atmospheric', 'oceanography', 'climate', 'geoscience', 'material science'] },
  { label: 'Psychology & Social Work',terms: ['psychology', 'social work', 'counseling', 'mental health', 'behavioral', 'cognitive', 'developmental psychology', 'clinical psychology', 'human services'] },
  { label: 'Social Sciences',         terms: ['sociology', 'anthropology', 'political science', 'geography', 'communications', 'journalism', 'media studies', 'public administration', 'public policy', 'international relations', 'urban planning', 'social science', 'demography', 'gender studies', 'ethnic studies', 'african american', 'chicano', 'latinx'] },
]

export function getDiscipline(job) {
  const hay = `${job.title || ''} ${job.department || ''}`.toLowerCase()
  for (const rule of DISCIPLINE_RULES) {
    if (rule.terms.some(t => hay.includes(t))) return rule.label
  }
  return 'Other'
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

// Extracts "City, ST" from raw location strings like "Campus - Philadelphia, PA"
function extractCity(location) {
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

  const normalized = {
    title,
    url: linkQuality === 'invalid' ? '#' : (job?.url || '#'),
    source: job?.source || null,
    college,
    location: job?.location || null,
    city: extractCity(job?.location),
    department,
    description: job?.description || null,
    summary: job?.summary || null,
    hasDescription: Boolean(job?.hasDescription || clean(job?.description) || clean(job?.summary)),
    specialization: job?.specialization || null,
    discipline: null, // set after object creation
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
      city: new Map(),
      tenureTrack: 0,
    }

    for (const job of normalizedJobs.value) {
      const search = matchSearchTerms(job, terms, fullTextMatches)
      if (!search.matched) continue

      const stateOk = filterValues.state === ALL_FILTER_VALUE || job.state === filterValues.state
      const positionTypeOk = filterValues.positionType === ALL_FILTER_VALUE || (job.positionTypes || []).includes(filterValues.positionType)
      const collegeOk = filterValues.college === ALL_FILTER_VALUE || job.college === filterValues.college
      const departmentOk = filterValues.department === ALL_FILTER_VALUE || job.department === filterValues.department
      const disciplineOk = filterValues.discipline === ALL_FILTER_VALUE || job.discipline === filterValues.discipline
      const cityOk = filterValues.city === ALL_FILTER_VALUE || job.city === filterValues.city
      const tenureTrackOk = !filterValues.tenureTrackOnly || job.tenureTrack === true
      const savedOk = !filterValues.savedOnly || job.duplicateUrls.some((url) => isSavedJob(url))
      const newOk = !filterValues.newOnly || job.isNew === true
      const closedOk = filterValues.showClosed || !job.isClosed
      const commonOk = savedOk && newOk && closedOk
      const allFacetsOk = stateOk && positionTypeOk && collegeOk && departmentOk && disciplineOk && cityOk && tenureTrackOk

      if (commonOk && allFacetsOk) results.push(search.score ? { ...job, _score: search.score } : job)
      if (!collectFacets || !commonOk) continue

      if (positionTypeOk && collegeOk && departmentOk && disciplineOk && cityOk && tenureTrackOk) increment(facets.state, job.state)
      if (stateOk && collegeOk && departmentOk && disciplineOk && cityOk && tenureTrackOk) {
        for (const positionType of job.positionTypes || []) increment(facets.positionType, positionType)
      }
      if (stateOk && positionTypeOk && departmentOk && disciplineOk && cityOk && tenureTrackOk) increment(facets.college, job.college)
      if (stateOk && positionTypeOk && collegeOk && disciplineOk && cityOk && tenureTrackOk) increment(facets.department, job.department)
      if (stateOk && positionTypeOk && collegeOk && departmentOk && cityOk && tenureTrackOk) increment(facets.discipline, job.discipline)
      if (stateOk && positionTypeOk && collegeOk && departmentOk && disciplineOk && tenureTrackOk) increment(facets.city, job.city)
      if (stateOk && positionTypeOk && collegeOk && departmentOk && disciplineOk && cityOk && job.tenureTrack === true) facets.tenureTrack += 1
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
        disabled: count === 0 && filtersRef.value.state !== value,
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
        disabled: count === 0 && filtersRef.value.positionType !== value,
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
      .filter(opt => opt.count > 0 || filtersRef.value.discipline === opt.value)
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
    if (filtersRef.value.state !== ALL_FILTER_VALUE) chips.push({ key: 'state', label: filtersRef.value.state })
    if (filtersRef.value.tenureTrackOnly) chips.push({ key: 'tenureTrackOnly', label: 'Tenure Track' })
    if (filtersRef.value.savedOnly) chips.push({ key: 'savedOnly', label: 'Saved Jobs' })
    if (filtersRef.value.newOnly) chips.push({ key: 'newOnly', label: 'New Since Visit' })
    if (filtersRef.value.showClosed) chips.push({ key: 'showClosed', label: 'Including Closed' })
    if (filtersRef.value.positionType !== ALL_FILTER_VALUE) chips.push({ key: 'positionType', label: filtersRef.value.positionType })
    if (filtersRef.value.college !== ALL_FILTER_VALUE) chips.push({ key: 'college', label: truncate(filtersRef.value.college, 25) })
    if (filtersRef.value.department !== ALL_FILTER_VALUE) chips.push({ key: 'department', label: truncate(filtersRef.value.department, 30) })
    if (filtersRef.value.discipline !== ALL_FILTER_VALUE) chips.push({ key: 'discipline', label: filtersRef.value.discipline })
    if (filtersRef.value.city !== ALL_FILTER_VALUE) chips.push({ key: 'city', label: filtersRef.value.city })
    return chips
  })

  function updateFilters(patch) {
    const next = { ...filtersRef.value, ...patch }
    if ('state' in patch && !('college' in patch)) {
      next.college = ALL_FILTER_VALUE
    }
    filtersRef.value = next
  }

  function clearFilterChip(key) {
    if (key === 'search') updateFilters({ q: '' })
    if (key === 'state') updateFilters({ state: ALL_FILTER_VALUE })
    if (key === 'tenureTrackOnly') updateFilters({ tenureTrackOnly: false })
    if (key === 'savedOnly') updateFilters({ savedOnly: false })
    if (key === 'newOnly') updateFilters({ newOnly: false })
    if (key === 'showClosed') updateFilters({ showClosed: false })
    if (key === 'positionType') updateFilters({ positionType: ALL_FILTER_VALUE })
    if (key === 'college') updateFilters({ college: ALL_FILTER_VALUE })
    if (key === 'department') updateFilters({ department: ALL_FILTER_VALUE })
    if (key === 'discipline') updateFilters({ discipline: ALL_FILTER_VALUE })
    if (key === 'city') updateFilters({ city: ALL_FILTER_VALUE })
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
    collegeOptions,
    departmentOptions,
    cityOptions,
    filteredJobs,
    activeFilterChips,
    updateFilters,
    clearFilterChip,
    resetFilters,
    countMatches,
  }
}
