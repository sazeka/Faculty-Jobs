<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import heroAtlasUrl from './assets/hero-atlas-v2.jpg'
import FilterBar from './components/FilterBar.vue'
import ActiveChips from './components/ActiveChips.vue'
import JobCard from './components/JobCard.vue'
import JobDetailDrawer from './components/JobDetailDrawer.vue'
import MapPanel from './components/MapPanel.vue'
import PresetBar from './components/PresetBar.vue'
import TrendsTab from './components/TrendsTab.vue'
import { useSavedJobs } from './composables/useSavedJobs'
import { usePresets } from './composables/usePresets'
import { useJobFilters } from './composables/useJobFilters'
import { useJobsData } from './composables/useJobsData'
import { useAlerts } from './composables/useAlerts'
import { useFilterUrlSync, buildShareUrl } from './composables/useFilterUrlSync'
import { ALL_FILTER_VALUE, createDefaultFilters } from './config/appConfig'

const REPORT_ISSUE_URL = import.meta.env.VITE_REPORT_ISSUE_URL || 'https://github.com/sazeka/Faculty-Jobs/issues/new'
const baseUrl = import.meta.env.BASE_URL || '/'

const { jobs, scrapedAt, loadError, loadJobs, searchFullText, loadJobDescription, searchTermMatches, searchIndexLoading, qualitySummary, newJobsCount, newThisWeek, siteStats, hadPriorVisit } = useJobsData()

// Prefer the global, daily-computed "new this week" figure; fall back to the
// per-visitor count only if site-stats.json hasn't loaded.
const heroNew = computed(() => (newThisWeek.value != null ? newThisWeek.value : newJobsCount.value))
const heroNewLabel = computed(() => (newThisWeek.value != null ? 'new to Atlas this week' : 'new since last visit'))

// Hero counts. Once the job chunks load, the computed values are authoritative.
// Until then (first visit, cold cache) fall back to site-stats.json — a tiny
// file that loads near-instantly — so the numbers don't sit blank at 0 while
// 50+ chunks stream in, the way "new this week" already shows immediately.
const jobsLoaded = computed(() => jobs.value.length > 0)
// True only on a cold first visit while the job chunks are still streaming in
// (no cache yet, no load error). Used to show a loading message in the posts
// section instead of the "no matches" empty state.
const isInitialLoading = computed(() => !jobsLoaded.value && !loadError.value)
const heroSourceRecords = computed(() =>
  jobsLoaded.value ? catalogSummary.value.sourceRecords : (Number(siteStats.value?.sourceRecords ?? siteStats.value?.total) || 0))
const heroTotal = computed(() =>
  jobsLoaded.value ? catalogSummary.value.searchablePostings : (Number(siteStats.value?.searchablePostings ?? siteStats.value?.total) || 0))
const heroTotalLabel = computed(() =>
  jobsLoaded.value || siteStats.value?.searchablePostings != null ? 'searchable postings' : 'source records loading')
const heroInstitutions = computed(() =>
  jobsLoaded.value ? qualitySummary.value.uniqueColleges : (Number(siteStats.value?.uniqueColleges) || 0))
const heroNoOpenings = computed(() => {
  const count = Number(siteStats.value?.institutionsWithNoCurrentOpenings)
  return Number.isFinite(count) ? count : null
})
const universityCoverage = computed(() => siteStats.value?.universityCoverage || null)
const heroCoveragePercent = computed(() => {
  const value = Number(universityCoverage.value?.percent)
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
})
const coverageDetail = computed(() => {
  const covered = Number(universityCoverage.value?.covered)
  const total = Number(universityCoverage.value?.total)
  const excluded = Number(universityCoverage.value?.excluded)
  if (!Number.isFinite(covered) || !Number.isFinite(total)) return 'Audited U.S. university coverage'
  const excludedText = Number.isFinite(excluded) ? `; ${excluded.toLocaleString()} policy-excluded` : ''
  return `${covered.toLocaleString()} of ${total.toLocaleString()} eligible U.S. institutions covered${excludedText}`
})

const filters = ref(createDefaultFilters())
const queryDraft = ref(filters.value.q)
let queryTimer
function updateQueryDraft(value) {
  queryDraft.value = value
  clearTimeout(queryTimer)
  queryTimer = setTimeout(() => updateFilters({ q: value }), 175)
}
watch(() => filters.value.q, (query) => {
  if (query !== queryDraft.value) queryDraft.value = query
  searchFullText(query).catch(() => {})
})
onBeforeUnmount(() => clearTimeout(queryTimer))
const { savedJobs, isSavedJob, toggleSavedJob } = useSavedJobs()
const { catalogSummary, stateOptions, positionTypeOptions, tenureTrackCount, disciplineOptions, collegeOptions, departmentOptions, cityOptions, filteredJobs, activeFilterChips, updateFilters, clearFilterChip, resetFilters, countMatches } =
  useJobFilters({ jobsRef: jobs, filtersRef: filters, isSavedJob, searchTermMatchesRef: searchTermMatches })
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
const MAP_VISIBILITY_KEY = 'faculty-atlas-map-visible-v1'
const FILTER_VISIBILITY_KEY = 'faculty-atlas-filters-visible-v1'
const showMapRail = ref(readMapVisibility())
const showFiltersCol = ref(readFilterVisibility())
const showAllJobs = ref(false)
const showMethodology = ref(false)
const excludedColleges = ref(null)
const filterDrawerOpen = ref(false)
const catalogSection = ref(null)
const selectedJob = ref(null)
const savedCount = computed(() => savedJobs.value.size)

