import { computed } from 'vue'
import { ALL_FILTER_VALUE, createDefaultFilters } from '../config/appConfig'
import { SOURCE_TO_STATE_ALIASES, US_STATES_BY_ABBREV } from '../config/jobTaxonomy'

function getPositionType(title) {
  const t = (title || '').toLowerCase()
  if (t.includes('assistant professor')) return 'Assistant Professor'
  if (t.includes('associate professor')) return 'Associate Professor'
  if (t.includes('full professor') || (/(^|\W)professor(\W|$)/.test(t) && !t.includes('assistant') && !t.includes('associate'))) return 'Professor'
  if (t.includes('lecturer')) return 'Lecturer'
  if (t.includes('instructor')) return 'Instructor'
  if (t.includes('visiting')) return 'Visiting Faculty'
  if (t.includes('adjunct')) return 'Adjunct'
  if (t.includes('postdoc') || t.includes('post-doc')) return 'Postdoctoral'
  if (t.includes('research')) return 'Research Faculty'
  if (t.includes('clinical')) return 'Clinical Faculty'
  return 'Faculty'
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

function inferState(job) {
  if (job?.state) return job.state
  const source = String(job?.source || '').trim()
  if (!source) return null
  if (SOURCE_TO_STATE_ALIASES[source]) return SOURCE_TO_STATE_ALIASES[source]
  if (US_STATES_BY_ABBREV[source]) return US_STATES_BY_ABBREV[source]
  return source
}

function normalizeSystemCollege(job) {
  const original = String(job?.college || '').trim()
  if (!original) return null

  const hay = `${job?.title || ''} ${job?.location || ''} ${job?.url || ''}`.toLowerCase()

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

function normalizeForKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ')
}

function deriveConfidenceBadges(job) {
  const badges = []
  if (/^https:\/\//i.test(String(job?.url || ''))) {
    badges.push({ kind: 'good', label: 'Verified Link' })
  }
  if (clean(job?.department)) {
    badges.push({ kind: 'good', label: 'Department Tagged' })
  } else {
    badges.push({ kind: 'warn', label: 'Missing Department' })
  }
  if (!clean(job?.description) || !clean(job?.location)) {
    badges.push({ kind: 'warn', label: 'Missing Metadata' })
  }
  return badges
}

function normalizeJob(job) {
  const normalizedTitle = stripDateTextFromTitle(job?.titleClean || job?.title || '(No title)')
  const title = normalizedTitle || '(No title)'
  const college = normalizeSystemCollege(job)
  const department = job?.department || null
  const state = inferState(job)
  const derivedGroupKey = [normalizeForKey(title), normalizeForKey(college), normalizeForKey(department || ''), normalizeForKey(state || '')]
    .filter(Boolean)
    .join('|')
  const canonicalGroupId = clean(job?.canonicalGroupId) || (derivedGroupKey ? `grp_${derivedGroupKey}` : null)
  const canonicalJobId = clean(job?.canonicalJobId) || clean(job?.url) || `${title}|${college || ''}`

  return {
    title,
    url: job?.url || '#',
    source: job?.source || null,
    college,
    location: job?.location || null,
    department,
    description: job?.description || null,
    summary: job?.summary || null,
    specialization: job?.specialization || null,
    openUntilFilled: Boolean(job?.openUntilFilled),
    closeDateRaw: job?.closeDateRaw || null,
    closeDate: job?.closeDate || null,
    tenureTrack: typeof job?.tenureTrack === 'boolean' ? job.tenureTrack : null,
    positionType: job?.rank || getPositionType(job?.titleClean || job?.title || ''),
    state,
    isNew: Boolean(job?._isNew),
    confidenceBadges: deriveConfidenceBadges(job),
    canonicalJobId,
    canonicalGroupId,
    duplicateGroupKey: canonicalGroupId || normalizeForKey(job?.url || title),
    duplicateCount: 1,
    duplicateUrls: [job?.url || '#'],
  }
}

function truncate(value, length) {
  const str = String(value || '')
  return str.length > length ? `${str.slice(0, length - 1)}...` : str
}

function matchSearchTerms(job, terms) {
  if (terms.length === 0) return { matched: true, score: 0 }
  const hay = [
    job.title,
    job.description,
    job.summary,
    job.source,
    job.college,
    job.location,
    job.department,
    job.specialization,
    job.state,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (!terms.every((term) => hay.includes(term))) return { matched: false, score: 0 }

  let score = 0
  const title = (job.title || '').toLowerCase()
  const dept = (job.department || '').toLowerCase()
  const college = (job.college || '').toLowerCase()
  for (const term of terms) {
    if (title.includes(term)) score += 12
    if (dept.includes(term)) score += 5
    if (college.includes(term)) score += 4
  }
  return { matched: true, score }
}

function countBy(items, selector) {
  const counts = new Map()
  for (const item of items) {
    const key = selector(item)
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
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
      isNew: existing.isNew || job.isNew,
    })
  }

  return [...grouped.values()]
}

