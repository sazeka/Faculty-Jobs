<script setup>
import { computed, ref } from 'vue'
import { categoryOptions, matchingCategoryOptions, categorySeries } from '../lib/academicCategoryTrends.js'

const props = defineProps({
  kind: { type: String, required: true },
  weeks: { type: Array, default: () => [] },
  selected: { type: String, default: '' },
  classified: { type: Number, default: 0 },
})
const emit = defineEmits(['update:selected'])
const query = ref('')
const options = computed(() => categoryOptions(props.weeks, props.kind))
const visibleOptions = computed(() => matchingCategoryOptions(options.value, query.value, 6))
const selectedName = computed(() => options.value.find((item) => item.name === props.selected)?.name || options.value[0]?.name || '')
const points = computed(() => categorySeries(props.weeks, props.kind, selectedName.value))
const current = computed(() => points.value.at(-1) || null)
const previous = computed(() => points.value.length > 1 ? points.value.at(-2) : null)
const delta = computed(() => previous.value && current.value ? current.value.count - previous.value.count : null)
const shareOfClassified = computed(() => props.classified && current.value
  ? percent(current.value.count / props.classified * 100, 1)
  : '0.0%')
const chart = computed(() => {
  const max = Math.max(1, ...points.value.map((point) => point.sharePct))
  return points.value.map((point) => ({
    ...point,
    height: point.count ? `${Math.max(4, point.sharePct / max * 100)}%` : '0%',
  }))
})
const label = computed(() => props.kind === 'department' ? 'Department' : 'discipline')