function readMapVisibility() {
  try {
    return localStorage.getItem(MAP_VISIBILITY_KEY) !== 'false'
  } catch {
    return true
  }
}

function readFilterVisibility() {
  try {
    return localStorage.getItem(FILTER_VISIBILITY_KEY) !== 'false'
  } catch {
    return true
  }
}

function setMapRailVisibility(visible) {
  showMapRail.value = visible
  if (!visible) hoveredCollege.value = null
  try {
    localStorage.setItem(MAP_VISIBILITY_KEY, String(visible))
  } catch { /* storage unavailable */ }
}

function setFiltersColVisibility(visible) {
  showFiltersCol.value = visible
  if (!visible) filterDrawerOpen.value = false
  try {
    localStorage.setItem(FILTER_VISIBILITY_KEY, String(visible))
  } catch { /* storage unavailable */ }
}

async function openJobDetail(job) {
  selectedJob.value = job
  try {
    const full = await loadJobDescription(job)
    if (full && selectedJob.value) selectedJob.value = { ...selectedJob.value, ...full }
  } catch {
    // The drawer remains useful even when the optional full description fails.
  }
}

function focusCatalog() {
  activeTab.value = 'jobs'
  requestAnimationFrame(() => catalogSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

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

</script>

<template>
  <div class="fa-screen">
    <header class="fa-header">
      <button class="fa-wordmark" type="button" aria-label="Faculty Atlas home" @click="focusCatalog">
        <svg width="38" height="38" viewBox="0 0 64 64" class="fa-compass-svg" aria-hidden="true">
          <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="1.2"/>
          <circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" stroke-width=".6" opacity=".55"/>
          <path d="M32 7l4 25-4-4-4 4z" fill="currentColor"/>
          <path d="M32 57l-4-25 4 4 4-4z" fill="none" stroke="currentColor" stroke-width="1"/>
          <circle cx="32" cy="32" r="2" fill="currentColor"/>
        </svg>
        <span class="fa-display">Faculty <i>Atlas</i></span>
      </button>

      <nav class="fa-nav" aria-label="Primary navigation">
        <button class="fa-nav-link" :class="{ active: activeTab === 'jobs' || activeTab === 'map' }" @click="focusCatalog">Explore jobs</button>
        <button class="fa-nav-link" :class="{ active: activeTab === 'trends' }" @click="activeTab = 'trends'">Market trends</button>
        <button class="fa-nav-link" @click="openMethodology">About the data</button>
      </nav>

      <button class="fa-saved-button" :class="{ active: filters.savedOnly }" @click="activeTab = 'jobs'; updateFilters({ savedOnly: !filters.savedOnly })">
        {{ filters.savedOnly ? '♥' : '♡' }} Saved · {{ savedCount }}
      </button>
    </header>

    <template v-if="activeTab !== 'trends'">
      <section class="fa-hero">
        <div class="fa-hero-copy">
          <div class="fa-label">The academic job market, mapped</div>
          <h1 class="fa-display">Navigate the <i>academic job market.</i></h1>
          <p>A transparent, independent catalog of faculty openings across North America—updated every day and free to search.</p>
          <div class="fa-stat-grid" aria-label="Catalog summary">
            <div class="fa-stat"><div class="fa-stat-val">{{ heroTotal.toLocaleString() }}</div><div class="fa-stat-label">Open roles</div></div>
            <div class="fa-stat fa-stat--this-week"><div class="fa-stat-val">+{{ heroNew.toLocaleString() }}</div><div class="fa-stat-label">This week</div></div>
            <div class="fa-stat"><div class="fa-stat-val">{{ heroInstitutions.toLocaleString() }}</div><div class="fa-stat-label">Institutions</div></div>
            <div class="fa-stat fa-stat--no-openings"><div class="fa-stat-val">{{ heroNoOpenings == null ? '—' : heroNoOpenings.toLocaleString() }}</div><div class="fa-stat-label">Institutions with no current openings</div></div>
          </div>
        </div>
        <div class="fa-hero-visual">
          <div class="fa-hero-art" aria-hidden="true">
            <img :src="heroAtlasUrl" alt="" width="1536" height="1024" decoding="async" fetchpriority="high" />
          </div>
        </div>
      </section>

      <section class="fa-search-band" aria-label="Search the catalog">
        <div class="fa-search-box">
          <span aria-hidden="true">⌕</span>
          <input
            class="fa-input"
            :value="queryDraft"
            type="search"
            placeholder="Search by field, institution, title, or place…"
            aria-label="Search jobs"
            @input="updateQueryDraft($event.target.value)"
            @keydown.enter="focusCatalog"
          />
          <button type="button" @click="focusCatalog">Search</button>
        </div>
        <div class="fa-search-meta">
          <span v-if="searchIndexLoading">Loading full-text index…</span>
          <a :href="`${baseUrl}policy-exclusions.html`" :title="coverageDetail">{{ heroCoveragePercent }} U.S. university coverage</a>
        </div>
        <div v-if="loadError" class="fa-load-error">⚠ {{ loadError }}</div>
      </section>
    </template>

    <TrendsTab v-if="activeTab === 'trends'" :base-url="baseUrl" />

    <section
      v-if="activeTab === 'jobs'"
      ref="catalogSection"
      class="fa-catalog-shell"
      :class="{ 'is-map-hidden': !showMapRail, 'is-filters-hidden': !showFiltersCol }"
    >
      <Teleport to="body">
        <div v-if="filterDrawerOpen" class="fa-drawer-backdrop" @click="filterDrawerOpen = false" />
      </Teleport>

      <aside v-if="showFiltersCol || filterDrawerOpen" class="fa-filters-col" :class="{ 'is-open': filterDrawerOpen }">
        <div class="fa-drawer-header">
          <span class="fa-label">Refine results</span>
          <button class="fa-drawer-close" aria-label="Close filters" @click="filterDrawerOpen = false">✕</button>
        </div>
        <FilterBar
          :filters="filters"
          :query-input="queryDraft"
          :state-options="stateOptions"
          :position-type-options="positionTypeOptions"
          :tenure-track-count="tenureTrackCount"
          :discipline-options="disciplineOptions"
          :college-options="collegeOptions"
          :department-options="departmentOptions"
          :city-options="cityOptions"
          :subscribe-status="subscribeStatus"
          :subscribe-error="subscribeError"
          @update:filters="updateFilters"
          @update:query="updateQueryDraft"
          @reset-filters="resetFilters"
          @subscribe-alert="subscribeAlert"
          @refresh-data="loadJobs"
        />
      </aside>

      <main class="fa-results-col">
        <ActiveChips v-if="activeFilterChips.length" :chips="activeFilterChips" @clear-chip="clearFilterChip" />
        <PresetBar
          :items="presetItems"
          :has-active-filters="activeFilterChips.length > 0"
          @save-current="saveCurrentPreset"
          @apply-preset="applyPreset"
          @remove-preset="removePreset"
        />
        <div class="fa-results-toolbar">
          <div>
            <h2 class="fa-display">{{ filteredJobs.length.toLocaleString() }} academic roles</h2>
            <span v-if="jobsLoaded">From {{ catalogSummary.sourceRecords.toLocaleString() }} verified source records</span>
            <span v-else>Loading the latest catalog…</span>
          </div>
          <div class="fa-toolbar-actions">
            <button class="fa-tool-button" @click="copyShareLink">{{ shareCopied ? '✓ Copied' : '⎘ Share' }}</button>
            <button class="fa-tool-button fa-filters-toggle" @click="filterDrawerOpen = true">⊞ Filters</button>
            <select :value="filters.sortBy" aria-label="Sort jobs" @change="updateFilters({ sortBy: $event.target.value })">
              <option value="recent">Newest first</option>
              <option value="relevance">Most relevant</option>
              <option value="title-asc">Title A–Z</option>
              <option value="university">University</option>
              <option value="state">State</option>
            </select>
          </div>
          <button
            class="fa-filter-divider-toggle"
            :class="{ 'is-collapsed': !showFiltersCol }"
            type="button"
            :aria-label="showFiltersCol ? 'Hide filters' : 'Show filters'"
            :title="showFiltersCol ? 'Hide filters' : 'Show filters'"
            @click="setFiltersColVisibility(!showFiltersCol)"
          ><span aria-hidden="true">{{ showFiltersCol ? '‹' : '›' }}</span></button>
          <button
            class="fa-map-divider-toggle"
            :class="{ 'is-collapsed': !showMapRail }"
            type="button"
            :aria-label="showMapRail ? 'Hide results map' : 'Show results map'"
            :title="showMapRail ? 'Hide map' : 'Show map'"
            @click="setMapRailVisibility(!showMapRail)"
          ><span aria-hidden="true">{{ showMapRail ? '›' : '‹' }}</span></button>
        </div>

        <div v-if="isInitialLoading && filteredJobs.length === 0" class="fa-empty-state">
          <p class="fa-display">Loading postings…</p><span>Fetching the latest faculty listings.</span>
        </div>
        <div v-else-if="filteredJobs.length === 0" class="fa-empty-state">
          <p class="fa-display">No postings match your filters.</p>
          <button class="fa-btn fa-btn-ghost" @click="resetFilters">Clear filters</button>
        </div>
        <div v-else class="fa-job-list">
          <JobCard
            v-for="(job, i) in displayedJobs"
            :key="job.canonicalGroupId || job.canonicalJobId || job.url"
            :job="job"
            :index="i"
            :saved="isSavedJob(job.url)"
            :emphasized="Boolean(hoveredCollege) && job.college === hoveredCollege"
            @toggle-save="toggleSavedJob"
            @open-detail="openJobDetail"
            @hover-college="handleHoverCollege"
            @report-bad-listing="reportBadListing"
          />
        </div>
        <div v-if="!showAllJobs && filteredJobs.length > LISTINGS_PAGE" class="fa-show-more">
          <button class="fa-btn fa-btn-ghost" @click="showAllJobs = true">Show all {{ filteredJobs.length.toLocaleString() }} postings →</button>
        </div>
      </main>

      <aside v-if="showMapRail" class="fa-map-rail">
        <div class="fa-map-rail-head">
          <span>Results on the map</span>
          <div class="fa-map-rail-actions">
            <button type="button" @click="activeTab = 'map'">Expand ↗</button>
          </div>
        </div>
        <MapPanel
          :jobs="filteredJobs"
          :selected-college="filters.college !== ALL_FILTER_VALUE ? filters.college : null"
          :hovered-college="hoveredCollege"
          @select-college="handleMapCollegeSelect"
          @select-state="(s) => updateFilters({ state: s })"
          @hover-college="handleHoverCollege"
        />
        <div class="fa-map-summary">
          <strong class="fa-display">Explore openings by place.</strong>
          <span>Select a marker to filter the catalog by institution.</span>
        </div>
      </aside>
    </section>

    <section v-if="activeTab === 'map'" class="fa-map-page">
      <div class="fa-map-page-head">
        <div><div class="fa-label">Geographic explorer</div><h2 class="fa-display">Openings across the map</h2></div>
        <button class="fa-btn fa-btn-ghost" @click="activeTab = 'jobs'">← Back to catalog</button>
      </div>
      <div class="fa-map-page-grid">
        <MapPanel
          :jobs="filteredJobs"
          :selected-college="filters.college !== ALL_FILTER_VALUE ? filters.college : null"
          :hovered-college="hoveredCollege"
          @select-college="handleMapCollegeSelect"
          @select-state="(s) => updateFilters({ state: s })"
          @hover-college="handleHoverCollege"
        />
      </div>
    </section>

    <footer class="fa-footer">
      <div><strong>Updated {{ scrapedLabel || 'daily' }}</strong><span> · Source links verified nightly</span></div>
      <div><button @click="openMethodology">Open data methodology</button><a :href="`${baseUrl}post-quality-dashboard.html`">Quality dashboard</a><a href="https://github.com/sazeka/Faculty-Jobs" target="_blank" rel="noreferrer">GitHub</a></div>
    </footer>

    <Teleport to="body">
      <JobDetailDrawer
        v-if="selectedJob"
        :job="selectedJob"
        :saved="isSavedJob(selectedJob.url)"
        @close="selectedJob = null"
        @toggle-save="toggleSavedJob"
        @report-bad-listing="reportBadListing"
      />
    </Teleport>

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
              <p>Faculty Atlas collects publicly accessible faculty listings from institutional employment portals. An automated pipeline runs daily, normalizes source records into a unified format, consolidates duplicates, and hides expired postings by default. The headline catalog count refers to consolidated, searchable postings; source-record totals can be higher.</p>
            </div>

            <div class="fa-modal-section">
              <div class="fa-label" style="margin-bottom: 10px;">Sources</div>
              <p>Data is collected from state university systems and individual institutions. Current coverage includes the University of California system, California State University, SUNY New York, University of Washington, University of North Carolina system, University of Texas system, and dozens of individual public and private universities across all 50 states. The “no current openings” statistic counts covered, in-scope institutions whose latest scrape returned zero faculty listings; policy-excluded or missing sources are not counted as zero-opening schools.</p>
            </div>

            <div class="fa-modal-section">
              <div class="fa-label" style="margin-bottom: 10px;">Classification</div>
              <p><b>Rank</b> is inferred from job titles — "Assistant Professor," "Lecturer," "Visiting Faculty," etc. <b>Tenure-track</b> status is determined by whether the title or posting explicitly mentions tenure or tenure-track. <b>Discipline</b> is inferred by matching job titles and department names against a curated keyword taxonomy covering 13 broad academic fields.</p>
            </div>

            <div class="fa-modal-section">
              <div class="fa-label" style="margin-bottom: 10px;">Freshness & "New" listings</div>
              <p>The catalog is updated daily. <b>New to Atlas</b> means a consolidated posting was first cataloged after your previous visit; it does not claim that the institution posted the job on that date. The weekly figure likewise measures postings first cataloged by Faculty Atlas. This is tracked locally in your browser and requires no account.</p>
            </div>

            <div class="fa-modal-section">
              <div class="fa-label" style="margin-bottom: 10px;">Limitations</div>
              <p>Coverage is limited to institutions and platforms that expose publicly accessible listings, so this is not a claim of complete North American coverage. Dates, tenure status, institution attribution, and links are checked for obvious contradictions; suspect values are suppressed or visibly flagged, but source data can still be incomplete. Positions posted only through disciplinary societies are not currently included.</p>
            </div>

            <div class="fa-modal-section">
              <div class="fa-label" style="margin-bottom: 10px;">
                Excluded institutions
                <span v-if="excludedColleges" style="color: var(--ink-4); font-weight: 400;">
                  · {{ excludedColleges.count }} institutions
                </span>
              </div>
              <p style="margin-bottom: 16px;">A small number of institutions use Oracle Taleo, whose terms of service explicitly prohibit automated data collection. Faculty Atlas respects these restrictions. Workday institutions are covered via Workday's public job-search JSON API rather than HTML scraping. Jobs from Oracle Taleo institutions will not appear in the catalog. A separate group of institutions run on InterviewExchange, whose WAF returns a hard 403 to our scraper regardless of the request's origin — confirmed from a cloud server, a residential connection, and a commercial VPN alike — so those are excluded until that access issue is resolved. Hover any row below for the specific reason.</p>

              <div v-if="excludedColleges" class="fa-excluded-grid">
                <div
                  v-for="item in excludedColleges.items"
                  :key="item.college"
                  class="fa-excluded-row"
                  :title="item.reason"
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
.fa-inline-link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
  text-underline-offset: 2px;
}
.fa-inline-link:hover { color: var(--accent); }

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
.fa-hero-right { padding-bottom: 8px; align-self: center; }
.fa-hero-compact {
  padding-top: 32px;
  padding-bottom: 36px;
  grid-template-columns: minmax(0, 1fr) 460px;
  align-items: center;
}
.fa-hero-compact .fa-hero-headline-returning {
  font-size: 76px;
  line-height: 0.92;
}
.fa-hero-compact .fa-hero-left > p { margin-top: 16px !important; }
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
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--rule);
  margin-bottom: 0;
}
.fa-map-divider-toggle,
.fa-filter-divider-toggle {
  position: absolute;
  z-index: 850;
  top: 50%;
  right: -40px;
  width: 27px;
  height: 40px;
  transform: translateY(-50%);
  border: 1px solid var(--rule-2);
  border-radius: 14px;
  color: var(--ocean);
  background: rgba(255, 254, 250, .96);
  box-shadow: 0 4px 14px rgba(25, 43, 53, .13);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.fa-filter-divider-toggle { right: auto; left: -40px; }
.fa-map-divider-toggle.is-collapsed { right: -12px; }
.fa-filter-divider-toggle.is-collapsed { left: -12px; }
.fa-map-divider-toggle:hover,
.fa-filter-divider-toggle:hover { border-color: var(--ocean); color: var(--accent); }
.fa-map-divider-toggle:focus-visible,
.fa-filter-divider-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
  .fa-hero-compact { grid-template-columns: minmax(0, 1fr) 400px; }
  .fa-hero-compact .fa-hero-headline-returning { font-size: 62px; }
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
  .fa-hero-compact { grid-template-columns: 1fr; padding: 24px var(--pad) 30px; }
  .fa-hero-compact .fa-hero-headline-returning { font-size: 48px; }
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

/* ═══════════════════════════════════════════════════════════════════════════
   Search-first redesign
   ═══════════════════════════════════════════════════════════════════════════ */
.fa-screen {
  background: var(--paper);
  color: var(--ink);
}

.fa-header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 28px;
  min-height: 72px;
  padding: 0 var(--pad);
  color: var(--ink);
  background: color-mix(in srgb, var(--paper) 94%, transparent);
  border-bottom: 1px solid var(--rule-2);
  box-shadow: 0 8px 28px rgba(24, 38, 46, .045);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}
