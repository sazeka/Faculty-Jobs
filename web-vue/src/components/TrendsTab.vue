<script setup>
import { ref, onMounted, computed } from 'vue'
import { appointmentTrackHistory, academicCoverageHistory } from '../lib/trendsHistory.js'
import { POSITION_TYPE_GROUPS } from '../../../scripts/lib/weekly-position-type-stats.js'

const props = defineProps({
  baseUrl: { type: String, default: '/' },
})

const emit = defineEmits(['open-methodology', 'explore-position-type'])

const trends = ref(null)
const loading = ref(true)
const error = ref(null)

onMounted(async () => {
  try {
    const res = await fetch(`${props.baseUrl}data/weekly-trends.json?v=academic-history-1`, {
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    trends.value = await res.json()
  } catch {
    error.value = 'Weekly trends data is not yet available — check back after the next Sunday run.'
  } finally {
    loading.value = false
  }
})

const disciplineStats = computed(() => trends.value?.stats?.disciplineBreakdown || null)
const departmentStats = computed(() => trends.value?.stats?.departmentBreakdown || null)
const disciplineHistory = computed(() => academicCoverageHistory(trends.value?.history, 'discipline'))
const departmentHistory = computed(() => academicCoverageHistory(trends.value?.history, 'department'))
const topDisciplines = computed(() => {
  const items = disciplineStats.value?.topDisciplines?.slice(0, 8) || []
  const max = Math.max(1, ...items.map((item) => item.count))
  const classified = disciplineStats.value?.classified || 0
  return items.map((item) => ({
    ...item,
    barWidth: `${(item.count / max) * 100}%`,
    shareLabel: classified ? `${((item.count / classified) * 100).toFixed(1)}%` : '0.0%',
  }))
})

const controlHistory = computed(() => (trends.value?.history || [])
  .filter(h => h.publicJobs != null && h.privateNonprofitJobs != null)
  .slice(-12))
const controlStats = computed(() => trends.value?.stats?.institutionControlBreakdown || null)

const sortedPositionTypes = computed(() => {
  const types = trends.value?.stats?.positionTypeBreakdown || {}
  return Object.entries(types).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }))
})
const maxTypeCount = computed(() => sortedPositionTypes.value[0]?.count || 1)
const positionSnapshotDate = computed(() => {
  const value = trends.value?.stats?.positionTypeFacets?.sourceScrapedAt || trends.value?.generatedAt
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
})
const positionGroups = computed(() => {
  const facets = trends.value?.stats?.positionTypeFacets
  if (!facets?.groups || !Number.isFinite(facets.total)) return []
  const groups = POSITION_TYPE_GROUPS
  const max = Math.max(1, ...groups.flatMap((group) => group.values.map((label) => Number(facets.groups[group.key]?.[label] || 0))))
  return groups.map((group) => {
    const rows = group.values.map((label) => {
      const count = Number(facets.groups[group.key]?.[label] || 0)
      const share = facets.total ? (count / facets.total) * 100 : 0
      return { label, count, shareLabel: share > 0 && share < 0.1 ? '<0.1%' : `${share.toFixed(1)}%` }
    })
    return { ...group, rows: rows.map((row) => ({ ...row, barWidth: `${(row.count / max) * 100}%` })) }
  })
})
const selectedPositionHistory = ref('Professor')
const positionHistory = computed(() => {
  const items = (trends.value?.history || [])
    .filter((week) => week.positionTypeFacets?.total > 0)
    .slice(-12)
    .map((week) => {
      const facets = week.positionTypeFacets
      const count = Number(Object.values(facets.groups || {}).find((group) =>
        Object.hasOwn(group, selectedPositionHistory.value))?.[selectedPositionHistory.value] || 0)
      return { weekEnd: week.weekEnd, count, share: count / facets.total * 100 }
    })
  const max = Math.max(1, ...items.map((item) => item.share))
  return items.map((item) => ({ ...item, height: `${Math.max(4, item.share / max * 100)}%` }))
})
const positionSnapshotAligned = computed(() =>
  trends.value?.stats?.positionTypeFacets?.total === trends.value?.stats?.totalJobs)
const tenureStats = computed(() => trends.value?.stats?.tenureTrackBreakdown || null)
const tenureHistory = computed(() => {
  const items = appointmentTrackHistory(trends.value?.history || [])
  const max = Math.max(1, ...items.map(w => w.total))
  return items.map(w => ({
    ...w,
    heightPct: Math.max(6, Math.round((w.total / max) * 100)),
  }))
})
const aiStats = computed(() => trends.value?.stats?.aiHiringBreakdown || null)
const aiHistory = computed(() => {
  const items = (trends.value?.history || [])
    .filter(h => h.aiRelatedJobs != null)
    .slice(-12)
  const max = Math.max(1, ...items.map(h => h.aiRelatedJobs))
  return items.map(h => ({
    ...h,
    heightPct: Math.max(6, Math.round((h.aiRelatedJobs / max) * 100)),
  }))
})

