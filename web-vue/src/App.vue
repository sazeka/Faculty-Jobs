<script setup>
import { computed, onMounted, ref } from 'vue'
import FilterBar from './components/FilterBar.vue'
import ActiveChips from './components/ActiveChips.vue'
import JobCard from './components/JobCard.vue'
import MapPanel from './components/MapPanel.vue'
import TrendsTab from './components/TrendsTab.vue'
import { useSavedJobs } from './composables/useSavedJobs'
import { usePresets } from './composables/usePresets'
import { useJobFilters } from './composables/useJobFilters'
import { useJobsData } from './composables/useJobsData'
import { useAlerts } from './composables/useAlerts'
import { useFilterUrlSync, buildShareUrl } from './composables/useFilterUrlSync'
import { ALL_FILTER_VALUE, createDefaultFilters } from './config/appConfig'

const REPORT_ISSUE_URL = import.meta.env.VITE_REPORT_ISSUE_URL || ''
const baseUrl = import.meta.env.BASE_URL || '/'

const { jobs, scrapedAt, loadError, loadJobs, qualitySummary, newJobsCount, newThisWeek, siteStats } = useJobsData()

// Prefer the global, daily-computed "new this week" figure; fall back to the
// per-visitor count only if site-stats.json hasn't loaded.
const heroNew = computed(() => (newThisWeek.value != null ? newThisWeek.value : newJobsCount.value))
const heroNewLabel = computed(() => (newThisWeek.value != null ? 'new this week' : 'new since last visit'))

// Hero counts. Once the job chunks load, the computed values are authoritative.
// Until then (first visit, cold cache) fall back to site-stats.json — a tiny
// file that loads near-instantly — so the numbers don't sit blank at 0 while
// 50+ chunks stream in, the way "new this week" already shows immediately.
const jobsLoaded = computed(() => jobs.value.length > 0)
// True only on a cold first visit while the job chunks are still streaming in
// (no cache yet, no load error). Used to show a loading message in the posts
// section instead of the "no matches" empty state.
const isInitialLoading = computed(() => !jobsLoaded.value && !loadError.value)
const heroTotal = computed(() =>
  jobsLoaded.value ? qualitySummary.value.total : (Number(siteStats.value?.total) || 0))
const heroInstitutions = computed(() =>
  jobsLoaded.value ? qualitySummary.value.uniqueColleges : (Number(siteStats.value?.uniqueColleges) || 0))
const heroStates = computed(() =>
  jobsLoaded.value ? stateCount.value : (Number(siteStats.value?.stateSystems) || 0))

const filters = ref(createDefaultFilters())
const { savedJobs, isSavedJob, toggleSavedJob } = useSavedJobs()
const { stateOptions, positionTypeOptions, disciplineOptions, collegeOptions, departmentOptions, cityOptions, filteredJobs, activeFilterChips, updateFilters, clearFilterChip, resetFilters, countMatches } =
  useJobFilters({ jobsRef: jobs, filtersRef: filters, isSavedJob })
const { presetItems, saveCurrentPreset, applyPreset, removePreset } = usePresets({ filtersRef: filters, updateFilters })
const { alertsWithCounts, addAlert, removeAlert, subscribeAlert, subscribeStatus, subscribeError } = useAlerts({ filtersRef: filters, countMatches })

// Shareable filter URLs: hydrate from the query string on load, then keep the
// address bar in sync as filters change.
const { applyFromUrl, startSync } = useFilterUrlSync({ filtersRef: filters, updateFilters })
applyFromUrl()
startSync()

const shareCopied = ref(false)
async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(buildShareUrl(filters.value))
    shareCopied.value = true
    setTimeout(() => { shareCopied.value = false }, 2000)
  } catch { /* clipboard unavailable; the address bar already holds the link */ }
}

const hoveredCollege = ref(null)
const activeTab = ref('jobs')
const showAllJobs = ref(false)
const siteViews = ref(null)
const showMethodology = ref(false)
const excludedColleges = ref(null)
const filterDrawerOpen = ref(false)

async function openMethodology() {
  showMethodology.value = true
  if (excludedColleges.value) return
  try {
    const res = await fetch(`${baseUrl}policy-excluded-colleges.json`)
    if (res.ok) excludedColleges.value = await res.json()
  } catch { /* unavailable */ }
}

const LISTINGS_PAGE = 30

const displayedJobs = computed(() =>
  showAllJobs.value ? filteredJobs.value : filteredJobs.value.slice(0, LISTINGS_PAGE)
)