.fa-header .fa-wordmark {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0;
  border: 0;
  color: var(--ink);
  background: transparent;
  cursor: pointer;
}
.fa-header .fa-wordmark .fa-display { font-size: 25px; line-height: 1; }
.fa-header .fa-wordmark i { color: var(--accent); }
.fa-header .fa-compass-svg { color: var(--accent); }
.fa-nav {
  justify-self: center;
  display: flex;
  align-self: stretch;
  gap: 6px;
}
.fa-nav-link {
  appearance: none;
  padding: 3px 13px 0;
  border: 0;
  border-bottom: 3px solid transparent;
  color: var(--ink-3);
  background: transparent;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  cursor: pointer;
}
.fa-nav-link:hover,
.fa-nav-link.active { color: var(--ink); border-bottom-color: var(--accent); }
.fa-saved-button {
  appearance: none;
  border: 1px solid var(--rule);
  border-radius: 999px;
  padding: 9px 14px;
  color: var(--ink-2);
  background: color-mix(in srgb, var(--paper-2) 76%, transparent);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}
.fa-saved-button:hover,
.fa-saved-button.active { border-color: var(--accent); color: var(--accent); background: #fff; }

.fa-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(390px, .92fr);
  align-items: center;
  gap: clamp(30px, 3.5vw, 56px);
  padding: 40px var(--pad) 34px;
  overflow: hidden;
  background-color: var(--paper);
  background-image: linear-gradient(rgba(18, 38, 58, .035) 1px, transparent 1px), linear-gradient(90deg, rgba(18, 38, 58, .035) 1px, transparent 1px);
  background-size: 24px 24px;
  border-bottom: 1px solid var(--rule-2);
}
.fa-hero-copy { position: relative; z-index: 2; }
.fa-hero-copy .fa-label { margin-bottom: 9px; color: var(--accent); font-weight: 600; }
.fa-hero h1 {
  max-width: 760px;
  margin: 0;
  font-size: clamp(46px, 5.2vw, 72px);
  line-height: .98;
  letter-spacing: -.035em;
}
.fa-hero h1 i { color: var(--accent); }
.fa-hero-copy p {
  max-width: 680px;
  margin: 14px 0 0;
  color: var(--ink-3);
  font-size: 16px;
  line-height: 1.55;
}
.fa-hero-visual {
  position: relative;
  align-self: stretch;
  min-height: 286px;
  min-width: 0;
}
.fa-hero-art {
  position: absolute;
  inset: -40px calc(-1 * var(--pad)) -34px -118px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to right, transparent 0%, #000 24%, #000 100%);
  mask-image: linear-gradient(to right, transparent 0%, #000 24%, #000 100%);
}
.fa-hero-art::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to bottom, var(--paper) 0%, transparent 18%, transparent 82%, var(--paper) 100%),
    linear-gradient(to right, var(--paper) 0%, transparent 42%);
  pointer-events: none;
}
.fa-hero-art img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 58% 55%;
  opacity: .72;
  filter: saturate(.78) contrast(.98);
}
.fa-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: clamp(20px, 3vw, 34px);
  width: min(580px, 100%);
  margin: 25px 0 0;
  border: 0;
  color: var(--ink);
  background: none;
}
.fa-stat {
  min-width: 0;
  padding: 0;
}
.fa-stat-val { font-size: 29px; color: var(--ink); }
.fa-stat:last-child .fa-stat-val { color: var(--accent); }
.fa-stat-label { margin-top: 4px; color: var(--ink-3); font-size: 8px; font-weight: 600; letter-spacing: .08em; }
.fa-stat--this-week .fa-stat-val { color: var(--accent); }
.fa-stat--no-openings .fa-stat-val,
.fa-stat--no-openings .fa-stat-label { color: var(--ink); }

