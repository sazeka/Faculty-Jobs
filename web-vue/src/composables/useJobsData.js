import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { normalizeSearchText, queryFullTextSearchIndex } from '../../../scripts/lib/jobs-search-index.js'

const CACHE_KEY = 'facultyJobs.jobsCache.v2'
const SEEN_URLS_KEY = 'facultyJobs.seenUrls.v1'
const LAST_VISIT_KEY = 'facultyJobs.lastVisitAt.v1'

function safeParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function toIso(value) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function freshnessLabel(scrapedAt) {
  if (!scrapedAt) return 'Unknown freshness'
  const then = new Date(scrapedAt).getTime()
  if (!Number.isFinite(then)) return 'Unknown freshness'
  const diff = Date.now() - then
  const hours = Math.floor(diff / (60 * 60 * 1000))
  if (hours < 6) return 'Fresh (under 6 hours)'
  if (hours < 24) return 'Recent (under 24 hours)'
  if (hours < 72) return 'Aging (1-3 days old)'
  return 'Stale (over 3 days old)'
}

function computeQualitySummary(jobs, scrapedAt) {
  const total = jobs.length
  let withDescription = 0
  let withDepartment = 0
  let secureUrls = 0
  const colleges = new Set()
  const bySource = new Map()

  for (const job of jobs) {
    if (job?.hasDescription || clean(job?.description)) withDescription += 1
    if (clean(job?.department)) withDepartment += 1
    if (/^https:\/\//i.test(String(job?.url || ''))) secureUrls += 1
    if (clean(job?.college)) colleges.add(clean(job.college))
    const source = clean(job?.source) || 'Unknown'
    bySource.set(source, (bySource.get(source) || 0) + 1)
  }

  const topSources = [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([source, count]) => ({ source, count }))

  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0)

  return {
    total,
    uniqueColleges: colleges.size,
    secureUrlPct: pct(secureUrls),
    withDescriptionPct: pct(withDescription),
    withDepartmentPct: pct(withDepartment),
    freshness: freshnessLabel(scrapedAt),
    topSources,
  }
}

async function readJsonSafe(response, label) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    const preview = String(text || '').slice(0, 80).replace(/\s+/g, ' ')
    throw new Error(`${label} returned non-JSON content (preview: "${preview}")`)
  }
}

async function fetchWithTimeout(url, timeoutMs = 25000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { cache: 'no-cache', signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function loadFromChunks(baseUrl) {
  const manifestResponse = await fetchWithTimeout(`${baseUrl}data/jobs-manifest.json`)
  if (!manifestResponse.ok) {
    throw new Error(`jobs-manifest.json returned ${manifestResponse.status}`)
  }

  const manifest = await readJsonSafe(manifestResponse, 'jobs-manifest.json')
  const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : []
  if (chunks.length === 0) {
    return {
      jobs: [],
      scrapedAt: manifest?.scrapedAt || null,
      transport: 'chunks',
      manifest,
    }
  }

  // Fetch a bounded number in parallel. This path is now used only as a legacy
  // initial-load fallback and for opt-in full-description search.
  const rowsByChunk = new Array(chunks.length)
  let nextChunk = 0
  async function worker() {
    while (nextChunk < chunks.length) {
      const index = nextChunk++
      const chunkPath = String(chunks[index]?.path || '')
      if (!chunkPath) {
        rowsByChunk[index] = []
        continue
      }
      const chunkResponse = await fetchWithTimeout(`${baseUrl}data/${chunkPath}`)
      if (!chunkResponse.ok) throw new Error(`${chunkPath} returned ${chunkResponse.status}`)
      const payload = await readJsonSafe(chunkResponse, chunkPath)
      rowsByChunk[index] = Array.isArray(payload?.jobs) ? payload.jobs : []
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, chunks.length) }, () => worker()))
  const jobs = rowsByChunk.flat()

  return {
    jobs,
    scrapedAt: manifest?.scrapedAt || null,
    transport: 'chunks',
    manifest,
  }
}