const aiParagraphs = computed(() =>
  (trends.value?.aiSummary || '').split('\n\n').map(p => p.trim()).filter(Boolean)
)

function fmt(n) { return Number(n).toLocaleString() }
function fmtWeek(s) {
  return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// APA style calls for a retrieval date on continuously-updated sources
// (n.d. in place of a fixed publication year) -- computed as "today" so the
// citation is always accurate to when it's actually copied.
const retrievedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
const apaCitation = `Azeka, S. (n.d.). Faculty Atlas: The academic job market, mapped. Retrieved ${retrievedOn}, from https://www.facultyatlas.org/`
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

    <!-- AI hiring pulse -->
    <section v-if="aiStats" class="ai-pulse" aria-labelledby="ai-pulse-title">
      <div class="fa-label" id="ai-pulse-title">AI hiring pulse</div>
      <div class="ai-pulse-head" :class="{ 'no-delta': aiStats.delta == null }">
        <div>
          <div class="fa-display ai-pulse-value">{{ fmt(aiStats.related) }}</div>
          <div class="fa-meta">openings explicitly related to AI</div>
        </div>
        <div class="ai-pulse-secondary">
          <div class="fa-num ai-pulse-share">{{ aiStats.sharePct }}%</div>
          <div class="fa-meta">of all tracked listings</div>
        </div>
        <div v-if="aiStats.delta != null" class="ai-pulse-secondary">
          <div class="fa-num ai-pulse-share" :class="{ positive: aiStats.delta >= 0 }">
            {{ aiStats.delta >= 0 ? '+' : '' }}{{ fmt(aiStats.delta) }}
          </div>
          <div class="fa-meta">versus prior week</div>
        </div>
      </div>
      <div v-if="aiHistory.length" class="ai-history" aria-label="Weekly AI-related faculty job listings">
        <div
          v-for="week in aiHistory"
          :key="week.weekEnd"
          class="ai-week"
          tabindex="0"
          :style="{ height: `${week.heightPct}%` }"
          :aria-label="`${fmtWeek(week.weekEnd)}: ${fmt(week.aiRelatedJobs)} AI-related listings, ${week.aiRelatedPct}% of all listings`"
          :data-tooltip="`${fmtWeek(week.weekEnd)} · ${fmt(week.aiRelatedJobs)} openings · ${week.aiRelatedPct}%`"
        ></div>
      </div>
      <div v-if="aiHistory.length" class="trends-spark-labels fa-meta">
        <span>{{ fmtWeek(aiHistory[0].weekEnd) }}</span>
        <span>{{ fmtWeek(aiHistory[aiHistory.length - 1].weekEnd) }}</span>
      </div>
      <div v-if="aiHistory.length === 1" class="fa-meta ai-start-note">
        Tracking starts this week; a new comparison point will be added with each weekly digest.
      </div>
      <div v-if="aiStats.topInstitutions?.length" class="ai-leaders">
        <span class="fa-meta">Leading institutions</span>
        <span v-for="item in aiStats.topInstitutions.slice(0, 3)" :key="item.institution" class="ai-leader">
          {{ item.institution }} <b>{{ fmt(item.count) }}</b>
        </span>
      </div>
      <div class="fa-meta ai-method-note">
        Strict classifier v{{ aiStats.classifierVersion }} counts explicit references to artificial intelligence and core methods such as machine learning, generative AI, NLP, computer vision, and neural networks. Broad data-science or robotics listings are excluded unless an AI signal is present.
      </div>
    </section>

    <hr v-if="aiStats" class="fa-rule-thin" style="margin: 40px 0;" />

    <!-- Appointment-track history + Position types -->
    <div class="trends-stats-grid">

      <!-- Appointment-track history -->
      <section v-if="tenureStats" class="tenure-comparison trends-col" aria-labelledby="tenure-comparison-title">
        <div class="fa-label" id="tenure-comparison-title">Appointment track over time</div>
        <div class="tenure-metrics">
          <div class="tenure-metric">
            <div class="fa-meta">Tenure-track</div>
            <div class="fa-display tenure-metric-value">{{ fmt(tenureStats.tenureTrack) }}</div>
            <div class="fa-num tenure-metric-share">{{ tenureStats.tenureTrackPct }}% of classified</div>
          </div>
          <div class="tenure-metric">
            <div class="fa-meta">Non-tenure-track</div>
            <div class="fa-display tenure-metric-value">{{ fmt(tenureStats.nonTenureTrack) }}</div>
            <div class="fa-num tenure-metric-share">{{ tenureStats.nonTenureTrackPct }}% of classified</div>
          </div>
          <div class="tenure-metric">
            <div class="fa-meta">Variable track</div>
            <div class="fa-display tenure-metric-value">{{ fmt(tenureStats.variableTrack || 0) }}</div>
            <div class="fa-num tenure-metric-share">Known mixed or candidate-dependent track</div>
          </div>
          <div class="tenure-metric">
            <div class="fa-meta">Unclassified</div>
            <div class="fa-display tenure-metric-value">{{ fmt(tenureStats.unknown) }}</div>
            <div class="fa-num tenure-metric-share">Track not yet resolved</div>
          </div>
        </div>
        <div
          v-if="tenureHistory.length"
          class="tenure-history"
          aria-label="Weekly appointment-track composition of all job listings"
        >
          <div
            v-for="week in tenureHistory"
            :key="week.weekEnd"
            class="tenure-week"
            tabindex="0"
            :style="{ height: `${week.heightPct}%` }"
            :aria-label="`${fmtWeek(week.weekEnd)}: ${fmt(week.tenureTrack)} tenure-track, ${fmt(week.nonTenureTrack)} non-tenure-track, ${fmt(week.variableTrack)} variable-track, and ${fmt(week.unknown)} unclassified, out of ${fmt(week.total)} listings`"
            :data-tooltip="`${fmtWeek(week.weekEnd)} · Tenure ${fmt(week.tenureTrack)} · Non-tenure ${fmt(week.nonTenureTrack)} · Variable ${fmt(week.variableTrack)} · Unclassified ${fmt(week.unknown)}`"
          >
            <div class="tenure-week-unknown" :style="{ height: `${week.unknownPct}%` }"></div>
            <div class="tenure-week-variable" :style="{ height: `${week.variableTrackPct}%` }"></div>
            <div class="tenure-week-ntt" :style="{ height: `${week.nonTenureTrackTotalPct}%` }"></div>
            <div class="tenure-week-tt" :style="{ height: `${week.tenureTrackTotalPct}%` }"></div>
          </div>
        </div>
        <div v-if="tenureHistory.length" class="trends-spark-labels fa-meta">
          <span>{{ fmtWeek(tenureHistory[0].weekEnd) }}</span>
          <span>{{ fmtWeek(tenureHistory[tenureHistory.length - 1].weekEnd) }}</span>
        </div>
        <div v-if="tenureHistory.length === 1" class="fa-meta tenure-start-note">
          Tracking starts this week; a new comparison point will be added after each weekly digest.
        </div>
        <div v-if="tenureHistory.length" class="tenure-legend fa-meta">
          <span><i class="tenure-key tenure-key-tt"></i>Tenure-track</span>
          <span><i class="tenure-key tenure-key-ntt"></i>Non-tenure-track</span>
          <span><i class="tenure-key tenure-key-variable"></i>Variable track</span>
          <span><i class="tenure-key tenure-key-unknown"></i>Unclassified</span>
        </div>
        <div class="fa-meta tenure-note">
          Based on {{ fmt(tenureStats.classified) }} listings resolved to tenure-track or non-tenure-track.
          {{ fmt(tenureStats.variableTrack || 0) }} additional searches explicitly offer multiple tracks or determine the track from the selected candidate; they are known variable-track searches and excluded from the binary percentages.
          {{ fmt(tenureStats.unknown) }} additional listings are unclassified and excluded from the percentages.
          <button type="button" class="trends-methods-link" @click="emit('open-methodology')">How this is classified</button>
        </div>
      </section>

      <!-- Position types -->
      <section class="trends-col position-types-panel" aria-labelledby="position-types-title">
        <div class="fa-label" id="position-types-title">Position types</div>
        <template v-if="positionGroups.length">
          <p class="fa-meta position-types-intro">
            {{ fmt(trends.stats.positionTypeFacets.total) }} listings in this breakdown
            <span v-if="positionSnapshotDate"> · Snapshot {{ positionSnapshotDate }} (UTC)</span>
            · title-based labels
          </p>
          <p v-if="!positionSnapshotAligned" class="fa-meta position-types-sync-note">
            This position snapshot differs from the weekly digest above; its counts use the date shown here.
          </p>
          <div v-for="group in positionGroups" :key="group.key" class="position-type-group" :class="`position-type-group--${group.key}`">
            <h3 class="fa-meta position-type-group-title">{{ group.label }}</h3>
            <button v-for="row in group.rows" :key="row.label" type="button" class="position-type-row" :disabled="row.count === 0" :aria-label="`Explore ${row.label} jobs; ${fmt(row.count)} in this snapshot`" @click="emit('explore-position-type', row.label)">
              <span class="position-type-label">{{ row.label }}</span>
              <span class="position-type-track" aria-hidden="true"><span class="position-type-fill" :style="{ width: row.barWidth }"></span></span>
              <span class="position-type-value fa-num"><strong>{{ fmt(row.count) }}</strong><small>{{ row.shareLabel }}</small></span>
            </button>
          </div>
          <div v-if="positionHistory.length" class="position-history">
            <div class="position-history-head">
              <h3 class="fa-meta position-type-group-title">Weekly history</h3>
              <label class="fa-meta">Show
                <select v-model="selectedPositionHistory" aria-label="Position type history category">
                  <optgroup v-for="group in positionGroups" :key="group.key" :label="group.label">
                    <option v-for="row in group.rows" :key="row.label" :value="row.label">{{ row.label }}</option>
                  </optgroup>
                </select>
              </label>
            </div>
            <div class="position-history-bars" role="img" :aria-label="`Weekly share of ${selectedPositionHistory} listings: ${positionHistory.map((week) => `${fmtWeek(week.weekEnd)} ${week.share.toFixed(1)} percent`).join(', ')}`">
              <div v-for="week in positionHistory" :key="week.weekEnd" class="position-history-week" :title="`${fmtWeek(week.weekEnd)}: ${fmt(week.count)} ${selectedPositionHistory} listings, ${week.share.toFixed(1)}% of all listings`">
                <span class="position-history-value">{{ week.share.toFixed(1) }}%</span>
                <span class="position-history-track"><span :style="{ height: week.height }"></span></span>
                <span class="position-history-date">{{ fmtWeek(week.weekEnd) }}</span>
              </div>
            </div>
            <p class="fa-meta position-history-note">Bar heights are relative to the highest week for the selected category.</p>
            <p v-if="positionHistory.length === 1" class="fa-meta position-history-note">Tracking starts with this digest. Weekly comparisons will appear as new digests are published.</p>
          </div>
          <p class="fa-meta position-types-note">
            Position types are inferred from job titles and available rank data; a title may be incomplete or ambiguous.
            “Faculty, role unspecified” identifies a faculty position without a more specific role; “Other / unclear” has no clear role label. “Rank unspecified” means a professor role was identified without a specific rank.
            <span v-if="trends.stats.positionTypeFacets.unspecifiedAdjunct"> {{ fmt(trends.stats.positionTypeFacets.unspecifiedAdjunct) }} of the faculty listings with an unspecified role are labeled Adjunct; that identifies appointment status, not a specific role.</span>
            A listing can appear in multiple rows, so percentages may not sum to 100%. Each percentage uses all {{ fmt(trends.stats.positionTypeFacets.total) }} listings; bar lengths use one scale across all groups.
            Select a row to see matching jobs in the current catalog; its total may differ as listings change or duplicate posts are grouped.
            <button type="button" class="trends-methods-link" @click="emit('open-methodology', 'methodology-position-types')">How this is classified</button>
          </p>
        </template>
        <template v-else>
          <div v-for="t in sortedPositionTypes" :key="t.label" class="trends-bar-row">
            <div class="trends-bar-label fa-meta">{{ t.label }}</div>
            <div class="trends-bar-track"><div class="trends-bar-fill" :style="{ width: `${Math.round((t.count / maxTypeCount) * 100)}%` }"></div></div>
            <div class="fa-num trends-bar-count">{{ fmt(t.count) }}</div>
          </div>
          <p class="fa-meta position-types-note">
            This older breakdown assigns one inferred title label per listing; ambiguous or unstated roles may be grouped under “Faculty.”
            The detailed role, rank, and appointment breakdown will appear with the next weekly refresh.
            <button type="button" class="trends-methods-link" @click="emit('open-methodology', 'methodology-position-types')">How this is classified</button>
          </p>
        </template>
      </section>

    </div>

    <hr v-if="tenureStats" class="fa-rule-thin" style="margin: 40px 0;" />

    <!-- Public/private history -->
    <div class="control-standalone">
      <div class="fa-label" style="margin-bottom: 20px;">Public vs private over time</div>
      <template v-if="controlStats">
        <div class="control-current">
          <div>
            <div class="fa-meta">Public</div>
            <div class="fa-display control-value">{{ fmt(controlStats.public) }}</div>
            <div class="fa-num control-share">{{ controlStats.publicPct }}%</div>
          </div>
          <div>
            <div class="fa-meta">Private nonprofit</div>
            <div class="fa-display control-value">{{ fmt(controlStats.privateNonprofit) }}</div>
            <div class="fa-num control-share">{{ controlStats.privateNonprofitPct }}%</div>
          </div>
        </div>
        <div v-if="controlHistory.length" class="control-history" aria-label="Weekly share of classified public and private nonprofit job listings">
          <div
            v-for="week in controlHistory"
            :key="week.weekEnd"
            class="control-week"
            tabindex="0"
            :aria-label="`${fmtWeek(week.weekEnd)}: ${week.publicPct}% public and ${week.privateNonprofitPct}% private nonprofit`"
            :data-tooltip="`${fmtWeek(week.weekEnd)} · Public ${week.publicPct}% · Private ${week.privateNonprofitPct}%`"
          >
            <div class="control-week-private" :style="{ height: `${week.privateNonprofitPct}%` }"></div>
            <div class="control-week-public" :style="{ height: `${week.publicPct}%` }"></div>
          </div>
        </div>
        <div v-if="controlHistory.length" class="trends-spark-labels fa-meta">
          <span>{{ fmtWeek(controlHistory[0].weekEnd) }}</span>
          <span>{{ fmtWeek(controlHistory[controlHistory.length - 1].weekEnd) }}</span>
        </div>
        <div v-if="controlHistory.length === 1" class="fa-meta control-start-note">
          Tracking starts this week; a new comparison point will be added to this chart each week.
        </div>
        <div class="control-legend fa-meta">
          <span><i class="control-key control-key-public"></i>Public</span>
          <span><i class="control-key control-key-private"></i>Private nonprofit</span>
        </div>
        <div class="fa-meta control-note">
          Percentages use {{ fmt(controlStats.classified) }} listings matched to institution control.
          {{ fmt(controlStats.unknown) }} unmatched listings are excluded.
        </div>
      </template>
      <div v-else class="fa-meta control-unavailable">
        Institution-control history will appear after the latest weekly data finishes loading.
      </div>
    </div>

    <hr class="fa-rule-thin" style="margin: 40px 0;" />

    <!-- Academic fields: same current-bars + weekly-history language as position types and appointment track -->
    <div class="trends-stats-grid academic-stats-grid">
      <section class="trends-col academic-panel" aria-labelledby="discipline-trends-title">
        <div class="fa-label" id="discipline-trends-title">Academic disciplines over time</div>
        <template v-if="disciplineStats">
          <div class="academic-current">
            <div class="fa-display academic-current-value">{{ fmt(disciplineStats.classified) }}</div>
            <div class="fa-meta">listings with a discipline · {{ disciplineStats.classifiedPct }}% of all listings</div>
          </div>
          <div v-if="disciplineHistory.length" class="tenure-history academic-history" aria-label="Weekly share of listings with an academic discipline">
            <div
              v-for="week in disciplineHistory"
              :key="week.weekEnd"
              class="tenure-week academic-week"
              tabindex="0"
              :aria-label="`${fmtWeek(week.weekEnd)}: ${fmt(week.classified)} listings with a discipline (${week.classifiedPct}%), ${fmt(week.unknown)} without`"
              :data-tooltip="`${fmtWeek(week.weekEnd)} · ${week.classifiedPct}% identified · ${fmt(week.classified)} listings`"
            >
              <div class="academic-week-unknown" :style="{ height: `${week.unknownPct}%` }"></div>
              <div class="academic-week-known" :style="{ height: `${week.classifiedPct}%` }"></div>
            </div>
          </div>
          <div v-if="disciplineHistory.length" class="trends-spark-labels fa-meta">
            <span>{{ fmtWeek(disciplineHistory[0].weekEnd) }}</span>
            <span>{{ fmtWeek(disciplineHistory[disciplineHistory.length - 1].weekEnd) }}</span>
          </div>
          <div v-if="disciplineHistory.length" class="tenure-legend fa-meta">
            <span><i class="tenure-key academic-key-known"></i>Identified</span>
            <span><i class="tenure-key academic-key-unknown"></i>Not identified</span>
          </div>
          <div class="fa-meta academic-subhead">Leading disciplines this week</div>
          <div v-for="item in topDisciplines" :key="item.discipline" class="position-type-row academic-category-row">
            <span class="position-type-label">{{ item.discipline }}</span>
            <span class="position-type-track" aria-hidden="true"><span class="position-type-fill" :style="{ width: item.barWidth }"></span></span>
            <span class="position-type-value fa-num"><strong>{{ fmt(item.count) }}</strong><small>{{ item.shareLabel }}</small></span>
          </div>
          <p class="fa-meta academic-note">Percentages for leading disciplines use the {{ fmt(disciplineStats.classified) }} classified listings. Bar lengths compare the disciplines shown.</p>
        </template>
      </section>

      <section class="trends-col academic-panel" aria-labelledby="department-trends-title">
        <div class="fa-label" id="department-trends-title">Department data over time</div>
        <template v-if="departmentStats">
          <div class="academic-current">
            <div class="fa-display academic-current-value">{{ fmt(departmentStats.classified) }}</div>
            <div class="fa-meta">listings with a usable Department · {{ departmentStats.classifiedPct }}% of all listings</div>
          </div>
          <div v-if="departmentHistory.length" class="tenure-history academic-history" aria-label="Weekly share of listings with a usable Department">
            <div
              v-for="week in departmentHistory"
              :key="week.weekEnd"
              class="tenure-week academic-week academic-week--department"
              tabindex="0"
              :aria-label="`${fmtWeek(week.weekEnd)}: ${fmt(week.classified)} listings with a usable Department (${week.classifiedPct}%), ${fmt(week.unknown)} without`"
              :data-tooltip="`${fmtWeek(week.weekEnd)} · ${week.classifiedPct}% tagged · ${fmt(week.classified)} listings`"
            >
              <div class="academic-week-unknown" :style="{ height: `${week.unknownPct}%` }"></div>
              <div class="academic-week-known" :style="{ height: `${week.classifiedPct}%` }"></div>
            </div>
          </div>
          <div v-if="departmentHistory.length" class="trends-spark-labels fa-meta">
            <span>{{ fmtWeek(departmentHistory[0].weekEnd) }}</span>
            <span>{{ fmtWeek(departmentHistory[departmentHistory.length - 1].weekEnd) }}</span>
          </div>
          <div v-if="departmentHistory.length" class="tenure-legend fa-meta">
            <span><i class="tenure-key academic-key-known academic-key-department"></i>Usable Department</span>
            <span><i class="tenure-key academic-key-unknown"></i>Missing</span>
          </div>
          <p v-if="departmentHistory.length === 1" class="fa-meta academic-note">Department tracking starts with this snapshot; weekly comparisons will appear after the next digest.</p>
          <p class="fa-meta academic-note">{{ fmt(departmentStats.unknown) }} listings have no usable Department. This measures field coverage using the same validation as job listings; it does not mean every displayed Department was independently verified.</p>
        </template>
        <p v-else class="fa-meta academic-note">Department history will appear with the next weekly digest.</p>
      </section>
    </div>

    <hr class="fa-rule-thin" style="margin: 40px 0;" />

    <!-- Citation -->
    <section class="trends-citation" aria-labelledby="trends-citation-title">
      <div class="fa-label" id="trends-citation-title">How to cite this data</div>
      <p class="fa-meta trends-citation-text">{{ apaCitation }}</p>
    </section>

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

.ai-pulse { max-width: 920px; }
.ai-pulse-head {
  display: grid;
  grid-template-columns: minmax(220px, 1.4fr) repeat(2, minmax(150px, .8fr));
  gap: 1px;
  margin-top: 18px;
  border: 1px solid var(--rule-2);
  background: var(--rule-2);
}
.ai-pulse-head > div { padding: 20px 22px; background: var(--paper); }
.ai-pulse-head.no-delta { grid-template-columns: minmax(220px, 1.4fr) minmax(150px, .8fr); }
.ai-pulse-value { font-size: 44px; line-height: 1; color: var(--accent); }
.ai-pulse-secondary { display: flex; flex-direction: column; justify-content: center; }
.ai-pulse-share { font-size: 25px; color: var(--ink); }
.ai-pulse-share.positive { color: var(--sage); }
.ai-history {
  height: 126px;
  display: flex;
  align-items: flex-end;
  gap: 7px;
  margin-top: 24px;
  padding: 10px 12px 0;
  border-bottom: 1px solid var(--rule);
}
.ai-week {
  position: relative;
  flex: 1;
  max-width: 54px;
  min-height: 8px;
  background: var(--accent);
  opacity: .76;
  transition: opacity 120ms ease, transform 120ms ease;
}
.ai-week:hover, .ai-week:focus { opacity: 1; transform: translateY(-2px); outline: none; }
.ai-week:hover::after, .ai-week:focus::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 7px);
  z-index: 2;
  transform: translateX(-50%);
  width: max-content;
  max-width: 220px;
  padding: 6px 8px;
  border-radius: 4px;
  color: var(--paper);
  background: var(--ink);
  font-size: 10px;
  white-space: nowrap;
}
.ai-start-note { margin-top: 12px; }
.ai-leaders { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 18px; }
.ai-leader { padding: 6px 9px; border: 1px solid var(--rule-2); color: var(--ink-2); font-size: 11px; }
.ai-leader b { margin-left: 5px; color: var(--accent); }
.ai-method-note { max-width: 820px; margin-top: 16px; color: var(--ink-4); line-height: 1.55; }