.fa-search-band {
  position: relative;
  padding: 18px var(--pad);
  background: var(--paper);
  border-bottom: 1px solid var(--rule-2);
}
.fa-search-box {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  width: min(980px, 100%);
  margin: 0 auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid #b9bec0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(21, 38, 49, .08);
}
.fa-search-box > span { padding-left: 18px; color: var(--ocean); font-size: 22px; }
.fa-search-box .fa-input { border: 0; padding: 16px 13px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; }
.fa-search-box > button {
  align-self: stretch;
  border: 0;
  padding: 0 25px;
  color: #fff;
  background: var(--accent);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  cursor: pointer;
}
.fa-search-box > button:hover { background: var(--accent-2); }
.fa-search-meta {
  display: flex;
  justify-content: space-between;
  width: min(980px, 100%);
  margin: 8px auto 0;
  color: var(--ink-4);
  font-family: var(--font-mono);
  font-size: 9px;
}
.fa-search-meta a { color: var(--ocean); text-decoration: none; }
.fa-search-meta a:hover { color: var(--accent); }
.fa-load-error { max-width: 980px; margin: 8px auto 0; color: var(--accent); font-family: var(--font-mono); font-size: 10px; }

.fa-catalog-shell {
  display: grid;
  grid-template-columns: 235px minmax(460px, 1fr) minmax(260px, 320px);
  align-items: start;
  min-height: 660px;
  scroll-margin-top: 72px;
}
.fa-catalog-shell.is-map-hidden { grid-template-columns: 235px minmax(460px, 1fr); }
.fa-catalog-shell.is-filters-hidden { grid-template-columns: minmax(460px, 1fr) minmax(260px, 320px); }
.fa-catalog-shell.is-map-hidden.is-filters-hidden { grid-template-columns: minmax(460px, 1fr); }
.fa-catalog-shell.is-filters-hidden .fa-results-toolbar > div:first-child { margin-left: 36px; }
.fa-filters-col {
  position: sticky;
  top: 72px;
  max-height: calc(100vh - 72px);
  overflow-y: auto;
  padding: 22px 20px 36px 26px;
  border: 0;
  border-right: 1px solid var(--rule-2);
  background: var(--paper-2);
  scrollbar-width: thin;
}
.fa-filters-col .fa-sidebar-inner > .fa-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px !important;
  padding-bottom: 12px !important;
  border-bottom-color: var(--rule-2) !important;
  color: var(--ink);
  font-weight: 600;
}
.fa-filters-col .fa-display { font-family: var(--font-mono); font-size: 10px !important; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; }
.fa-filters-col .fa-sidebar-inner > div { margin-bottom: 18px !important; }
.fa-filters-col .fa-input { padding: 6px 0; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px !important; }
.fa-filters-col .fa-facet-item { gap: 8px; padding: 3px 0; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px; }
.fa-filters-col .fa-check { width: 14px; height: 14px; border-radius: 3px; }
.fa-filters-col .fa-check.checked { border-color: var(--ocean); background: var(--ocean); }
.fa-filters-col .fa-meta { font-size: 9px !important; }
.fa-filters-col .fa-btn { height: auto; min-height: 30px; padding: 7px 9px; border-color: var(--rule-2); font-size: 9px; letter-spacing: .04em; }