async function loadListingIndex(baseUrl) {
  const response = await fetchWithTimeout(`${baseUrl}data/jobs-index.json`)
  if (!response.ok) throw new Error(`jobs-index.json returned ${response.status}`)
  const payload = await readJsonSafe(response, 'jobs-index.json')
  if (!Array.isArray(payload?.jobs)) throw new Error('jobs-index.json has no jobs array')
  return {
    jobs: payload.jobs,
    scrapedAt: payload.scrapedAt || null,
    transport: 'compact index',
    manifest: null,
  }
}

async function loadFullTextIndex(baseUrl) {
  const response = await fetchWithTimeout(`${baseUrl}data/jobs-search-index.json`)
  if (!response.ok) throw new Error(`jobs-search-index.json returned ${response.status}`)
  const payload = await readJsonSafe(response, 'jobs-search-index.json')
  if (!Array.isArray(payload?.terms) || !Array.isArray(payload?.documentIds)) {
    throw new Error('jobs-search-index.json is malformed')
  }
  return payload
}

function loadCachedPayload() {
  const parsed = safeParse(localStorage.getItem(CACHE_KEY) || '{}', {})
  if (!Array.isArray(parsed?.jobs)) return null
  return {
    jobs: parsed.jobs,
    scrapedAt: parsed.scrapedAt || null,
    cachedAt: parsed.cachedAt || null,
    transport: parsed.transport || 'cache',
  }
}

function persistCache(payload) {
  // Drop `description` (can be several KB/job) before caching — with 6k+ jobs the
  // full payload blows past the ~5MB localStorage quota. The cache only needs
  // enough for an instant render; descriptions are refilled on the network load.
  try {
    const minimal = {
      jobs: payload.jobs.map(({ description, ...rest }) => rest),
      scrapedAt: payload.scrapedAt || null,
      cachedAt: new Date().toISOString(),
      transport: payload.transport || 'jobs.json',
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(minimal))
  } catch {
    // Quota exceeded or storage unavailable — caching is best-effort, never fatal.
    try { localStorage.removeItem(CACHE_KEY) } catch { /* ignore */ }
  }
}

function loadSeenUrls() {
  const parsed = safeParse(localStorage.getItem(SEEN_URLS_KEY) || '[]', [])
  return new Set(Array.isArray(parsed) ? parsed : [])
}

function persistSeenUrls(urlsSet) {
  // Best-effort: never let a storage error here abort the load flow.
  try {
    localStorage.setItem(SEEN_URLS_KEY, JSON.stringify([...urlsSet]))
    localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString())
  } catch {
    /* quota exceeded or storage unavailable */
  }
}

// firstSeen is the server-computed date our scrape first saw a listing, stored
// as a date-only string ("2026-06-25"); parse it as UTC midnight to ms.
function parseFirstSeenMs(v) {
  if (!v) return null
  const s = String(v).trim()
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s)
  return Number.isFinite(ms) ? ms : null
}

