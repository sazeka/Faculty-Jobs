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
import { ALL_FILTER_VALUE, createDefaultFilters } from './config/appConfig'

const DENSITY_STORAGE_KEY = 'facultyJobs.cardDensity.v1'
const baseUrl = import.meta.env.BASE_URL || '/'
const logoSrc = `${baseUrl}assets/logos/favicon.svg`
const policyExclusionsHref = `${baseUrl}policy-exclusions.html`
const inclusionCriteriaHref = `${baseUrl}inclusion-criteria.html`
const { jobs, status, scrapedAt, loadError, loadJobs } = useJobsData()
const hoveredCollege = ref(null)
const density = ref('comfortable')

const filters = ref(createDefaultFilters())
const { savedJobs, isSavedJob, toggleSavedJob } = useSavedJobs()
const { stateOptions, positionTypeOptions, collegeOptions, filteredJobs, activeFilterChips, updateFilters, clearFilterChip, resetFilters } =
  useJobFilters({
    jobsRef: jobs,
    filtersRef: filters,
    isSavedJob,
  })
const { presetItems, saveCurrentPreset, applyPreset, removePreset } = usePresets({
  filtersRef: filters,
  updateFilters,
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
      </div>
      <div class="hero-metrics">
        <p class="status-pill">{{ status }}</p>
        <p v-if="scrapedAt" class="muted">Last scrape: {{ new Date(scrapedAt).toLocaleString() }}</p>
        <div class="metrics-row">
          <article class="metric-card">
            <span>Visible Jobs</span>
            <strong>{{ filteredJobs.length.toLocaleString() }}</strong>
          </article>
          <article class="metric-card">
            <span>Saved Jobs</span>
            <strong>{{ savedJobs.size }}</strong>
          </article>
        </div>
      </div>
      <p v-if="loadError" class="error">{{ loadError }}</p>
    </header>

    <section class="search-map-layout">
      <aside class="panel control-deck">
        <h2 class="section-title">Refine Search</h2>
        <section class="filters">
          <FilterBar
            :filters="filters"
            :state-options="stateOptions"
            :position-type-options="positionTypeOptions"
            :college-options="collegeOptions"
            @update:filters="updateFilters"
            @reset-filters="resetFilters"
            @refresh-data="loadJobs"
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
        :key="`${job.url}-${job.title}`"
        :job="job"
        :saved="isSavedJob(job.url)"
        :emphasized="Boolean(hoveredCollege) && job.college === hoveredCollege"
        @toggle-save="toggleSavedJob"
        @hover-college="handleHoverCollege"
      />
    </section>
  </main>
</template>