// Top states by job count from real data
const topRegions = computed(() => {
  const counts = new Map()
  for (const job of jobs.value) {
    const s = job.state || job.source || null
    if (s) counts.set(s, (counts.get(s) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([name, count], i) => ({ rank: i + 1, name, count }))
})

// State count
const stateCount = computed(() => new Set(jobs.value.map(j => j.state || j.source).filter(Boolean)).size)

// Scraped date label
const scrapedLabel = computed(() => {
  if (!scrapedAt.value) return null
  const d = new Date(scrapedAt.value)
  return isNaN(d) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
})

// Edition metadata
const todayStr = computed(() => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))

function handleMapCollegeSelect(college) {
  if (!college) updateFilters({ college: ALL_FILTER_VALUE })
  else updateFilters({ college })
}

function handleHoverCollege(college) {
  hoveredCollege.value = college || null
}

function buildReportPayload(job) {
  return {
    reportedAt: new Date().toISOString(),
    reason: 'Broken/outdated listing',
    job: {
      canonicalJobId: job?.canonicalJobId || null,
      title: job?.title || null,
      url: job?.url || null,
      college: job?.college || null,
      source: job?.source || null,
    },
  }
}

async function copyToClipboard(text) {
  if (!navigator.clipboard?.writeText) return false
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

async function reportBadListing(job) {
  const payload = JSON.stringify(buildReportPayload(job), null, 2)
  if (REPORT_ISSUE_URL) {
    const title = encodeURIComponent(`[Bad listing] ${job?.title || 'Faculty listing'}`)
    const body = encodeURIComponent(`\`\`\`json\n${payload}\n\`\`\``)
    window.open(`${REPORT_ISSUE_URL}?title=${title}&body=${body}`, '_blank', 'noopener,noreferrer')
  } else {
    await copyToClipboard(payload)
  }
}

// GoatCounter site code (the CODE in CODE.goatcounter.com). Its public counter
// endpoint returns the live total visit count for the on-page number; the beacon
// script in index.html does the actual tracking. Replace with your code.
const GOATCOUNTER_CODE = 'facultyatlas'

onMounted(async () => {
  if (!GOATCOUNTER_CODE || GOATCOUNTER_CODE.startsWith('__')) return
  try {
    const res = await fetch(`https://${GOATCOUNTER_CODE}.goatcounter.com/counter/TOTAL.json`)
    if (res.ok) {
      const d = await res.json()
      // GoatCounter returns counts as formatted strings (e.g. "1,234").
      const raw = d.count_unique ?? d.count ?? ''
      const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10)
      siteViews.value = Number.isFinite(n) ? n : null
    }
  } catch { /* unavailable */ }
})
</script>

<template>
  <div class="fa-screen fa-grain">

    <!-- ═══ HEADER ═══ -->
    <header class="fa-header">
      <div class="fa-header-top">
        <!-- Wordmark -->
        <div class="fa-wordmark">
          <svg width="34" height="34" viewBox="0 0 64 64" class="fa-compass-svg">
            <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" stroke-width="1.2"/>
            <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>
            <g stroke="currentColor" stroke-width="0.5">
              <line v-for="i in 32" :key="i"
                :x1="32 + Math.cos(((i-1)/32)*Math.PI*2) * (((i-1)%8===0)?22:((i-1)%4===0)?26:28)"
                :y1="32 + Math.sin(((i-1)/32)*Math.PI*2) * (((i-1)%8===0)?22:((i-1)%4===0)?26:28)"
                :x2="32 + Math.cos(((i-1)/32)*Math.PI*2) * 30"
                :y2="32 + Math.sin(((i-1)/32)*Math.PI*2) * 30"
              />
            </g>
            <path d="M 32 8 L 36 32 L 32 28 L 28 32 Z" fill="currentColor"/>
            <path d="M 32 56 L 28 32 L 32 36 L 36 32 Z" fill="none" stroke="currentColor" stroke-width="0.8"/>
            <circle cx="32" cy="32" r="1.8" fill="currentColor"/>
            <text x="32" y="6" text-anchor="middle" font-family="serif" font-size="6" font-style="italic" fill="currentColor">N</text>
          </svg>
          <div>
            <div class="fa-display" style="font-size: 26px; letter-spacing: -0.01em;">
              Faculty <i>Atlas</i>
            </div>
            <div class="fa-meta" style="font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; margin-top: 2px;">
              A Directory of Open Academic Posts
            </div>
          </div>
        </div>

        <!-- Nav -->
        <nav class="fa-nav">
          <button
            v-for="t in ['Jobs', 'Trends']"
            :key="t"
            class="fa-meta fa-nav-link"
            :class="{ active: activeTab === t.toLowerCase() }"
            @click="activeTab = t.toLowerCase()"
          >{{ t }}</button>
          <a href="https://github.com/sazeka/Faculty-Jobs" target="_blank" rel="noreferrer"
            class="fa-meta fa-nav-link">GitHub</a>
          <a href="https://ko-fi.com/stevzeke" target="_blank" rel="noreferrer"
            class="fa-meta fa-nav-link" title="Support Faculty Atlas on Ko-fi">
            <span style="color: var(--accent);" aria-hidden="true">♥</span> Support</a>
        </nav>
      </div>

      <hr class="fa-rule" />

      <!-- Edition bar -->
      <div class="fa-edition-bar">
        <div class="fa-meta" style="display: flex; gap: 24px;">
          <span>{{ todayStr }}</span>
          <span v-if="scrapedLabel" style="color: var(--accent);">● Updated {{ scrapedLabel }}</span>
        </div>
        <div class="fa-meta" style="display: flex; gap: 24px;">
          <span><b style="font-weight: 600; color: var(--ink);">{{ heroTotal.toLocaleString() }}</b> posts</span>
          <span><b style="font-weight: 600; color: var(--ink);">{{ heroInstitutions.toLocaleString() }}</b> institutions</span>
          <span><b style="font-weight: 600; color: var(--ink);">{{ heroStates }}</b> state systems</span>
          <span v-if="siteViews !== null"><b style="font-weight: 600; color: var(--ink);">{{ siteViews.toLocaleString() }}</b> visitors</span>
        </div>
      </div>
    </header>

    <!-- ═══ HERO ═══ -->
    <section class="fa-hero">
      <div class="fa-hero-left">
        <div class="fa-label" style="margin-bottom: 24px;">The Atlas · {{ todayStr }}</div>
        <h1 class="fa-display fa-hero-headline">
          Thousands of<br />
          <i style="color: var(--accent);">open positions</i><br />
          in academia,<br />
          charted.
        </h1>
        <p style="font-family: var(--font-body); font-size: 15px; color: var(--ink-2); margin-top: 28px; max-width: 480px; line-height: 1.6; font-style: italic;">
          A scholarly directory of open faculty posts — free to browse, no account required.
        </p>
      </div>

      <div class="fa-hero-right">
        <!-- Stat grid -->
        <div class="fa-stat-grid">
          <div class="fa-stat">
            <div class="fa-stat-val">{{ heroTotal.toLocaleString() }}</div>
            <div class="fa-stat-label">open posts today</div>
          </div>
          <div class="fa-stat">
            <div class="fa-stat-val">{{ heroInstitutions.toLocaleString() }}</div>
            <div class="fa-stat-label">institutions tracked</div>
          </div>
          <div class="fa-stat">
            <div class="fa-stat-val" style="color: var(--accent);">+{{ heroNew.toLocaleString() }}</div>
            <div class="fa-stat-label">{{ heroNewLabel }}</div>
          </div>
          <div class="fa-stat">
            <div class="fa-stat-val">{{ heroStates }}</div>
            <div class="fa-stat-label">state systems</div>
          </div>
        </div>

        <!-- Search box -->
        <div class="fa-label" style="margin-bottom: 10px;">Search the Atlas</div>
        <div class="fa-search-box">
          <span style="color: var(--ink-3); font-family: var(--font-display); font-size: 20px; font-style: italic; flex-shrink: 0;">⌕</span>
          <input
            class="fa-input"
            style="border: 0; padding: 0; font-size: 15px;"
            :value="filters.q"
            type="search"
            placeholder='e.g. "tenure-track astronomy, west coast"'
            aria-label="Search jobs"
            @input="updateFilters({ q: $event.target.value })"
          />
        </div>

        <!-- Quick filter tags -->
        <div style="display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap;">
          <button
            class="fa-tag"
            :class="{ 'fa-tag-filled': filters.tenureTrackOnly }"
            @click="updateFilters({ tenureTrackOnly: !filters.tenureTrackOnly })"
          >Tenure-Track</button>
          <button
            class="fa-tag"
            :class="{ 'fa-tag-filled': filters.newOnly }"
            @click="updateFilters({ newOnly: !filters.newOnly })"
          >New Only</button>
          <button
            v-for="opt in positionTypeOptions.slice(0, 4)"
            :key="opt.value"
            class="fa-tag"
            :class="{ 'fa-tag-filled': filters.positionType === opt.value }"
            @click="updateFilters({ positionType: filters.positionType === opt.value ? 'all' : opt.value })"
          >{{ opt.label }}</button>
        </div>
      </div>
    </section>

    <!-- Double rule + tagline -->
    <hr class="fa-rule-double" style="margin: 0 var(--pad);" />
    <div class="fa-tagline-bar">
      <div class="fa-meta" style="font-style: italic; color: var(--ink-2); font-family: var(--font-body); font-size: 14px; letter-spacing: 0;">
        A focused search experience designed for professional academic hiring workflows.
      </div>
      <div v-if="loadError" class="fa-meta" style="color: var(--accent);">⚠ {{ loadError }}</div>
    </div>
    <hr class="fa-rule" style="margin: 0 var(--pad);" />

    <!-- ═══ TRENDS TAB ═══ -->
    <TrendsTab v-if="activeTab === 'trends'" :base-url="baseUrl" />

    <!-- ═══ MAP TAB ═══ -->
    <template v-if="activeTab === 'map'">
      <section class="fa-section" style="padding-top: 2px;">
        <div class="fa-section-head">
          <div>
            <div class="fa-label">§ III</div>
            <h2 class="fa-display" style="font-size: 48px; margin: 4px 0 0;">By <i>geography</i></h2>
          </div>
          <div class="fa-viewtoggle" role="group" aria-label="Toggle catalog and map view">
            <button type="button" :class="{ active: activeTab === 'jobs' }" @click="activeTab = 'jobs'">Catalog</button>
            <button type="button" :class="{ active: activeTab === 'map' }" @click="activeTab = 'map'">Map</button>
          </div>
        </div>
        <div class="fa-geo-grid">
          <div class="fa-map-container" style="min-height: 400px;">
            <MapPanel
              style="width: 100%; height: 100%;"
              :jobs="filteredJobs"
              :selected-college="filters.college !== ALL_FILTER_VALUE ? filters.college : null"
              :hovered-college="hoveredCollege"
              @select-college="handleMapCollegeSelect"
              @select-state="(s) => updateFilters({ state: s })"
              @hover-college="handleHoverCollege"
            />
          </div>
          <div>
            <div class="fa-label" style="margin-bottom: 16px;">Top Regions</div>
            <div style="border-top: 1px solid var(--rule);">
              <div v-for="r in topRegions" :key="r.name" class="fa-region-row">
                <span class="fa-meta" style="font-size: 10px; width: 20px;">{{ String(r.rank).padStart(2, '0') }}</span>
                <span class="fa-display" style="font-size: 20px; flex: 1;">{{ r.name }}</span>
                <span class="fa-num" style="font-size: 18px;">{{ r.count.toLocaleString() }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- ═══ JOBS TAB ═══ -->
    <template v-if="activeTab === 'jobs'">
      <!-- § I — Today's catalog -->
      <section class="fa-section" style="padding-top: 2px;">
        <div class="fa-section-head">
          <div>
            <div class="fa-label">§ I</div>
            <h2 class="fa-display" style="font-size: 48px; margin: 4px 0 0;">Today's <i>catalog</i></h2>
          </div>
          <div style="display: flex; gap: 24px; align-items: baseline;">
            <span class="fa-meta">
              Showing <b style="color: var(--ink);">{{ displayedJobs.length.toLocaleString() }}</b>
              of <b style="color: var(--ink);">{{ filteredJobs.length.toLocaleString() }}</b>
            </span>
            <div class="fa-viewtoggle" role="group" aria-label="Toggle catalog and map view">
              <button type="button" :class="{ active: activeTab === 'jobs' }" @click="activeTab = 'jobs'">Catalog</button>
              <button type="button" :class="{ active: activeTab === 'map' }" @click="activeTab = 'map'">Map</button>
            </div>
          </div>
        </div>

        <!-- Active chips -->
        <ActiveChips v-if="activeFilterChips.length" :chips="activeFilterChips" style="margin-bottom: 20px;" @clear-chip="clearFilterChip" />

        <div class="fa-catalog-layout">
          <!-- Sidebar / mobile drawer -->
          <aside class="fa-filters-col" :class="{ 'is-open': filterDrawerOpen }">
            <div class="fa-drawer-header">
              <span class="fa-label">Filters</span>
              <button class="fa-drawer-close" aria-label="Close filters" @click="filterDrawerOpen = false">✕</button>
            </div>
            <FilterBar
              :filters="filters"
              :state-options="stateOptions"
              :position-type-options="positionTypeOptions"
              :discipline-options="disciplineOptions"
              :college-options="collegeOptions"
              :department-options="departmentOptions"
              :city-options="cityOptions"
              :subscribe-status="subscribeStatus"
              :subscribe-error="subscribeError"
              @update:filters="updateFilters"
              @reset-filters="resetFilters"
              @subscribe-alert="subscribeAlert"
              @refresh-data="loadJobs"
            />
          </aside>

          <!-- Mobile backdrop -->
          <Teleport to="body">
            <div v-if="filterDrawerOpen" class="fa-drawer-backdrop" @click="filterDrawerOpen = false" />
          </Teleport>

          <!-- Results -->
          <div class="fa-results-col">
            <!-- Toolbar -->
            <div class="fa-results-toolbar">
              <div class="fa-meta">
                <b style="color: var(--ink);">{{ filteredJobs.length.toLocaleString() }}</b> postings
              </div>
              <div style="display: flex; gap: 12px; align-items: center;">
                <button class="fa-filters-toggle" @click="copyShareLink" :title="'Copy a link to this filtered view'">
                  {{ shareCopied ? '✓ Copied' : '⎘ Copy link' }}
                </button>
                <button class="fa-filters-toggle" @click="filterDrawerOpen = true">⊞ Filters</button>
                <select
                  class="fa-meta"
                  style="background: none; border: none; cursor: pointer; color: var(--ink); font-family: var(--font-mono);"
                  :value="filters.sortBy"
                  @change="updateFilters({ sortBy: $event.target.value })"
                >
                  <option value="recent">Sort: Most recent</option>
                  <option value="relevance">Sort: Relevance</option>
                  <option value="title-asc">Sort: Title A–Z</option>
                  <option value="university">Sort: University</option>
                  <option value="state">Sort: State</option>
                </select>
              </div>
            </div>

            <!-- Listing rows -->
            <div v-if="isInitialLoading && filteredJobs.length === 0" style="padding: 48px 0; text-align: center;">
              <p class="fa-display" style="font-size: 28px; color: var(--ink-3);">Loading postings…</p>
              <p class="fa-meta" style="margin-top: 8px;">Fetching the latest faculty listings.</p>
            </div>

            <div v-else-if="filteredJobs.length === 0" style="padding: 48px 0; text-align: center;">
              <p class="fa-display" style="font-size: 28px; color: var(--ink-3);">No postings match your filters.</p>
              <button class="fa-btn fa-btn-ghost" style="margin-top: 16px;" @click="resetFilters">Clear filters</button>
            </div>

            <div v-else style="border-top: 1px solid var(--rule);">
              <JobCard
                v-for="(job, i) in displayedJobs"
                :key="job.canonicalGroupId || job.canonicalJobId || job.url"
                :job="job"
                :index="i"
                :saved="isSavedJob(job.url)"
                :emphasized="Boolean(hoveredCollege) && job.college === hoveredCollege"
                @toggle-save="toggleSavedJob"
                @hover-college="handleHoverCollege"
                @report-bad-listing="reportBadListing"
              />
            </div>

            <!-- Show more -->
            <div v-if="!showAllJobs && filteredJobs.length > LISTINGS_PAGE" class="fa-show-more">
              <button class="fa-btn fa-btn-ghost" @click="showAllJobs = true">
                Show all {{ filteredJobs.length.toLocaleString() }} postings →
              </button>
            </div>
          </div>
        </div>
      </section>

    </template>

    <!-- ═══ FOOTER ═══ -->
    <footer class="fa-footer">
      <div class="fa-footer-grid">
        <div>
          <div class="fa-wordmark" style="margin-bottom: 16px;">
            <svg width="28" height="28" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" stroke-width="1.2"/>
              <path d="M 32 8 L 36 32 L 32 28 L 28 32 Z" fill="currentColor"/>
              <circle cx="32" cy="32" r="1.8" fill="currentColor"/>
            </svg>
            <div class="fa-display" style="font-size: 22px;">Faculty <i>Atlas</i></div>
          </div>
          <p style="font-size: 14px; line-height: 1.55; color: var(--ink-2); max-width: 320px; font-style: italic; margin: 0;">
            Faculty Atlas catalogs every open faculty post across North American higher education.
            Curated automatically, free to browse.
          </p>
        </div>
        <div>
          <div class="fa-label" style="margin-bottom: 16px;">Browse</div>
          <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px;">
            <li><button class="fa-footer-link" @click="activeTab = 'jobs'; updateFilters({ tenureTrackOnly: false, newOnly: false })">All postings</button></li>
            <li><button class="fa-footer-link" @click="activeTab = 'jobs'; updateFilters({ tenureTrackOnly: true })">Tenure-track only</button></li>
            <li><button class="fa-footer-link" @click="activeTab = 'jobs'; updateFilters({ newOnly: true })">New postings</button></li>
            <li><button class="fa-footer-link" @click="activeTab = 'trends'">Weekly digest</button></li>
          </ul>
        </div>
        <div>
          <div class="fa-label" style="margin-bottom: 16px;">About</div>
          <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px;">
            <li><button class="fa-footer-link" @click="openMethodology">Methodology</button></li>
            <li><a href="https://github.com/sazeka/Faculty-Jobs" target="_blank" rel="noreferrer" class="fa-footer-link">GitHub</a></li>
          </ul>
        </div>
      </div>
      <div class="fa-footer-bottom">
        <div class="fa-meta">Faculty Atlas · An independent academic directory</div>
        <div v-if="siteViews !== null" class="fa-meta">{{ siteViews.toLocaleString() }} visitors</div>
      </div>
    </footer>

    <!-- ═══ METHODOLOGY MODAL ═══ -->
    <Teleport to="body">
      <div v-if="showMethodology" class="fa-modal-backdrop" @click.self="showMethodology = false">
        <div class="fa-modal" role="dialog" aria-modal="true" aria-label="Methodology">
          <div class="fa-modal-header">
            <div>
              <div class="fa-label" style="margin-bottom: 6px;">About the data</div>
              <div class="fa-display" style="font-size: 36px;">Methodology</div>
            </div>
            <button class="fa-modal-close" aria-label="Close" @click="showMethodology = false">✕</button>
          </div>
          <hr class="fa-rule" style="margin: 20px 0;" />
          <div class="fa-modal-body">

            <div class="fa-modal-section">
              <div class="fa-label" style="margin-bottom: 10px;">How it works</div>
              <p>Faculty Atlas automatically scrapes open faculty listings from university employment portals across North America. An automated pipeline runs daily, fetching job data from institutional systems and normalizing it into a unified format. Listings are deduplicated, classified by discipline, and published to this site within minutes of the scrape completing.</p>
            </div>

            <div class="fa-modal-section">
              <div class="fa-label" style="margin-bottom: 10px;">Sources</div>
              <p>Data is collected from state university systems and individual institutions. Current coverage includes the University of California system, California State University, SUNY New York, University of Washington, University of North Carolina system, University of Texas system, and dozens of individual public and private universities across all 50 states. Over {{ heroInstitutions.toLocaleString() }} institutions are currently tracked.</p>
            </div>

            <div class="fa-modal-section">
              <div class="fa-label" style="margin-bottom: 10px;">Classification</div>
              <p><b>Rank</b> is inferred from job titles — "Assistant Professor," "Lecturer," "Visiting Faculty," etc. <b>Tenure-track</b> status is determined by whether the title or posting explicitly mentions tenure or tenure-track. <b>Discipline</b> is inferred by matching job titles and department names against a curated keyword taxonomy covering 13 broad academic fields.</p>
            </div>

            <div class="fa-modal-section">
              <div class="fa-label" style="margin-bottom: 10px;">Freshness & "New" listings</div>
              <p>The catalog is updated daily. A listing is marked <b>New</b> when it appears in the dataset for the first time after your last visit — this is tracked locally in your browser and requires no account. Listings removed from the source institution are dropped from the catalog at the next scrape.</p>
            </div>

            <div class="fa-modal-section">
              <div class="fa-label" style="margin-bottom: 10px;">Limitations</div>
              <p>Faculty Atlas covers institutions with publicly accessible employment portals. Private institutions without standardized career pages, and positions posted only through disciplinary societies (Chronicle of Higher Education, H-Net, MLA Job List, etc.) are not currently included. Closing dates are parsed from source postings and may occasionally be missing or inaccurate.</p>
            </div>

            <div class="fa-modal-section">
              <div class="fa-label" style="margin-bottom: 10px;">
                Excluded institutions
                <span v-if="excludedColleges" style="color: var(--ink-4); font-weight: 400;">
                  · {{ excludedColleges.count }} institutions
                </span>
              </div>
              <p style="margin-bottom: 16px;">A small number of institutions use Oracle Taleo, whose terms of service explicitly prohibit automated data collection. Faculty Atlas respects these restrictions. Workday institutions are covered via Workday's public job-search JSON API rather than HTML scraping. Jobs from Oracle Taleo institutions will not appear in the catalog.</p>

              <div v-if="excludedColleges" class="fa-excluded-grid">
                <div
                  v-for="item in excludedColleges.items"
                  :key="item.college"
                  class="fa-excluded-row"
                >
                  <span class="fa-display" style="font-size: 15px; flex: 1;">{{ item.college }}</span>
                  <span class="fa-tag" style="cursor: default; font-size: 9px; flex-shrink: 0;">{{ item.platform_type }}</span>
                </div>
              </div>
              <div v-else class="fa-meta" style="font-style: italic;">Loading list…</div>
            </div>

          </div>
        </div>
      </div>
    </Teleport>

  </div>
</template>

<style>
@import './assets/design.css';

/* ─── Layout ─── */
.fa-screen { min-height: 100vh; }

.fa-header {
  padding: 24px var(--pad) 0;
  background: var(--paper);
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid var(--rule-2);
}
.fa-header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 20px;
}
.fa-wordmark {
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--ink);
}
.fa-compass-svg { color: var(--ink); }
.fa-nav {
  display: flex;
  gap: 32px;
  align-items: center;
}
.fa-nav-link {
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 11px;
  color: var(--ink-3);
  background: none;
  border: none;
  border-bottom: 1px solid transparent;
  padding-bottom: 4px;
  cursor: pointer;
  text-decoration: none;
  transition: color .15s, border-color .15s;
}
.fa-nav-link:hover,
.fa-nav-link.active {
  color: var(--ink);
  border-bottom-color: var(--ink);
}
.fa-edition-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
}

