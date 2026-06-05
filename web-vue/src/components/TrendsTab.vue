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
  const max = Math.max(...items.map(h => h.totalJobs))
  return items.map(h => ({
    weekEnd: h.weekEnd,
    totalJobs: h.totalJobs,
    heightPct: max > 0 ? Math.round((h.totalJobs / max) * 100) : 0,
  }))
})

const topSources = computed(() => (trends.value?.stats?.topSources || []).slice(0, 8))
const maxSourceCount = computed(() => topSources.value[0]?.count || 1)

const sortedPositionTypes = computed(() => {
  const types = trends.value?.stats?.positionTypeBreakdown || {}
  return Object.entries(types).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }))
})
const maxTypeCount = computed(() => sortedPositionTypes.value[0]?.count || 1)

const aiParagraphs = computed(() =>
  (trends.value?.aiSummary || '').split('\n\n').map(p => p.trim()).filter(Boolean)
)

function fmt(n) { return Number(n).toLocaleString() }
function fmtWeek(s) {
  return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
</script>

<template>
  <div class="trends-tab">
  <!-- Loading -->
  <div v-if="loading" style="padding: 80px 0; text-align: center;">
    <div class="fa-meta" style="letter-spacing: 0.1em;">Loading trends…</div>
  </div>

  <!-- Error -->
  <div v-else-if="error" style="padding: 80px 0; text-align: center;">
    <div class="fa-display" style="font-size: 28px; color: var(--ink-3); margin-bottom: 12px;">No data yet</div>
    <div class="fa-meta">{{ error }}</div>
  </div>

  <!-- Content -->
  <template v-else-if="trends">

    <!-- Section head -->
    <div class="fa-section-head">
      <div>
        <div class="fa-label">§ III</div>
        <h2 class="fa-display" style="font-size: 48px; margin: 4px 0 0;">Weekly <i>digest</i></h2>
      </div>
      <div style="text-align: right;">
        <div class="fa-meta" style="margin-bottom: 4px;">Week ending {{ fmtWeek(trends.weekEnd) }}</div>
        <div class="fa-display" style="font-size: 36px; line-height: 1;">{{ fmt(trends.stats.totalJobs) }}</div>
        <div class="fa-meta" style="margin-top: 2px;">
          open posts
          <span
            v-if="trends.stats.totalDelta != null"
            :style="{ color: trends.stats.totalDelta >= 0 ? 'var(--sage)' : 'var(--accent)' }"
          >
            · {{ trends.stats.totalDelta >= 0 ? '+' : '' }}{{ fmt(trends.stats.totalDelta) }} vs prior week
          </span>
        </div>
      </div>
    </div>

    <!-- AI Narrative -->
    <div class="trends-narrative">
      <div class="fa-label" style="margin-bottom: 20px;">This week's summary</div>
      <div class="trends-prose">
        <p v-for="(para, i) in aiParagraphs" :key="i">{{ para }}</p>
      </div>
      <div class="fa-meta" style="margin-top: 16px; color: var(--ink-4);">
        Generated {{ new Date(trends.generatedAt).toLocaleString() }}
      </div>
    </div>

    <hr class="fa-rule-thin" style="margin: 40px 0;" />

    <!-- Stats grid -->
    <div class="trends-stats-grid">

      <!-- Top states -->
      <div class="trends-col">
        <div class="fa-label" style="margin-bottom: 20px;">Top states &amp; systems</div>
        <div v-for="s in topSources" :key="s.source" class="trends-bar-row">
          <div class="trends-bar-label fa-meta">{{ s.source }}</div>
          <div class="trends-bar-track">
            <div class="trends-bar-fill" :style="{ width: `${Math.round((s.count / maxSourceCount) * 100)}%` }"></div>
          </div>
          <div class="fa-num trends-bar-count">{{ fmt(s.count) }}</div>
        </div>
      </div>

      <!-- Position types -->
      <div class="trends-col">
        <div class="fa-label" style="margin-bottom: 20px;">Position types</div>
        <div v-for="t in sortedPositionTypes" :key="t.label" class="trends-bar-row">
          <div class="trends-bar-label fa-meta">{{ t.label }}</div>
          <div class="trends-bar-track">
            <div class="trends-bar-fill" :style="{ width: `${Math.round((t.count / maxTypeCount) * 100)}%` }"></div>
          </div>
          <div class="fa-num trends-bar-count">{{ fmt(t.count) }}</div>
        </div>
      </div>

    </div>

    <hr class="fa-rule-thin" style="margin: 40px 0;" />

    <!-- Institutions + sparkline -->
    <div class="trends-lower-grid">

      <!-- Top institutions -->
      <div>
        <div class="fa-label" style="margin-bottom: 20px;">Most active institutions</div>
        <div style="border-top: 1px solid var(--rule);">
          <div
            v-for="(inst, i) in trends.stats.topInstitutions"
            :key="inst.institution"
            class="trends-inst-row"
          >
            <span class="fa-meta" style="font-size: 10px; width: 24px; color: var(--ink-4);">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="fa-display" style="font-size: 18px; flex: 1; line-height: 1.2;">{{ inst.institution }}</span>
            <span class="fa-num" style="font-size: 16px;">{{ fmt(inst.count) }}</span>
          </div>
        </div>
      </div>

      <!-- Sparkline -->
      <div v-if="historyBars.length > 1">
        <div class="fa-label" style="margin-bottom: 20px;">12-week history</div>
        <div class="trends-sparkline">
          <div
            v-for="bar in historyBars"
            :key="bar.weekEnd"
            class="trends-spark-bar"
            :style="{ height: `${bar.heightPct}%` }"
            :title="`${fmtWeek(bar.weekEnd)}: ${fmt(bar.totalJobs)} jobs`"
          ></div>
        </div>
        <div class="trends-spark-labels fa-meta">
          <span>{{ fmtWeek(historyBars[0].weekEnd) }}</span>
          <span>{{ fmtWeek(historyBars[historyBars.length - 1].weekEnd) }}</span>
        </div>
      </div>

    </div>

  </template>
  </div>
</template>

<style scoped>
/* Single root: owns the section padding (component has multiple v-if branches so
   a fallthrough style attr wouldn't apply) and caps width on wide laptops so the
   bars/columns read as a centered column instead of stretching edge-to-edge. */
.trends-tab {
  max-width: 1180px;
  margin: 0 auto;
  padding: 56px var(--pad);
}
.trends-narrative {
  margin: 32px 0 0;
  max-width: 720px;
}
.trends-prose p {
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.75;
  color: var(--ink-2);
  margin: 0 0 16px;
}
.trends-prose p:last-child { margin-bottom: 0; }

.trends-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
}
.trends-col {}

.trends-bar-row {
  display: grid;
  grid-template-columns: 140px 1fr 52px;
  gap: 12px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid var(--rule-2);
}
.trends-bar-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
}
.trends-bar-track {
  height: 3px;
  background: var(--paper-3);
}
.trends-bar-fill {
  height: 100%;
  background: var(--ink-2);
  transition: width .3s ease;
}
.trends-bar-count {
  text-align: right;
  font-size: 13px;
  color: var(--ink-2);
}

.trends-lower-grid {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 48px;
}
.trends-inst-row {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 11px 0;
  border-bottom: 1px solid var(--rule-2);
}

.trends-sparkline {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 120px;
  border-bottom: 1px solid var(--rule);
  padding-bottom: 0;
}
.trends-spark-bar {
  flex: 1;
  background: var(--ink-3);
  transition: background .12s;
  min-height: 2px;
}
.trends-spark-bar:hover { background: var(--accent); }
.trends-spark-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 10px;
}
</style>
