<script setup>
import { onMounted, ref } from 'vue'
import FilterBar from './components/FilterBar.vue'
import PresetBar from './components/PresetBar.vue'
import ActiveChips from './components/ActiveChips.vue'
import JobCard from './components/JobCard.vue'
import MapPanel from './components/MapPanel.vue'
import { useSavedJobs } from './composables/useSavedJobs'
import { usePresets } from './composables/usePresets'
import { useJobFilters } from './composables/useJobFilters'
import { useJobsData } from './composables/useJobsData'
import { useAlerts } from './composables/useAlerts'
import { ALL_FILTER_VALUE, createDefaultFilters } from './config/appConfig'
import TrendsTab from './components/TrendsTab.vue'

const DENSITY_STORAGE_KEY = 'facultyJobs.cardDensity.v1'
const REPORT_ISSUE_URL = import.meta.env.VITE_REPORT_ISSUE_URL || ''
const baseUrl = import.meta.env.BASE_URL || '/'
const logoSrc = `${baseUrl}assets/logos/favicon.svg`
const policyExclusionsHref = `${baseUrl}policy-exclusions.html`
const inclusionCriteriaHref = `${baseUrl}inclusion-criteria.html`
const { jobs, status, scrapedAt, loadError, loadJobs, qualitySummary, newJobsCount, transport, lastVisitAt } = useJobsData()
const siteViews = ref(null)
onMounted(async () => {
  try {
    const res = await fetch(`${baseUrl}traffic.json`)
    if (res.ok) {
      const d = await res.json()
      siteViews.value = d.views14d ?? null
    }
  } catch {
    // traffic data unavailable
  }
})
const hoveredCollege = ref(null)
const density = ref('comfortable')
const reportStatus = ref('')
const activeTab = ref('jobs')

const filters = ref(createDefaultFilters())
const { savedJobs, isSavedJob, toggleSavedJob } = useSavedJobs()
const { stateOptions, positionTypeOptions, collegeOptions, departmentOptions, cityOptions, filteredJobs, activeFilterChips, updateFilters, clearFilterChip, resetFilters, countMatches } =
  useJobFilters({
    jobsRef: jobs,
    filtersRef: filters,
    isSavedJob,
  })
const { presetItems, saveCurrentPreset, applyPreset, removePreset } = usePresets({
  filtersRef: filters,
  updateFilters,
})
const { alertsWithCounts, addAlert, removeAlert } = useAlerts({
  filtersRef: filters,
  countMatches,
})

function handleMapCollegeSelect(college) {
  if (!college) updateFilters({ college: ALL_FILTER_VALUE })
  else updateFilters({ college })
}

function handleHoverCollege(college) {
  hoveredCollege.value = college || null
}

function setDensity(nextDensity) {
  density.value = nextDensity === 'compact' ? 'compact' : 'comfortable'
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, density.value)
  } catch (_err) {
    // Ignore storage errors in restricted browser modes.
  }
}

function buildReportPayload(job) {
  return {
    reportedAt: new Date().toISOString(),
    reason: 'Broken/outdated listing',
    job: {
      canonicalJobId: job?.canonicalJobId || null,
      canonicalGroupId: job?.canonicalGroupId || null,
      title: job?.title || null,
      url: job?.url || null,
      college: job?.college || null,
      source: job?.source || null,
      state: job?.state || null,
      department: job?.department || null,
    },
    appContext: {
      scrapedAt: scrapedAt.value || null,
      pageUrl: typeof window !== 'undefined' ? window.location.href : null,
    },
  }
}