/* ─── Hero ─── */
.fa-hero {
  padding: 56px var(--pad) 64px;
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 64px;
  align-items: end;
  position: relative;
}
.fa-hero-headline {
  font-size: 128px;
  margin: 0;
  line-height: 0.88;
  letter-spacing: -0.025em;
}
.fa-hero-right { padding-bottom: 8px; align-self: start; }
.fa-stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  row-gap: 0;
  column-gap: 24px;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  margin-bottom: 28px;
}
.fa-stat { padding: 16px 0; }
.fa-stat-val {
  font-family: var(--font-display);
  font-feature-settings: "lnum","tnum";
  font-variant-numeric: lining-nums tabular-nums;
  font-size: 44px;
  line-height: 1;
  color: var(--ink);
}
.fa-stat-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-top: 4px;
}
.fa-search-box {
  border: 1px solid var(--ink);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--paper);
}
.fa-hero-coords {
  position: absolute;
  top: 56px;
  right: var(--pad);
  text-align: right;
  line-height: 1.6;
  font-size: 10px;
}
.fa-tagline-bar {
  padding: 16px var(--pad);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* ─── Sections ─── */
.fa-section {
  padding: 56px var(--pad) 0;
}

/* ─── Catalog layout ─── */
.fa-catalog-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 48px;
}
.fa-filters-col {
  border-right: 1px solid var(--rule-2);
  padding-right: 32px;
}
.fa-sidebar-inner { padding-bottom: 32px; }
.fa-results-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--rule);
  margin-bottom: 0;
}
.fa-show-more {
  padding: 32px 0;
  text-align: center;
  border-top: 1px solid var(--rule-2);
}