function choose(name) {
  emit('update:selected', name)
  query.value = ''
}
function chooseFirst() {
  if (visibleOptions.value.length) choose(visibleOptions.value[0].name)
}
function fmt(value) { return Number(value).toLocaleString() }
function percent(value, digits = 2) {
  const threshold = 10 ** -digits
  return value > 0 && value < threshold ? `<${threshold.toFixed(digits)}%` : `${value.toFixed(digits)}%`
}
function fmtWeek(weekEnd) {
  return new Date(`${weekEnd}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
</script>

<template>
  <div class="category-detail">
    <label class="category-label" :for="`academic-category-${kind}`">Explore a {{ label }}</label>
    <input
      :id="`academic-category-${kind}`"
      v-model="query"
      type="search"
      class="category-search"
      :placeholder="`Search ${options.length.toLocaleString()} ${kind === 'department' ? 'Departments' : 'disciplines'}…`"
      :aria-label="`Search ${label}s`"
      @keydown.enter.prevent="chooseFirst"
    />
    <div v-if="visibleOptions.length" class="category-options" :aria-label="`${label} choices`">
      <button
        v-for="item in visibleOptions"
        :key="item.name"
        type="button"
        class="category-choice"
        :class="{ active: item.name === selectedName }"
        :aria-pressed="item.name === selectedName"
        @click="choose(item.name)"
      >
        <span>{{ item.name }}</span><span class="fa-num">{{ fmt(item.count) }}</span>
      </button>
    </div>
    <p v-else class="fa-meta category-empty">No matching {{ label }} in this snapshot.</p>

    <div v-if="current" class="category-summary" aria-live="polite">
      <div class="fa-meta">Selected {{ label }}</div>
      <h3 class="fa-display category-name">{{ selectedName }}</h3>
      <div class="category-metrics">
        <div><strong class="fa-display">{{ fmt(current.count) }}</strong><span class="fa-meta">open listings</span></div>
        <div><strong class="fa-num">{{ shareOfClassified }}</strong><span class="fa-meta">of identified {{ label }} listings</span></div>
        <div><strong class="fa-num">{{ percent(current.sharePct) }}</strong><span class="fa-meta">of all tracked listings</span></div>
      </div>
      <p v-if="delta != null" class="fa-meta category-change">{{ delta >= 0 ? '+' : '' }}{{ fmt(delta) }} listings versus the prior recorded week</p>
      <div class="category-chart-head">
        <div class="fa-meta">Weekly share of all listings</div>
        <div class="fa-meta">{{ chart.length }} recorded {{ chart.length === 1 ? 'week' : 'weeks' }}</div>
      </div>
      <div
        class="category-chart"
        role="img"
        :aria-label="`${selectedName} weekly listings: ${chart.map((point) => `${fmtWeek(point.weekEnd)} ${fmt(point.count)} listings, ${percent(point.sharePct)} of all listings`).join('; ')}`"
      >
        <div v-for="point in chart" :key="point.weekEnd" class="category-chart-week" :title="`${fmtWeek(point.weekEnd)}: ${fmt(point.count)} listings (${percent(point.sharePct)})`">
          <span class="category-chart-count fa-num">{{ fmt(point.count) }}</span>
          <span class="category-chart-track"><span :style="{ height: point.height }"></span></span>
          <span class="category-chart-date fa-meta">{{ fmtWeek(point.weekEnd) }}</span>
        </div>
      </div>
      <p class="fa-meta category-note">Bar heights compare the recorded weeks for this selection.</p>
      <p v-if="chart.length === 1" class="fa-meta category-note">Named-category tracking starts with this digest. Earlier counts were not recorded.</p>
      <p class="fa-meta category-note">Counts use the exact category names stored with each listing; differently worded names appear separately.</p>
    </div>
  </div>
</template>

<style scoped>
.category-detail { margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--rule); }
.category-label { display: block; margin-bottom: 8px; color: var(--ink-2); font-size: 13px; font-weight: 700; }
.category-search { width: 100%; padding: 10px 12px; border: 1px solid var(--rule); border-radius: 4px; background: var(--paper); color: var(--ink); font: inherit; }
.category-search:focus-visible { outline: 2px solid var(--sage); outline-offset: 2px; }
.category-options { margin-top: 7px; border: 1px solid var(--rule-2); border-radius: 4px; overflow: hidden; }
.category-choice { display: flex; width: 100%; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 0; border-bottom: 1px solid var(--rule-2); background: var(--paper); color: var(--ink-2); text-align: left; cursor: pointer; font: inherit; font-size: 12px; }
.category-choice:last-child { border-bottom: 0; }
.category-choice:hover, .category-choice:focus-visible, .category-choice.active { background: var(--paper-3); }
.category-choice span:first-child { overflow-wrap: anywhere; }
.category-choice .fa-num { white-space: nowrap; }
.category-empty { margin: 9px 0 0; color: var(--ink-4); }
.category-summary { margin-top: 20px; padding: 16px; border: 1px solid var(--rule); background: var(--paper-2); }
.category-name { margin: 5px 0 16px; font-size: 23px; line-height: 1.2; overflow-wrap: anywhere; }
.category-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.category-metrics > div { display: flex; flex-direction: column; gap: 3px; }
.category-metrics strong { font-size: 21px; font-weight: 600; }
.category-metrics .fa-meta { color: var(--ink-4); line-height: 1.35; }
.category-change { margin: 14px 0 0; color: var(--sage); }
.category-chart-head { display: flex; justify-content: space-between; gap: 10px; margin-top: 22px; }
.category-chart { display: flex; align-items: stretch; gap: 5px; height: 128px; margin-top: 10px; }
.category-chart-week { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
.category-chart-count, .category-chart-date { color: var(--ink-4); font-size: 10px; white-space: nowrap; }
.category-chart-week:not(:first-child):not(:last-child) .category-chart-date { visibility: hidden; }
.category-chart-track { display: flex; flex: 1; width: min(100%, 30px); align-items: flex-end; background: var(--paper-3); }
.category-chart-track > span { display: block; width: 100%; background: var(--sage); }
.category-note { margin: 12px 0 0; color: var(--ink-4); line-height: 1.5; }
@media (max-width: 600px) { .category-metrics { grid-template-columns: 1fr 1fr; } .category-chart-count { font-size: 9px; } }
</style>