.fa-results-col { min-width: 0; padding: 22px 26px 36px; background: var(--paper); }
.fa-results-col .active-filters { margin: 0 0 14px; }
.fa-results-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  margin: 0;
  padding: 0 0 15px;
  border-bottom: 2px solid var(--ink);
}
.fa-results-toolbar h2 { margin: 0; font-size: 25px; line-height: 1; }
.fa-results-toolbar > div > span { display: block; margin-top: 5px; color: var(--ink-4); font-family: var(--font-mono); font-size: 9px; }
.fa-toolbar-actions { display: flex; align-items: center; gap: 10px; }
.fa-toolbar-actions select {
  max-width: 130px;
  border: 0;
  outline: 0;
  color: var(--ocean);
  background: transparent;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  cursor: pointer;
}
.fa-tool-button {
  appearance: none;
  border: 0;
  padding: 0;
  color: var(--ocean);
  background: transparent;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  cursor: pointer;
}
.fa-tool-button:hover { color: var(--accent); }
.fa-filters-toggle { display: none; }
.fa-job-list { border-top: 0; }
.fa-empty-state { padding: 56px 20px; text-align: center; }
.fa-empty-state p { margin: 0 0 12px; color: var(--ink-3); font-size: 28px; }
.fa-empty-state span { color: var(--ink-4); font-family: var(--font-mono); font-size: 10px; }

