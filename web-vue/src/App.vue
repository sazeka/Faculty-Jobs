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
import { ALL_FILTER_VALUE, createDefaultFilters } from './config/appConfig'

const REPORT_ISSUE_URL = import.meta.env.VITE_REPORT_ISSUE_URL || ''
const baseUrl = import.meta.env.BASE_URL || '/'

const { jobs, scrapedAt, loadError, loadJobs, qualitySummary, newJobsCount } = useJobsData()

const filters = ref(createDefaultFilters())
const { savedJobs, isSavedJob, toggleSavedJob } = useSavedJobs()
const { stateOptions, positionTypeOptions, disciplineOptions, collegeOptions, departmentOptions, cityOptions, filteredJobs, activeFilterChips, updateFilters, clearFilterChip, resetFilters, countMatches } =
  useJobFilters({ jobsRef: jobs, filtersRef: filters, isSavedJob })
const { presetItems, saveCurrentPreset, applyPreset, removePreset } = usePresets({ filtersRef: filters, updateFilters })
const { alertsWithCounts, addAlert, removeAlert } = useAlerts({ filtersRef: filters, countMatches })

const hoveredCollege = ref(null)
const activeTab = ref('jobs')
const showAllJobs = ref(false)
const siteViews = ref(null)

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

onMounted(async () => {
  try {
    const res = await fetch(`${baseUrl}traffic.json`)
    if (res.ok) {
      const d = await res.json()
      siteViews.value = d.views14d ?? null
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
            v-for="t in ['Jobs', 'Map', 'Trends']"
            :key="t"
            class="fa-meta fa-nav-link"
            :class="{ active: activeTab === t.toLowerCase() }"
            @click="activeTab = t.toLowerCase()"
          >{{ t }}</button>
          <a href="https://github.com/sazeka/Faculty-Jobs" target="_blank" rel="noreferrer"
            class="fa-meta fa-nav-link">GitHub</a>
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
          <span><b style="font-weight: 600; color: var(--ink);">{{ qualitySummary.total.toLocaleString() }}</b> posts</span>
          <span><b style="font-weight: 600; color: var(--ink);">{{ qualitySummary.uniqueColleges.toLocaleString() }}</b> institutions</span>
          <span><b style="font-weight: 600; color: var(--ink);">{{ stateCount }}</b> state systems</span>
          <span v-if="siteViews !== null"><b style="font-weight: 600; color: var(--ink);">{{ siteViews.toLocaleString() }}</b> views / 14d</span>
        </div>
      </div>
    </header>

    <!-- ═══ HERO ═══ -->
    <section class="fa-hero">
      <div class="fa-hero-left">
        <div class="fa-label" style="margin-bottom: 24px;">The Atlas · {{ todayStr }}</div>
        <h1 class="fa-display fa-hero-headline">
          Every<br />
          <i style="color: var(--accent);">open position</i><br />
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
            <div class="fa-stat-val">{{ qualitySummary.total.toLocaleString() }}</div>
            <div class="fa-stat-label">open posts today</div>
          </div>
          <div class="fa-stat">
            <div class="fa-stat-val">{{ qualitySummary.uniqueColleges.toLocaleString() }}</div>
            <div class="fa-stat-label">institutions tracked</div>
          </div>
          <div class="fa-stat">
            <div class="fa-stat-val" style="color: var(--accent);">+{{ newJobsCount.toLocaleString() }}</div>
            <div class="fa-stat-label">new since last visit</div>
          </div>
          <div class="fa-stat">
            <div class="fa-stat-val">{{ stateCount }}</div>
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

      <!-- Site viewers -->
      <div v-if="siteViews !== null" class="fa-meta fa-hero-coords" style="text-align: right;">
        <div class="fa-display" style="font-size: 36px; line-height: 1;">{{ siteViews.toLocaleString() }}</div>
        <div style="margin-top: 4px; letter-spacing: 0.1em; text-transform: uppercase; font-size: 9px;">visitors · 14 days</div>
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
    <TrendsTab v-if="activeTab === 'trends'" :base-url="baseUrl" style="padding: 56px var(--pad);" />

    <!-- ═══ MAP TAB ═══ -->
    <template v-if="activeTab === 'map'">
      <section class="fa-section">
        <div class="fa-section-head">
          <div>
            <div class="fa-label">§ III</div>
            <h2 class="fa-display" style="font-size: 48px; margin: 4px 0 0;">By <i>geography</i></h2>
          </div>
          <button class="fa-meta fa-link" style="background: none; border: none; cursor: pointer;" @click="activeTab = 'jobs'">← Back to catalog</button>
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
      <section class="fa-section">
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
            <button class="fa-meta fa-link" style="background: none; border: none; cursor: pointer;" @click="activeTab = 'map'">Map view →</button>
          </div>
        </div>

        <!-- Active chips -->
        <ActiveChips v-if="activeFilterChips.length" :chips="activeFilterChips" style="margin-bottom: 20px;" @clear-chip="clearFilterChip" />

        <div class="fa-catalog-layout">
          <!-- Sidebar -->
          <aside class="fa-filters-col">
            <FilterBar
              :filters="filters"
              :state-options="stateOptions"
              :position-type-options="positionTypeOptions"
              :discipline-options="disciplineOptions"
              :college-options="collegeOptions"
              :department-options="departmentOptions"
              :city-options="cityOptions"
              @update:filters="updateFilters"
              @reset-filters="resetFilters"
              @save-alert="addAlert"
              @refresh-data="loadJobs"
            />
          </aside>

          <!-- Results -->
          <div class="fa-results-col">
            <!-- Toolbar -->
            <div class="fa-results-toolbar">
              <div class="fa-meta">
                <b style="color: var(--ink);">{{ filteredJobs.length.toLocaleString() }}</b> postings
              </div>
              <div style="display: flex; gap: 16px; align-items: center;">
                <select
                  class="fa-meta"
                  style="background: none; border: none; cursor: pointer; color: var(--ink); font-family: var(--font-mono);"
                  :value="filters.sortBy"
                  @change="updateFilters({ sortBy: $event.target.value })"
                >
                  <option value="relevance">Sort: Relevance</option>
                  <option value="title-asc">Sort: Title A–Z</option>
                  <option value="university">Sort: University</option>
                  <option value="state">Sort: State</option>
                </select>
              </div>
            </div>

            <!-- Listing rows -->
            <div v-if="filteredJobs.length === 0" style="padding: 48px 0; text-align: center;">
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
        <div v-for="col in [
          { h: 'Browse', l: ['By state', 'By institution', 'Tenure-track only', 'New postings'] },
          { h: 'About', l: ['Methodology', 'Data sources', 'Coverage', 'GitHub'] },
        ]" :key="col.h">
          <div class="fa-label" style="margin-bottom: 16px;">{{ col.h }}</div>
          <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px;">
            <li v-for="li in col.l" :key="li">
              <span style="font-family: var(--font-body); font-size: 14px; color: var(--ink-2);">{{ li }}</span>
            </li>
          </ul>
        </div>
      </div>
      <div class="fa-footer-bottom">
        <div class="fa-meta">Faculty Atlas · An independent academic directory</div>
        <div v-if="siteViews !== null" class="fa-meta">{{ siteViews.toLocaleString() }} visitors · 14d</div>
      </div>
    </footer>

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
.fa-hero-right { padding-bottom: 8px; }
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

/* ─── Map override ─── */
.fa-map-container .map-panel,
.fa-map-container section { height: 100% !important; }
.fa-map-container .leaflet-map { height: 100% !important; min-height: 320px; }
.fa-map-container .map-top-row,
.fa-map-container .map-note { display: none; }
</style>