/* ─── Geography ─── */
.fa-geo-grid {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 48px;
}
.fa-region-row {
  display: flex;
  gap: 16px;
  align-items: baseline;
  padding: 12px 0;
  border-bottom: 1px solid var(--rule-2);
  transition: background .12s;
}
.fa-region-row:hover { background: rgba(34,28,21,0.025); }

/* ─── Footer ─── */
.fa-footer {
  margin-top: 80px;
  padding: 48px var(--pad) 48px;
  border-top: 2px solid var(--ink);
  background: var(--paper);
}
.fa-footer-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 48px;
  margin-bottom: 48px;
}
.fa-footer-bottom {
  display: flex;
  justify-content: space-between;
  padding-top: 24px;
  border-top: 1px solid var(--rule-2);
}

/* ─── Footer links ─── */
.fa-footer-link {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--ink-2);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: color .15s, border-color .15s;
  display: inline;
}
.fa-footer-link:hover { color: var(--accent); border-bottom-color: var(--accent); }

/* ─── Methodology modal ─── */
.fa-modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(21, 17, 13, 0.55);
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 24px;
  overflow-y: auto;
  backdrop-filter: blur(2px);
}
.fa-modal {
  background: var(--paper);
  border: 1px solid var(--rule);
  width: 100%;
  max-width: 680px;
  padding: 40px 48px 48px;
  position: relative;
}
.fa-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.fa-modal-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  color: var(--ink-3);
  padding: 4px;
  line-height: 1;
  transition: color .15s;
}
.fa-modal-close:hover { color: var(--ink); }
.fa-modal-body { display: flex; flex-direction: column; gap: 0; }
.fa-modal-section {
  padding: 20px 0;
  border-bottom: 1px solid var(--rule-2);
}
.fa-modal-section:last-child { border-bottom: none; }
.fa-modal-section p {
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.72;
  color: var(--ink-2);
  margin: 0;
}
.fa-modal-section p b { font-weight: 600; color: var(--ink); }
.fa-excluded-grid { margin-top: 12px; border-top: 1px solid var(--rule-2); }
.fa-excluded-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--rule-2);
}

