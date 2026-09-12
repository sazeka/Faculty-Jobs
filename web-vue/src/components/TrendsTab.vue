<script setup>
import { ref, onMounted, computed } from 'vue'
import { appointmentTrackHistory, disciplineClassificationHistory } from '../lib/trendsHistory.js'

const props = defineProps({
  baseUrl: { type: String, default: '/' },
})

const trends = ref(null)
const loading = ref(true)
const error = ref(null)

onMounted(async () => {
  try {
    const res = await fetch(`${props.baseUrl}data/weekly-trends.json?v=appointment-track-history-1`, {
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
const disciplineHistory = computed(() => disciplineClassificationHistory(trends.value?.history || []))

const controlHistory = computed(() => (trends.value?.history || [])
  .filter(h => h.publicJobs != null && h.privateNonprofitJobs != null)
  .slice(-12))
const controlStats = computed(() => trends.value?.stats?.institutionControlBreakdown || null)

const sortedPositionTypes = computed(() => {
  const types = trends.value?.stats?.positionTypeBreakdown || {}
  return Object.entries(types).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }))
})
const maxTypeCount = computed(() => sortedPositionTypes.value[0]?.count || 1)
const tenureStats = computed(() => trends.value?.stats?.tenureTrackBreakdown || null)
const tenureHistory = computed(() => appointmentTrackHistory(trends.value?.history || []))
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
        </div>
        <div
          v-if="tenureHistory.length"
          class="tenure-history"
          aria-label="Weekly share of classified tenure-track and non-tenure-track job listings"
        >
          <div
            v-for="week in tenureHistory"
            :key="week.weekEnd"
            class="tenure-week"
            tabindex="0"
            :aria-label="`${fmtWeek(week.weekEnd)}: ${week.tenureTrackPct}% tenure-track and ${week.nonTenureTrackPct}% non-tenure-track`"
            :data-tooltip="`${fmtWeek(week.weekEnd)} · Tenure ${week.tenureTrackPct}% · Non-tenure ${week.nonTenureTrackPct}%`"
          >
            <div class="tenure-week-ntt" :style="{ height: `${week.nonTenureTrackPct}%` }"></div>
            <div class="tenure-week-tt" :style="{ height: `${week.tenureTrackPct}%` }"></div>
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
        </div>
        <div class="fa-meta tenure-note">
          Based on {{ fmt(tenureStats.classified) }} listings with a known appointment track.
          {{ fmt(tenureStats.unknown) }} additional listings are unclassified and excluded from the percentages.
        </div>
      </section>

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

    <!-- Disciplines -->
    <div class="trends-lower-grid">

      <!-- Top disciplines -->
      <div>
        <div class="fa-label" style="margin-bottom: 20px;">Top disciplines</div>
        <div v-if="disciplineStats?.topDisciplines?.length" style="border-top: 1px solid var(--rule);">
          <div
            v-for="(d, i) in disciplineStats.topDisciplines"
            :key="d.discipline"
            class="trends-inst-row"
          >
            <span class="fa-meta" style="font-size: 10px; width: 24px; color: var(--ink-4);">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="fa-display" style="font-size: 18px; flex: 1; line-height: 1.2;">{{ d.discipline }}</span>
            <span class="fa-num" style="font-size: 16px;">{{ fmt(d.count) }}</span>
          </div>
        </div>
        <div class="fa-meta" style="margin-top: 10px; color: var(--ink-4); line-height: 1.5;">
          Based on {{ fmt(disciplineStats?.classified || 0) }} listings with a discipline identified so far, out of
          {{ fmt(disciplineStats?.classified + disciplineStats?.unknown || 0) }} tracked
          ({{ disciplineStats?.distinctDisciplines || 0 }} distinct disciplines).
        </div>
      </div>

      <!-- Discipline classification sparkline -->
      <div>
        <div class="fa-label" style="margin-bottom: 20px;">Discipline coverage over time</div>
        <template v-if="disciplineHistory.length > 1">
          <div class="trends-sparkline" aria-label="Weekly share of listings with a known discipline">
            <div
              v-for="week in disciplineHistory"
              :key="week.weekEnd"
              class="trends-spark-bar"
              :style="{ height: `${week.classifiedPct}%` }"
              :title="`${fmtWeek(week.weekEnd)}: ${week.classifiedPct}% classified (${fmt(week.classified)} of ${fmt(week.classified + week.unknown)})`"
            ></div>
          </div>
          <div class="trends-spark-labels fa-meta">
            <span>{{ fmtWeek(disciplineHistory[0].weekEnd) }}</span>
            <span>{{ fmtWeek(disciplineHistory[disciplineHistory.length - 1].weekEnd) }}</span>
          </div>
        </template>
        <div v-else class="fa-meta control-unavailable">
          Tracking starts this week; a new comparison point will be added to this chart each week.
        </div>
      </div>

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
  align-items: stretch;
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
.tenure-legend { display: flex; gap: 18px; margin-top: 12px; font-size: 10px; }
.tenure-legend span { display: inline-flex; align-items: center; gap: 6px; }
.tenure-key { display: inline-block; width: 9px; height: 9px; }
.tenure-key-tt { background: var(--sage); }
.tenure-key-ntt { background: var(--accent); }
.tenure-start-note { color: var(--ink-3); line-height: 1.5; margin-top: 10px; }
.tenure-note {
  color: var(--ink-4);
  line-height: 1.6;
  margin-top: 10px;
}

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
  .trends-lower-grid { grid-template-columns: 1fr; gap: 36px; }

  /* Narrow the label/count tracks so the bar keeps usable width on small screens. */
  .trends-bar-row { grid-template-columns: 96px 1fr 40px; gap: 10px; }
  .trends-bar-label { font-size: 10px; }
  .trends-bar-count { font-size: 12px; }
}
</style>