.tenure-comparison { max-width: 820px; }
.tenure-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  margin-top: 18px;
  border: 1px solid var(--rule);
  background: var(--rule);
}
.tenure-metric {
  background: var(--paper);
  padding: 20px 24px;
}
.tenure-metric-value {
  font-size: 34px;
  line-height: 1.1;
  margin-top: 5px;
}
.tenure-metric-share {
  color: var(--ink-3);
  font-size: 11px;
  margin-top: 3px;
}
.tenure-history {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 132px;
  margin-top: 48px;
  border-bottom: 1px solid var(--rule);
}
.tenure-week {
  display: flex;
  flex: 0 0 calc((100% - 44px) / 12);
  flex-direction: column;
  justify-content: flex-end;
  min-width: 5px;
  position: relative;
  outline: none;
}
.tenure-week::after {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  z-index: 2;
  padding: 7px 9px;
  transform: translateX(-50%) translateY(3px);
  background: var(--ink);
  color: var(--paper);
  content: attr(data-tooltip);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
  letter-spacing: .02em;
  opacity: 0;
  pointer-events: none;
  transition: opacity .12s ease, transform .12s ease;
  white-space: nowrap;
}
.tenure-week:first-child::after { left: 0; transform: translateX(0) translateY(3px); }
.tenure-week:last-child:not(:first-child)::after { right: 0; left: auto; transform: translateX(0) translateY(3px); }
.tenure-week:hover::after,
.tenure-week:focus-visible::after {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.tenure-week:first-child:hover::after,
.tenure-week:first-child:focus-visible::after,
.tenure-week:last-child:not(:first-child):hover::after,
.tenure-week:last-child:not(:first-child):focus-visible::after { transform: translateX(0) translateY(0); }
.tenure-week:focus-visible { box-shadow: 0 0 0 2px var(--ink); }
.tenure-week-tt { background: var(--sage); }
.tenure-week-ntt { background: var(--accent); }
.tenure-week-variable { background: var(--ocean); }
.tenure-week-unknown { background: var(--rule-2); }
.tenure-legend { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 12px; font-size: 10px; }
.tenure-legend span { display: inline-flex; align-items: center; gap: 6px; }
.tenure-key { display: inline-block; width: 9px; height: 9px; }
.tenure-key-tt { background: var(--sage); }
.tenure-key-ntt { background: var(--accent); }
.tenure-key-variable { background: var(--ocean); }
.tenure-key-unknown { background: var(--rule-2); border: 1px solid var(--ink-4); }
.tenure-start-note { color: var(--ink-3); line-height: 1.5; margin-top: 10px; }
.tenure-note {
  color: var(--ink-4);
  line-height: 1.6;
  margin-top: 10px;
}
.trends-methods-link {
  display: inline;
  margin-left: 4px;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
  text-underline-offset: 2px;
}
.trends-methods-link:hover,
.trends-methods-link:focus-visible { color: var(--accent); }

.trends-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
}
.trends-col {}