/* ─── Map override ─── */
.fa-map-container .map-panel,
.fa-map-container section { height: 100% !important; }
.fa-map-container .leaflet-map { height: 100% !important; min-height: 320px; }
.fa-map-container .map-top-row,
.fa-map-container .map-note { display: none; }

/* ─── Mobile filter drawer ─── */
.fa-filters-toggle {
  display: none;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: none;
  border: 1px solid var(--rule-2);
  color: var(--ink);
  padding: 6px 12px;
  cursor: pointer;
  white-space: nowrap;
}
.fa-filters-toggle:hover { border-color: var(--ink); }

.fa-drawer-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(21, 17, 13, 0.45);
  z-index: 199;
}
.fa-drawer-header {
  display: none;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--rule);
}
.fa-drawer-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  color: var(--ink-3);
  padding: 4px;
  line-height: 1;
  transition: color .15s;
}
.fa-drawer-close:hover { color: var(--ink); }

/* ─── Tablet (hero headline shrink) ─── */
@media (max-width: 1100px) {
  .fa-hero-headline { font-size: 88px; }
  .fa-hero { gap: 40px; }
}

/* ─── Mobile ─── */
@media (max-width: 767px) {
  /* Core padding */
  :root { --pad: 18px; }

  /* Header */
  .fa-header { padding-top: 16px; }
  .fa-header-top { flex-wrap: wrap; gap: 12px; padding-bottom: 14px; }
  .fa-nav { gap: 18px; flex-wrap: wrap; }
  .fa-edition-bar { flex-direction: column; align-items: flex-start; gap: 4px; }
  .fa-edition-bar > div:last-child { display: none; }

  /* Hero */
  .fa-hero {
    grid-template-columns: 1fr;
    padding: 28px var(--pad) 36px;
    gap: 28px;
  }
  .fa-hero-headline { font-size: 56px; }
  .fa-hero-coords { display: none; }
  .fa-stat-grid { margin-bottom: 20px; }
  .fa-stat-val { font-size: 34px; }

  /* Tagline */
  .fa-tagline-bar { flex-direction: column; gap: 6px; }

  /* Sections */
  .fa-section { padding: 28px var(--pad) 0; }
  .fa-section-head { flex-wrap: wrap; gap: 8px; }
  .fa-section-head h2[style] { font-size: 32px !important; }

  /* Catalog */
  .fa-catalog-layout { grid-template-columns: 1fr; gap: 0; }

  /* Filter sidebar → full-screen drawer on mobile */
  .fa-filters-col {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--paper);
    overflow-y: auto;
    padding: 20px var(--pad) 40px;
    border-right: none;
  }
  .fa-filters-col.is-open { display: block; }

  /* Show mobile-only elements */
  .fa-filters-toggle { display: flex; }
  .fa-drawer-backdrop { display: block; }
  .fa-drawer-header { display: flex; }

  /* Geo grid */
  .fa-geo-grid { grid-template-columns: 1fr; }
  .fa-map-container { aspect-ratio: 4 / 3; }

  /* Footer */
  .fa-footer { padding: 36px var(--pad); }
  .fa-footer-grid { grid-template-columns: 1fr; gap: 28px; margin-bottom: 28px; }
  .fa-footer-bottom { flex-direction: column; gap: 4px; }

  /* Modal */
  .fa-modal-backdrop { padding: 16px 12px; }
  .fa-modal { padding: 24px 20px 32px; }
}