export function useJobsData() {
  const jobs = ref([])
  const status = ref('Loading jobs...')
  const scrapedAt = ref(null)
  const loadError = ref('')
  const transport = ref('jobs.json')
  const searchTermMatches = ref({ query: '', byTerm: new Map() })
  const searchIndexLoading = ref(false)
  const baseUrl = import.meta.env.BASE_URL || '/'
  let _initialLastVisit = null
  try {
    _initialLastVisit = localStorage.getItem(LAST_VISIT_KEY) || null
  } catch {
    // Ignore in restricted/private browsing environments.
  }
  const lastVisitAt = ref(_initialLastVisit)
  // Fixed for this page load so a first-time visitor does not switch to the
  // compact returning-user layout as soon as this visit is persisted.
  const hadPriorVisit = Boolean(_initialLastVisit)

  const qualitySummary = computed(() => computeQualitySummary(jobs.value, scrapedAt.value))
  // Per-user "new since you last looked" (kept for any local use).
  const newJobsCount = computed(() => jobs.value.filter((j) => j?._isNew === true).length)
  // Global, daily-computed "new" counts (same for every visitor), from
  // data/site-stats.json produced by the job-presence agent each scrape.
  const siteStats = ref(null)
  const newThisWeek = computed(() => {
    const n = Number(siteStats.value?.newPostingsThisWeek ?? siteStats.value?.newThisWeek)
    return Number.isFinite(n) ? n : null
  })

  async function loadSiteStats() {
    try {
      const res = await fetchWithTimeout(`${baseUrl}data/site-stats.json`, 12000)
      if (!res.ok) return
      const data = await readJsonSafe(res, 'site-stats.json')
      if (data && typeof data === 'object') siteStats.value = data
    } catch {
      // Best-effort: the homepage falls back to hiding the figure if unavailable.
    }
  }

  async function loadJobs() {
    loadError.value = ''
    status.value = 'Loading jobs...'

    try {
      const cached = loadCachedPayload()
      if (cached) {
        jobs.value = cached.jobs
        scrapedAt.value = cached.scrapedAt
        transport.value = `cache (${cached.transport})`
        status.value = `Loaded ${cached.jobs.length.toLocaleString()} jobs from cache (refreshing...)`
      }
    } catch (_err) {
      // Ignore bad cache and continue network load.
    }

    try {
      let payload
      try {
        payload = await loadListingIndex(baseUrl)
      } catch (_indexErr) {
        try {
          payload = await loadFromChunks(baseUrl)
        } catch (_manifestErr) {
          const response = await fetchWithTimeout(`${baseUrl}jobs.json`)
          if (!response.ok) throw new Error(`jobs.json returned ${response.status}`)
          const raw = await readJsonSafe(response, 'jobs.json')
          payload = {
            jobs: Array.isArray(raw?.jobs) ? raw.jobs : [],
            scrapedAt: raw?.scrapedAt || null,
            transport: 'jobs.json',
            manifest: null,
          }
        }
      }

      // "New" is based on the server-computed firstSeen (when our scrape first
      // saw the listing), NOT URL novelty — otherwise a posting whose URL changed
      // (e.g. an institution moving to a different source/portal) would falsely
      // read as new. Returning visitors: new = first seen since their last visit;
      // first-time visitors: new = first seen within the last NEW_WINDOW_MS.
      // Records without a firstSeen fall back to the legacy URL-novelty check.
      const seen = loadSeenUrls()
      const lastVisitMs = _initialLastVisit ? Date.parse(_initialLastVisit) : NaN
      const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
      const nowMs = Date.now()
      const nextJobs = payload.jobs.map((job) => {
        const fsMs = parseFirstSeenMs(job?.firstSeen)
        let isNew
        if (fsMs == null) {
          const url = clean(job?.url)
          isNew = Boolean(url) && !seen.has(url)
        } else if (Number.isFinite(lastVisitMs)) {
          isNew = fsMs > lastVisitMs
        } else {
          isNew = nowMs - fsMs <= NEW_WINDOW_MS
        }
        return { ...job, _isNew: isNew }
      })

      jobs.value = nextJobs
      scrapedAt.value = toIso(payload.scrapedAt)
      transport.value = payload.transport || 'jobs.json'
      status.value = `Loaded ${jobs.value.length.toLocaleString()} jobs via ${transport.value}`

      // Record every current URL as "seen" and stamp the visit BEFORE caching, so
      // a cache-quota failure can never skip it — otherwise the next visit's "new
      // since last visit" count falls back to every job (== total).
      for (const job of payload.jobs) {
        const url = clean(job?.url)
        if (url) seen.add(url)
      }
      persistSeenUrls(seen)
      lastVisitAt.value = localStorage.getItem(LAST_VISIT_KEY) || null

      persistCache({ jobs: nextJobs, scrapedAt: scrapedAt.value, transport: transport.value })
    } catch (error) {
      if (jobs.value.length > 0) {
        status.value = 'Using cached jobs (refresh failed)'
        loadError.value = error?.message || String(error)
      } else {
        jobs.value = []
        status.value = 'Failed to load jobs'
        loadError.value = error?.message || String(error)
      }
    }
  }

  let searchIndexPromise = null
  let searchWorker = null
  const workerRequests = new Map()

  function ensureSearchWorker() {
    if (searchWorker || typeof Worker === 'undefined') return searchWorker
    searchWorker = new Worker(new URL('../workers/search.worker.js', import.meta.url), { type: 'module' })
    searchWorker.addEventListener('message', (event) => {
      const request = workerRequests.get(event.data?.id)
      if (!request) return
      workerRequests.delete(event.data.id)
      if (event.data.error) request.reject(new Error(event.data.error))
      else request.resolve(new Map((event.data.matches || []).map(([term, ids]) => [term, new Set(ids)])))
    })
    searchWorker.addEventListener('error', (event) => {
      for (const request of workerRequests.values()) request.reject(event.error || new Error('Search worker failed'))
      workerRequests.clear()
      searchWorker?.terminate()
      searchWorker = null
    })
    return searchWorker
  }

  function searchInWorker(terms, requestId) {
    const worker = ensureSearchWorker()
    if (!worker) return null
    return new Promise((resolve, reject) => {
      workerRequests.set(requestId, { resolve, reject })
      worker.postMessage({ id: requestId, baseUrl, terms })
    })
  }
  let latestSearchRequest = 0
  async function searchFullText(query) {
    const terms = normalizeSearchText(query).split(/\s+/).filter((term) => term.length >= 2)
    const request = ++latestSearchRequest
    if (terms.length === 0) {
      searchTermMatches.value = { query: '', byTerm: new Map() }
      searchIndexLoading.value = false
      return
    }

    searchIndexLoading.value = true
    try {
      const workerResult = searchInWorker(terms, request)
      let matches
      if (workerResult) {
        matches = await workerResult
      } else {
        if (!searchIndexPromise) {
          searchIndexPromise = loadFullTextIndex(baseUrl).catch((error) => {
            searchIndexPromise = null
            throw error
          })
        }
        const index = await searchIndexPromise
        matches = queryFullTextSearchIndex(index, terms)
      }
      if (request === latestSearchRequest) {
        searchTermMatches.value = { query: normalizeSearchText(query), byTerm: matches }
      }
    } finally {
      if (request === latestSearchRequest) searchIndexLoading.value = false
    }
  }

  let manifestPromise = null
  const chunkPromises = new Map()
  async function loadJobDescription(job) {
    if (clean(job?.description) || clean(job?.summary) || !job?.hasDescription) return job
    if (!manifestPromise) {
      manifestPromise = fetchWithTimeout(`${baseUrl}data/jobs-manifest.json`)
        .then(async (response) => {
          if (!response.ok) throw new Error(`jobs-manifest.json returned ${response.status}`)
          return readJsonSafe(response, 'jobs-manifest.json')
        })
        .catch((error) => {
          manifestPromise = null
          throw error
        })
    }
    const manifest = await manifestPromise
    const chunk = (manifest?.chunks || []).find((entry) => clean(entry?.source) === clean(job?.source))
    if (!chunk?.path) return job
    if (!chunkPromises.has(chunk.path)) {
      chunkPromises.set(chunk.path, fetchWithTimeout(`${baseUrl}data/${chunk.path}`)
        .then(async (response) => {
          if (!response.ok) throw new Error(`${chunk.path} returned ${response.status}`)
          return readJsonSafe(response, chunk.path)
        })
        .catch((error) => {
          chunkPromises.delete(chunk.path)
          throw error
        }))
    }
    const payload = await chunkPromises.get(chunk.path)
    const key = clean(job?.canonicalJobId) || clean(job?.url)
    return (payload?.jobs || []).find((candidate) => (clean(candidate?.canonicalJobId) || clean(candidate?.url)) === key) || job
  }

  onMounted(() => {
    loadJobs()
    loadSiteStats()
  })

  onBeforeUnmount(() => {
    searchWorker?.terminate()
    searchWorker = null
    for (const request of workerRequests.values()) request.reject(new Error('Search closed'))
    workerRequests.clear()
  })

  return {
    jobs,
    status,
    scrapedAt,
    loadError,
    loadJobs,
    searchFullText,
    loadJobDescription,
    qualitySummary,
    newJobsCount,
    newThisWeek,
    siteStats,
    transport,
    lastVisitAt,
    searchTermMatches,
    searchIndexLoading,
    hadPriorVisit,
  }
}
