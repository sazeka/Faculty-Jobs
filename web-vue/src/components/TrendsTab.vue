<script setup>
import { ref, onMounted, computed } from 'vue'

const props = defineProps({
  baseUrl: { type: String, default: '/' },
})

const trends = ref(null)
const loading = ref(true)
const error = ref(null)

onMounted(async () => {
  try {
    const res = await fetch(`${props.baseUrl}data/weekly-trends.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    trends.value = await res.json()
  } catch {
    error.value = 'Weekly trends data is not yet available — check back after the next Sunday run.'
  } finally {
    loading.value = false
  }
})

const historyBars = computed(() => {
  const items = trends.value?.history?.slice(-12) || []
  if (!items.length) return []
  const max = Math.max(...items.map((h) => h.totalJobs))
  return items.map((h) => ({
    weekEnd: h.weekEnd,
    totalJobs: h.totalJobs,
    heightPct: max > 0 ? Math.round((h.totalJobs / max) * 100) : 0,
  }))
})

const sortedPositionTypes = computed(() => {
  const types = trends.value?.stats?.positionTypeBreakdown || {}
  return Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }))
})

const totalFromTypes = computed(() =>
  sortedPositionTypes.value.reduce((s, t) => s + t.count, 0)
)

function fmt(n) { return Number(n).toLocaleString() }
function fmtWeek(s) {
  return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function deltaClass(n) { return n > 0 ? 'delta-up' : n < 0 ? 'delta-down' : '' }
function deltaLabel(n) { return n == null ? '' : (n >= 0 ? `+${fmt(n)}` : fmt(n)) }
</script>

<template>
  <section class="trends-tab">
    <!-- Loading -->
    <div v-if="loading" class="trends-loading">
      <p class="muted">Loading weekly trends...</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="trends-error panel">
      <p class="muted">{{ error }}</p>
    </div>

    <!-- Content -->
    <template v-else-if="trends">
      <!-- Header row -->
      <div class="trends-header panel">
        <div class="trends-meta">
          <p class="eyebrow">Weekly Digest</p>
          <h2 class="trends-title">Faculty Hiring Trends</h2>
          <p class="muted trends-date">Week ending {{ fmtWeek(trends.weekEnd) }}</p>
        </div>
        <div class="trends-totals">
          <div class="trends-total-card">
            <span>Total Listings</span>
            <strong>{{ fmt(trends.stats.totalJobs) }}</strong>
            <span
              v-if="trends.stats.totalDelta != null"
              :class="['trends-delta', deltaClass(trends.stats.totalDelta)]"
            >
              {{ deltaLabel(trends.stats.totalDelta) }} vs last week
            </span>
          </div>
        </div>
      </div>

      <!-- AI Narrative -->
      <article class="trends-narrative panel">
        <p class="eyebrow">This Week's Summary</p>
        <div class="trends-prose">
          <p v-for="(para, i) in trends.aiSummary.split('\n\n').filter(p => p.trim())" :key="i">
            {{ para }}
          </p>
        </div>
        <p class="trends-generated-note muted">Generated {{ new Date(trends.generatedAt).toLocaleString() }}</p>
      </article>

      <!-- Two-column stats -->
      <div class="trends-stats-grid">

        <!-- Top sources -->
        <div class="panel trends-stat-panel">
          <p class="eyebrow">Top States / Systems</p>
          <ul class="trends-bar-list" aria-label="Top sources by job count">
            <li v-for="s in trends.stats.topSources.slice(0, 8)" :key="s.source" class="trends-bar-item">
              <span class="trends-bar-label">{{ s.source }}</span>
              <div class="trends-bar-track">
                <div
                  class="trends-bar-fill"
                  :style="{ width: `${Math.round((s.count / trends.stats.topSources[0].count) * 100)}%` }"
                  :aria-label="`${s.count} jobs`"
                ></div>
              </div>
              <span class="trends-bar-count">{{ fmt(s.count) }}</span>
            </li>
          </ul>
        </div>

        <!-- Position type breakdown -->
        <div class="panel trends-stat-panel">
          <p class="eyebrow">Position Types</p>
          <ul class="trends-bar-list" aria-label="Position type breakdown">
            <li v-for="t in sortedPositionTypes" :key="t.label" class="trends-bar-item">
              <span class="trends-bar-label">{{ t.label }}</span>
              <div class="trends-bar-track">
                <div
                  class="trends-bar-fill"
                  :style="{ width: `${totalFromTypes > 0 ? Math.round((t.count / sortedPositionTypes[0].count) * 100) : 0}%` }"
                  :aria-label="`${t.count} jobs`"
                ></div>
              </div>
              <span class="trends-bar-count">{{ fmt(t.count) }}</span>
            </li>
          </ul>
        </div>

        <!-- Top institutions -->
        <div class="panel trends-stat-panel">
          <p class="eyebrow">Most Active Institutions</p>
          <ol class="trends-institution-list" aria-label="Top institutions by job count">
            <li v-for="(inst, i) in trends.stats.topInstitutions" :key="inst.institution" class="trends-inst-item">
              <span class="trends-inst-rank">{{ i + 1 }}</span>
              <span class="trends-inst-name">{{ inst.institution }}</span>
              <span class="trends-inst-count">{{ fmt(inst.count) }}</span>
            </li>
          </ol>
        </div>

        <!-- History sparkline -->
        <div v-if="historyBars.length > 1" class="panel trends-stat-panel">
          <p class="eyebrow">12-Week History</p>
          <div class="trends-sparkline" role="img" aria-label="Job count history bar chart">
            <div
              v-for="bar in historyBars"
              :key="bar.weekEnd"
              class="trends-spark-bar"
              :style="{ height: `${bar.heightPct}%` }"
              :title="`${fmtWeek(bar.weekEnd)}: ${fmt(bar.totalJobs)} jobs`"
            ></div>
          </div>
          <div class="trends-spark-labels">
            <span>{{ fmtWeek(historyBars[0].weekEnd) }}</span>
            <span>{{ fmtWeek(historyBars[historyBars.length - 1].weekEnd) }}</span>
          </div>
        </div>

      </div>
    </template>
  </section>
</template>