.control-standalone { max-width: 620px; }

.control-current {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 18px;
}
.control-value { font-size: 28px; line-height: 1.1; margin-top: 4px; }
.control-share { color: var(--ink-3); font-size: 11px; margin-top: 2px; }
.control-history {
  display: flex;
  align-items: stretch;
  gap: 4px;
  height: 112px;
  margin-top: 48px;
  border-bottom: 1px solid var(--rule);
}
.control-week {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: flex-end;
  min-width: 5px;
  position: relative;
  outline: none;
}
.control-week::after {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  z-index: 2;
  padding: 7px 9px;
  transform: translateX(-50%) translateY(3px);
  background: var(--ink);
  color: var(--paper);
  content: attr(data-tooltip);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
  letter-spacing: .02em;
  opacity: 0;
  pointer-events: none;
  transition: opacity .12s ease, transform .12s ease;
  white-space: nowrap;
}
.control-week:first-child::after { left: 0; transform: translateX(0) translateY(3px); }
.control-week:last-child:not(:first-child)::after { right: 0; left: auto; transform: translateX(0) translateY(3px); }
.control-week:hover::after,
.control-week:focus-visible::after {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.control-week:first-child:hover::after,
.control-week:first-child:focus-visible::after,
.control-week:last-child:not(:first-child):hover::after,
.control-week:last-child:not(:first-child):focus-visible::after { transform: translateX(0) translateY(0); }
.control-week:focus-visible { box-shadow: 0 0 0 2px var(--ink); }
.control-week-public { background: var(--sage); }
.control-week-private { background: var(--accent); }
.control-legend { display: flex; gap: 18px; margin-top: 12px; font-size: 10px; }
.control-legend span { display: inline-flex; align-items: center; gap: 6px; }
.control-key { display: inline-block; width: 9px; height: 9px; }
.control-key-public { background: var(--sage); }
.control-key-private { background: var(--accent); }
.control-note { color: var(--ink-4); line-height: 1.5; margin-top: 10px; }
.control-start-note { color: var(--ink-3); line-height: 1.5; margin-top: 10px; }
.control-unavailable { color: var(--ink-3); line-height: 1.6; max-width: 360px; }

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

.position-types-intro { margin: 8px 0 18px; color: var(--ink-3); }
.position-types-sync-note { margin: -10px 0 16px; color: var(--accent); }
.position-type-group { margin-top: 18px; }
.position-type-group-title {
  margin: 0 0 7px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--rule);
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.position-type-row {
  display: grid;
  grid-template-columns: minmax(132px, 1.2fr) minmax(65px, 1.5fr) 76px;
  gap: 12px;
  align-items: center;
  min-height: 34px;
  width: 100%;
  padding: 2px 4px;
  margin: 0 -4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.position-type-row:hover, .position-type-row:focus-visible { background: var(--paper-3); }
.position-type-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.position-type-row:disabled { cursor: default; opacity: .5; }
.position-type-label { color: var(--ink-2); font-size: 12px; line-height: 1.25; }
.position-type-track { height: 8px; background: var(--paper-3); overflow: hidden; border-radius: 999px; }
.position-type-fill { display: block; height: 100%; background: var(--ink-2); border-radius: inherit; }
.position-type-group--ranks .position-type-fill { background: var(--sage); }
.position-type-group--appointmentStatus .position-type-fill { background: var(--accent); }
.position-type-group--facultyFocus .position-type-fill { background: var(--ink-2); }
.position-type-value { text-align: right; color: var(--ink-2); line-height: 1.05; }
.position-type-value strong { display: block; font-size: 12px; font-weight: 600; }
.position-type-value small { display: block; margin-top: 3px; color: var(--ink-4); font-size: 10px; }
.position-types-note { margin: 18px 0 0; color: var(--ink-4); line-height: 1.5; }
.position-history { margin-top: 22px; }
.position-history-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.position-history-head .position-type-group-title { flex: 1; }
.position-history-head label { white-space: nowrap; }
.position-history-head select { max-width: 180px; margin-left: 4px; padding: 4px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink-2); font: inherit; }
.position-history-bars { display: flex; gap: 5px; height: 115px; margin-top: 12px; align-items: stretch; }
.position-history-week { display: flex; flex: 1; min-width: 0; flex-direction: column; align-items: center; gap: 3px; }
.position-history-value, .position-history-date { color: var(--ink-4); font-size: 10px; white-space: nowrap; }
.position-history-week:not(:first-child):not(:last-child) .position-history-date { visibility: hidden; }
.position-history-track { display: flex; flex: 1; width: min(100%, 26px); align-items: end; background: var(--paper-3); }
.position-history-track > span { display: block; width: 100%; background: var(--sage); }
.position-history-note { margin: 10px 0 0; color: var(--ink-4); }

.academic-stats-grid { align-items: start; }
.academic-panel { min-width: 0; }
.academic-current { margin-top: 18px; min-height: 70px; }
.academic-current-value { font-size: 34px; line-height: 1.1; }
.academic-history { margin-top: 24px; }
.academic-week-unknown { background: var(--paper-3); }
.academic-week-known { background: var(--sage); }
.academic-week--department .academic-week-known { background: var(--accent); }
.academic-key-known { background: var(--sage); }
.academic-key-department { background: var(--accent); }
.academic-key-unknown { background: var(--paper-3); }
.academic-subhead {
  margin: 24px 0 7px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--rule);
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.academic-category-row .position-type-fill { background: var(--sage); }
.academic-note { margin: 18px 0 0; color: var(--ink-4); line-height: 1.55; }

.trends-citation { max-width: 820px; }
.trends-citation-text {
  margin: 12px 0 0;
  padding: 14px 16px;
  border: 1px solid var(--rule-2);
  background: var(--paper-2);
  color: var(--ink-3);
  font-family: var(--font-mono);
  line-height: 1.6;
  /* Preserve the trailing italic-style hanging indent APA uses without
     needing a second element -- text-indent only affects the wrapped line,
     not the first. */
  text-indent: -1.2em;
  padding-left: calc(16px + 1.2em);
}

.trends-spark-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 10px;
}

/* ─── Mobile (matches the app-wide 767px breakpoint) ─── */
@media (max-width: 767px) {
  .trends-tab { padding: 32px var(--pad); }
  .trends-narrative { margin-top: 24px; }
  .trends-prose p { font-size: 15px; line-height: 1.7; }
  .ai-pulse-head { grid-template-columns: 1fr; }
  .ai-pulse-head.no-delta { grid-template-columns: 1fr; }
  .ai-pulse-head > div { padding: 16px 18px; }
  .ai-history { gap: 4px; }
  .tenure-metrics { grid-template-columns: 1fr; }

  /* Stack the two-up grids — the side-by-side columns and the fixed 380px
     sparkline column both overflow a phone viewport otherwise. */
  .trends-stats-grid { grid-template-columns: 1fr; gap: 36px; }

  /* Narrow the label/count tracks so the bar keeps usable width on small screens. */
  .trends-bar-row { grid-template-columns: 96px 1fr 40px; gap: 10px; }
  .trends-bar-label { font-size: 10px; }
  .trends-bar-count { font-size: 12px; }
  .position-type-row { grid-template-columns: minmax(105px, 1.15fr) minmax(50px, 1fr) 65px; gap: 8px; }
  .position-type-label { font-size: 11px; }
}
</style>