.fa-listing {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: stretch;
  padding: 18px 2px;
  border-bottom: 1px solid var(--rule-2);
  transition: background .15s;
}
.fa-listing:hover { background: rgba(18, 38, 58, .025); }
.fa-listing-main { min-width: 0; }
.fa-listing-title {
  display: inline;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 20px;
  line-height: 1.12;
  text-decoration: none;
}
a.fa-listing-title:hover { color: var(--accent); }
.fa-listing-inst { margin-top: 5px; color: var(--ink-2); font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px; font-style: normal; }
.fa-listing-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
.fa-listing .fa-tag {
  border: 0;
  border-radius: 999px;
  padding: 4px 8px;
  color: #4f6874;
  background: #edf2f3;
  font-size: 8px;
  font-weight: 600;
  letter-spacing: .05em;
  cursor: default;
}
.fa-listing .fa-tag-accent { color: #a94422; background: #f8e9e1; }
.fa-listing .fa-tag-closed { color: #fff; background: var(--ink-3); }
.fa-listing-side { display: flex; min-width: 88px; flex-direction: column; align-items: flex-end; color: var(--ink-4); font-family: var(--font-mono); }
.fa-save-button { appearance: none; margin-bottom: auto; border: 0; padding: 0; color: var(--ink-4); background: transparent; font-size: 21px; line-height: 1; cursor: pointer; }
.fa-save-button:hover,
.fa-save-button.saved { color: var(--accent); }
.fa-listing-date { margin-top: 16px; font-size: 9px; }
.fa-listing-deadline { margin-top: 5px; font-size: 8px; text-align: right; }
.fa-show-more { padding: 26px 0; }

.fa-map-rail {
  position: sticky;
  top: 72px;
  height: calc(100vh - 72px);
  min-height: 590px;
  overflow: hidden;
  border-left: 1px solid var(--rule-2);
  background: var(--paper-3);
}
.fa-map-rail-head {
  position: absolute;
  z-index: 700;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 16px 17px 12px;
  color: var(--ink);
  background: linear-gradient(var(--paper-3), rgba(223, 231, 231, .84), transparent);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: .07em;
  text-transform: uppercase;
}
.fa-map-rail-actions { display: flex; align-items: center; gap: 12px; }
.fa-map-rail-head button { border: 0; padding: 0; color: var(--ocean); background: transparent; font-family: inherit; font-size: 9px; text-transform: uppercase; cursor: pointer; }
.fa-map-rail-head button:hover { color: var(--accent); }
.fa-map-rail .map-panel { height: 100% !important; padding: 0; border: 0; border-radius: 0; box-shadow: none; background: transparent; }
.fa-map-rail .map-top-row,
.fa-map-rail .map-note { display: none; }
.fa-map-rail .leaflet-map-wrap,
.fa-map-rail .leaflet-map { min-height: 100%; height: 100%; }
.fa-map-rail .map-legend { display: none; }
.fa-map-summary {
  position: absolute;
  z-index: 700;
  left: 16px;
  right: 16px;
  bottom: 18px;
  padding: 13px 14px;
  border: 1px solid rgba(18, 38, 58, .12);
  border-radius: 7px;
  background: rgba(255, 254, 250, .94);
  box-shadow: 0 8px 24px rgba(25, 43, 53, .12);
}
.fa-map-summary strong { display: block; font-size: 16px; font-weight: 400; }
.fa-map-summary span { display: block; margin-top: 4px; color: var(--ink-3); font-size: 10px; }

.fa-map-page { padding: 36px var(--pad) 54px; background: var(--paper); }
.fa-map-page-head { display: flex; justify-content: space-between; align-items: end; margin-bottom: 22px; }
.fa-map-page-head h2 { margin: 5px 0 0; font-size: 45px; }
.fa-map-page-grid { display: block; }
.fa-map-page-grid > .map-panel { min-height: 620px; padding: 0; overflow: hidden; border: 1px solid var(--rule-2); border-radius: 0; box-shadow: none; }
.fa-map-page-grid .leaflet-map-wrap { height: clamp(560px, 68vh, 680px); min-height: 560px; }

.fa-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin: 0;
  padding: 13px var(--pad);
  border: 0;
  border-top: 1px solid var(--rule-2);
  color: var(--ink-3);
  background: var(--paper-2);
  font-family: var(--font-mono);
  font-size: 9px;
}
.fa-footer strong { color: var(--accent-2); }
.fa-footer button,
.fa-footer a { border: 0; color: var(--ink-2); background: transparent; font: inherit; text-decoration: none; cursor: pointer; }
.fa-footer > div:last-child { display: flex; gap: 18px; }
.fa-footer button:hover,
.fa-footer a:hover { color: var(--accent); }

@media (max-width: 1120px) {
  .fa-catalog-shell { grid-template-columns: 220px minmax(420px, 1fr); }
  .fa-catalog-shell.is-filters-hidden,
  .fa-catalog-shell.is-map-hidden.is-filters-hidden { grid-template-columns: minmax(420px, 1fr); }
  .fa-map-rail { display: none; }
  .fa-map-divider-toggle { display: none; }
  .fa-hero h1 { font-size: 56px; }
  .fa-hero { grid-template-columns: minmax(0, 1fr) minmax(350px, .82fr); gap: 30px; }
}

@media (max-width: 767px) {
  :root { --pad: 18px; }
  .fa-header { grid-template-columns: 1fr auto; min-height: 64px; padding: 0 var(--pad); }
  .fa-header .fa-wordmark .fa-display { font-size: 23px; }
  .fa-header .fa-wordmark svg { width: 34px; height: 34px; }
  .fa-nav { display: none; }
  .fa-saved-button { padding: 7px 10px; }
  .fa-hero { grid-template-columns: 1fr; gap: 24px; padding: 28px var(--pad) 26px; }
  .fa-hero h1 { font-size: clamp(39px, 11.5vw, 54px); }
  .fa-hero-copy p { font-size: 15px; }
  .fa-hero-visual { min-height: 150px; }
  .fa-hero-art {
    inset: -22px calc(-1 * var(--pad)) -26px calc(-1 * var(--pad));
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 22%, #000 80%, transparent 100%);
    mask-image: linear-gradient(to bottom, transparent 0%, #000 22%, #000 80%, transparent 100%);
  }
  .fa-hero-art::after { background: linear-gradient(to right, rgba(245, 239, 226, .42), transparent 55%); }
  .fa-hero-art img { object-position: 55% 56%; opacity: .62; }
  .fa-stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 21px; }
  .fa-stat { min-width: 0; }
  .fa-stat-val { font-size: clamp(22px, 6vw, 26px); }
  .fa-search-band { padding: 14px var(--pad); }
  .fa-search-box > span { padding-left: 13px; }
  .fa-search-box .fa-input { min-width: 0; padding: 14px 9px; font-size: 13px; }
  .fa-search-box > button { padding: 0 14px; }
  .fa-catalog-shell { display: block; scroll-margin-top: 64px; }
  .fa-filter-divider-toggle { display: none; }
  .fa-filters-col {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 200;
    max-height: none;
    padding: 20px var(--pad) 40px;
    border: 0;
    background: var(--paper-2);
  }
  .fa-filters-col.is-open { display: block; }
  .fa-drawer-header { display: flex; }
  .fa-drawer-backdrop { display: block; }
  .fa-results-col { padding: 20px var(--pad) 32px; }
  .fa-results-toolbar { align-items: flex-start; }
  .fa-results-toolbar h2 { font-size: 22px; }
  .fa-results-toolbar > div > span { max-width: 175px; }
  .fa-toolbar-actions { gap: 9px; flex-wrap: wrap; justify-content: flex-end; }
  .fa-tool-button.fa-filters-toggle { display: inline-block; }
  .fa-toolbar-actions select { max-width: 86px; }
  .fa-listing { padding: 17px 0; }
  .fa-listing > .fa-listing-main {
    display: block;
    grid-column: 1;
    grid-row: 1;
  }
  .fa-listing > .fa-listing-side {
    display: flex;
    grid-column: 2;
    grid-row: 1;
  }
  .fa-listing-title { font-size: 19px; }
  .fa-listing-side { min-width: 64px; }
  .fa-listing-deadline { display: none; }
  .fa-map-page { padding: 28px var(--pad); }
  .fa-map-page-head { align-items: flex-start; gap: 18px; }
  .fa-map-page-head h2 { font-size: 32px; }
  .fa-map-page-grid > .map-panel { min-height: 480px; }
  .fa-map-page-grid .leaflet-map-wrap { height: clamp(420px, 60vh, 520px); min-height: 420px; }
  .fa-footer { align-items: flex-start; padding: 13px var(--pad); }
  .fa-footer > div:last-child { display: none; }
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

.map-status {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.map-overlay-actions {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 700;
  display: flex;
  gap: 4px;
  width: auto;
  padding: 4px;
  border: 1px solid rgba(18, 38, 58, 0.14);
  border-radius: 8px;
  background: rgba(255, 254, 250, 0.94);
  box-shadow: 0 5px 16px rgba(25, 43, 53, 0.14);
  backdrop-filter: blur(6px);
}
.map-overlay-actions button {
  flex: 0 0 auto;
  min-width: 30px;
  min-height: 30px;
  padding: 3px 8px;
  border: 1px solid var(--rule-2);
  border-radius: 5px;
  color: var(--ink);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.map-overlay-actions button:hover { background: rgba(18, 38, 58, 0.06); }
.map-overlay-actions button:disabled { opacity: 0.45; cursor: not-allowed; }

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