async function copyToClipboard(text) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function downloadReportFile(fileName, content) {
  if (typeof document === 'undefined') return
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

let _reportStatusTimer = null

async function reportBadListing(job) {
  const payload = buildReportPayload(job)
  const serialized = JSON.stringify(payload, null, 2)
  const copied = await copyToClipboard(serialized)

  if (REPORT_ISSUE_URL) {
    const title = encodeURIComponent(`[Bad listing] ${job?.title || 'Faculty listing'}`)
    const body = encodeURIComponent(
      `Please review this listing report payload:\\n\\n\`\`\`json\\n${serialized}\\n\`\`\``,
    )
    const separator = REPORT_ISSUE_URL.includes('?') ? '&' : '?'
    window.open(`${REPORT_ISSUE_URL}${separator}title=${title}&body=${body}`, '_blank', 'noopener,noreferrer')
  } else {
    const id = String(job?.canonicalJobId || 'listing').replace(/[^a-zA-Z0-9_-]+/g, '_')
    downloadReportFile(`bad-listing-${id}.json`, serialized)
  }

  reportStatus.value = copied
    ? 'Report payload copied to clipboard and issue flow opened.'
    : 'Report payload prepared. A JSON file was downloaded.'

  clearTimeout(_reportStatusTimer)
  _reportStatusTimer = setTimeout(() => {
    reportStatus.value = ''
  }, 5000)
}

onMounted(() => {
  try {
    const saved = localStorage.getItem(DENSITY_STORAGE_KEY)
    if (saved === 'compact' || saved === 'comfortable') {
      density.value = saved
    }
  } catch (_err) {
    // Ignore storage errors in restricted browser modes.
  }
})
</script>

<template>
  <main class="page" :class="`density-${density}`">
    <header class="hero panel">
      <div class="brand-block">
        <div class="logo">
          <span class="logo-icon">
            <img :src="logoSrc" alt="Faculty Atlas icon" />
          </span>
          <div class="logo-wordmark" aria-label="Faculty Atlas">
            <span class="logo-faculty">Faculty</span>
            <span class="logo-atlas">Atlas</span>
          </div>
          <p class="subtitle">Find your future faculty job.</p>
        </div>
        <p class="tagline">A focused search experience designed for professional academic hiring workflows.</p>
        <p class="meta-links">
          <a :href="policyExclusionsHref">Data policy exclusions</a>
          <span aria-hidden="true"> · </span>
          <a :href="inclusionCriteriaHref">Inclusion criteria</a>
        </p>
        <section class="trust-panel">
          <article class="trust-card">
            <span>Freshness</span>
            <strong>{{ qualitySummary.freshness }}</strong>
          </article>
          <article class="trust-card">
            <span>URL Integrity</span>
            <strong>{{ qualitySummary.secureUrlPct }}% HTTPS</strong>
          </article>
          <article class="trust-card">
            <span>Metadata Coverage</span>
            <strong>{{ qualitySummary.withDescriptionPct }}% described · {{ qualitySummary.withDepartmentPct }}% tagged</strong>
          </article>
          <article class="trust-card">
            <span>Coverage</span>
            <strong>{{ qualitySummary.uniqueColleges.toLocaleString() }} schools · {{ qualitySummary.total.toLocaleString() }} grouped roles</strong>
          </article>
        </section>
        <p v-if="qualitySummary.topSources.length" class="muted">
          Top sources:
          <span v-for="entry in qualitySummary.topSources" :key="entry.source">
            {{ entry.source }} ({{ entry.count.toLocaleString() }})&nbsp;
          </span>
        </p>
      </div>
      <div class="hero-metrics">
        <p class="status-pill">{{ status }}</p>
        <p v-if="scrapedAt" class="muted">Last scrape: {{ new Date(scrapedAt).toLocaleString() }}</p>
        <p class="muted">Last visit: {{ lastVisitAt ? new Date(lastVisitAt).toLocaleString() : 'First visit' }}</p>
        <p class="muted">Data transport: {{ transport }}</p>
        <div class="metrics-row">
          <article class="metric-card">
            <span>Visible Jobs</span>
            <strong>{{ filteredJobs.length.toLocaleString() }}</strong>
          </article>
          <article class="metric-card">
            <span>Saved Jobs</span>
            <strong>{{ savedJobs.size }}</strong>
          </article>
          <article class="metric-card">
            <span>New Since Visit</span>
            <strong>{{ newJobsCount.toLocaleString() }}</strong>
          </article>
          <article v-if="siteViews !== null" class="metric-card">
            <span>Site Views (14d)</span>
            <strong>{{ siteViews.toLocaleString() }}</strong>
          </article>
        </div>
      </div>
      <p v-if="loadError" class="error">{{ loadError }}</p>
      <p v-if="reportStatus" class="muted">{{ reportStatus }}</p>
    </header>

    <nav class="tab-bar" aria-label="Main navigation">
      <button
        type="button"
        :class="['tab-btn', { active: activeTab === 'jobs' }]"
        aria-controls="panel-jobs"
        :aria-selected="activeTab === 'jobs'"
        role="tab"
        @click="activeTab = 'jobs'"
      >Browse Jobs</button>
      <button
        type="button"
        :class="['tab-btn', { active: activeTab === 'trends' }]"
        aria-controls="panel-trends"
        :aria-selected="activeTab === 'trends'"
        role="tab"
        @click="activeTab = 'trends'"
      >Weekly Trends</button>
    </nav>

    <TrendsTab v-if="activeTab === 'trends'" :base-url="baseUrl" />

    <template v-if="activeTab === 'jobs'">
    <section class="search-map-layout">
      <aside class="panel control-deck">
        <h2 class="section-title">Refine Search</h2>
        <section class="filters">
          <FilterBar
            :filters="filters"
            :state-options="stateOptions"
            :position-type-options="positionTypeOptions"
            :college-options="collegeOptions"
            :department-options="departmentOptions"
            :city-options="cityOptions"
            @update:filters="updateFilters"
            @reset-filters="resetFilters"
            @refresh-data="loadJobs"
            @save-alert="addAlert"
          />
        </section>
        <PresetBar
          class="presets"
          :items="presetItems"
          @save-current="saveCurrentPreset"
          @apply-preset="applyPreset"
          @remove-preset="removePreset"
        />
        <ActiveChips :chips="activeFilterChips" @clear-chip="clearFilterChip" />
        <section class="alert-panel">
          <h3>Saved Alerts</h3>
          <p v-if="alertsWithCounts.length === 0" class="muted">No alerts yet.</p>
          <div v-else class="alert-list">
            <article v-for="item in alertsWithCounts" :key="item.id" class="alert-item">
              <strong>{{ item.label }}</strong>
              <span>{{ item.matchCount.toLocaleString() }} matches</span>
              <button type="button" :aria-label="`Remove alert: ${item.label}`" @click="removeAlert(item.id)">Remove</button>
            </article>
          </div>
        </section>
      </aside>

      <MapPanel
        class="map-stage"
        :jobs="filteredJobs"
        :selected-college="filters.college !== ALL_FILTER_VALUE ? filters.college : null"
        :hovered-college="hoveredCollege"
        @select-college="handleMapCollegeSelect"
        @hover-college="handleHoverCollege"
      />
    </section>

    <section class="grid">
      <JobCard
        v-for="job in filteredJobs"
        :key="job.canonicalGroupId || job.canonicalJobId || `${job.url}-${job.title}`"
        :job="job"
        :saved="isSavedJob(job.url)"
        :emphasized="Boolean(hoveredCollege) && job.college === hoveredCollege"
        @toggle-save="toggleSavedJob"
        @hover-college="handleHoverCollege"
        @report-bad-listing="reportBadListing"
      />
    </section>
    </template>
  </main>
</template>