export function useJobFilters({ jobsRef, filtersRef, isSavedJob }) {
  const normalizedJobs = computed(() => dedupeGroupedJobs(jobsRef.value.map(normalizeJob)))
  const allStateValues = computed(() => sortedDistinct(normalizedJobs.value, (job) => job.state))
  const allPositionTypeValues = computed(() => sortedDistinct(normalizedJobs.value, (job) => job.positionType))
  const allCollegeValues = computed(() => sortedDistinct(normalizedJobs.value, (job) => job.college))

  function applyFiltersWithValues(filterValues, { ignoreKey = null } = {}) {
    const q = clean(filterValues.q).toLowerCase()
    const terms = q.split(/\s+/).filter((term) => term.length >= 2)
    let out = normalizedJobs.value.slice()

    if (ignoreKey !== 'state' && filterValues.state !== ALL_FILTER_VALUE) {
      out = out.filter((job) => job.state === filterValues.state)
    }
    if (ignoreKey !== 'positionType' && filterValues.positionType !== ALL_FILTER_VALUE) {
      out = out.filter((job) => job.positionType === filterValues.positionType)
    }
    if (ignoreKey !== 'college' && filterValues.college !== ALL_FILTER_VALUE) {
      out = out.filter((job) => job.college === filterValues.college)
    }
    if (ignoreKey !== 'tenureTrackOnly' && filterValues.tenureTrackOnly) {
      out = out.filter((job) => job.tenureTrack === true)
    }
    if (ignoreKey !== 'savedOnly' && filterValues.savedOnly) {
      out = out.filter((job) => job.duplicateUrls.some((url) => isSavedJob(url)))
    }
    if (ignoreKey !== 'newOnly' && filterValues.newOnly) {
      out = out.filter((job) => job.isNew === true)
    }

    if (terms.length === 0) return out

    return out
      .map((job) => {
        const search = matchSearchTerms(job, terms)
        return search.matched ? { ...job, _score: search.score } : null
      })
      .filter(Boolean)
  }

  function applyFilters(opts = {}) {
    return applyFiltersWithValues(filtersRef.value, opts)
  }

  const stateOptions = computed(() => {
    const counts = countBy(applyFilters({ ignoreKey: 'state' }), (job) => job.state)
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
    const counts = countBy(applyFilters({ ignoreKey: 'positionType' }), (job) => job.positionType)
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

  const collegeOptions = computed(() => {
    const counts = countBy(applyFilters({ ignoreKey: 'college' }), (job) => job.college)
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

  const filteredJobs = computed(() => {
    let out = applyFilters()

    if (filtersRef.value.sortBy === 'title-asc') {
      out.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    } else if (filtersRef.value.sortBy === 'title-desc') {
      out.sort((a, b) => (b.title || '').localeCompare(a.title || ''))
    } else if (filtersRef.value.sortBy === 'university') {
      out.sort((a, b) => (a.college || '').localeCompare(b.college || ''))
    } else if (filtersRef.value.sortBy === 'state') {
      out.sort((a, b) => (a.state || '').localeCompare(b.state || ''))
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
    if (filtersRef.value.positionType !== ALL_FILTER_VALUE) chips.push({ key: 'positionType', label: filtersRef.value.positionType })
    if (filtersRef.value.college !== ALL_FILTER_VALUE) chips.push({ key: 'college', label: truncate(filtersRef.value.college, 25) })
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
    if (key === 'positionType') updateFilters({ positionType: ALL_FILTER_VALUE })
    if (key === 'college') updateFilters({ college: ALL_FILTER_VALUE })
  }

  function resetFilters() {
    filtersRef.value = createDefaultFilters()
  }

  function countMatches(filterSnapshot) {
    const defaults = createDefaultFilters()
    const merged = { ...defaults, ...(filterSnapshot || {}) }
    return applyFiltersWithValues(merged).length
  }

  return {
    stateOptions,
    positionTypeOptions,
    collegeOptions,
    filteredJobs,
    activeFilterChips,
    updateFilters,
    clearFilterChip,
    resetFilters,
    countMatches,
  }
}