/* ── Map markers + legend ── (these lived in the orphaned style.css, which is
   never imported, so they never applied; kept here in the bundled stylesheet) */
.leaflet-job-icon {
  background: transparent;
  border: 0;
}
.leaflet-job-marker {
  width: var(--marker-size);
  height: var(--marker-size);
  transform: scale(var(--marker-zoom-scale, 1));
  transform-origin: center;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  border: 2px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 6px 12px rgba(27, 39, 56, 0.2);
  transition: transform 140ms ease, box-shadow 140ms ease;
  background: linear-gradient(180deg, #4b5566, #363f4d);
}
.leaflet-job-marker.tenure { background: linear-gradient(180deg, #4f6863, #3d524d); }
.leaflet-job-marker.non-tenure { background: linear-gradient(180deg, #786353, #5f4d40); }
.leaflet-job-marker.state-bubble {
  background: linear-gradient(180deg, #E2571C, #C2410C);
  border-color: rgba(255, 255, 255, 0.7);
  opacity: 0.82;
  font-size: 10px;
}
.leaflet-job-marker.active {
  transform: scale(calc(var(--marker-zoom-scale, 1) * 1.14));
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.65), 0 8px 16px rgba(29, 42, 43, 0.24);
}
.leaflet-job-marker.cluster {
  background: linear-gradient(180deg, #2f6f8f, #244f66);
  cursor: pointer;
}
.leaflet-map-wrap {
  position: relative;
  height: 100%;
  min-height: 380px;
}
.leaflet-map-wrap > .leaflet-map { height: 100%; }
.map-stage .leaflet-map-wrap { flex: 1; }

.map-legend {
  position: absolute;
  bottom: 12px;
  right: 12px;
  z-index: 650;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #cfd5de;
  border-radius: 10px;
  box-shadow: 0 4px 10px rgba(27, 39, 56, 0.12);
  font-size: 0.72rem;
  color: #36424a;
}
.map-legend-title { font-weight: 700; font-size: 0.74rem; margin-bottom: 1px; }
.map-legend-item { display: flex; align-items: center; gap: 6px; }
.map-legend .sw {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 1.5px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  flex: none;
}
.map-legend .sw.default { background: linear-gradient(180deg, #4b5566, #363f4d); }
.map-legend .sw.tenure { background: linear-gradient(180deg, #4f6863, #3d524d); }
.map-legend .sw.non-tenure { background: linear-gradient(180deg, #786353, #5f4d40); }
.map-legend .sw.state-bubble { background: linear-gradient(180deg, #E2571C, #C2410C); }
.map-legend-note { margin-top: 2px; color: #6b7780; font-size: 0.68rem; }

@media (max-width: 640px) {
  .map-legend { bottom: 8px; right: 8px; padding: 6px 8px; font-size: 0.66rem; gap: 2px; }
  .map-legend-note { display: none; }
}
@media (prefers-color-scheme: dark) {
  .map-legend { background: rgba(26, 30, 38, 0.92); border-color: #3a424f; color: #c7d3dc; }
  .map-legend-note { color: #8fa1ad; }
}
</style>
