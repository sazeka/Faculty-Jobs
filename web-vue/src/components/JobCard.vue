<script setup>
const props = defineProps({
  job:      { type: Object,  required: true },
  index:    { type: Number,  default: 0 },
  saved:    { type: Boolean, default: false },
  emphasized: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle-save', 'hover-college', 'report-bad-listing'])

function getDeadlineLabel(job) {
  if (job.openUntilFilled) return 'Rolling'
  if (job.closeDateRaw)    return job.closeDateRaw
  if (job.closeDate) {
    const s = String(job.closeDate)
    // Parse date-only (YYYY-MM-DD) as local midnight, else it renders a day early
    // in negative-offset timezones.
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
  }
  return null
}

function trackLabel(job) {
  if (job.tenureTrack === true)  return 'Tenure-Track'
  if (job.tenureTrack === false) return 'Non-Tenure'
  return null
}

// "Posted {date}" from the real source date (datePosted) when we have it,
// otherwise "Listed {date}" from when our scrape first saw it (firstSeen).
function getPostedLabel(job) {
  const raw = job.datePosted || job.firstSeen
  if (!raw) return null
  const s = String(raw)
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s)
  if (Number.isNaN(d.getTime())) return null
  return {
    verb: job.datePosted ? 'Posted' : 'Listed',
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  }
}

function indexStr(n) {
  return String(n + 1).padStart(5, '0')
}
</script>

<template>
  <article
    class="fa-listing"
    :class="{ 'fa-listing-emphasized': props.emphasized }"
    @mouseenter="emit('hover-college', props.job.college || null)"
    @mouseleave="emit('hover-college', null)"
  >
    <!-- № -->
    <div class="fa-listing-num">№ {{ indexStr(props.index) }}</div>

    <!-- Title + institution -->
    <div>
      <div class="fa-listing-title">
        {{ props.job.title }}
        <i v-if="trackLabel(props.job)" style="font-size: 0.8em; color: var(--ink-3);">
          ({{ trackLabel(props.job) }})
        </i>
      </div>
      <div class="fa-listing-inst">
        {{ props.job.college }}
        <span v-if="props.job.department" class="fa-meta" style="font-style: normal; font-size: 11px;">
          · {{ props.job.department }}
        </span>
      </div>
      <div style="display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap;">
        <span v-if="props.job._isNew" class="fa-tag fa-tag-accent">New</span>
        <span
          v-for="pt in (props.job.positionTypes || []).filter((p) => p && p !== 'Faculty')"
          :key="pt"
          class="fa-tag"
        >
          {{ pt }}
        </span>
        <span v-if="props.job.duplicateCount > 1" class="fa-tag">
          {{ props.job.duplicateCount }}x grouped
        </span>
      </div>
    </div>

    <!-- Location -->
    <div>
      <div class="fa-listing-meta" style="color: var(--ink-2); font-size: 12px;">
        {{ props.job.location || props.job.state || '—' }}
      </div>
      <div v-if="props.job.state" class="fa-listing-coord">{{ props.job.state }}</div>
      <div v-if="getPostedLabel(props.job)" class="fa-meta" style="font-size: 10px; margin-top: 4px; color: var(--ink-3);"
        :title="getPostedLabel(props.job).verb === 'Posted' ? 'Posting date from the source listing' : 'Date this listing was first seen by Faculty Atlas'">
        {{ getPostedLabel(props.job).verb }} {{ getPostedLabel(props.job).date }}
      </div>
    </div>

    <!-- Deadline -->
    <div>
      <div class="fa-meta" style="font-size: 10px; margin-bottom: 4px;">DEADLINE</div>
      <div v-if="getDeadlineLabel(props.job)" class="fa-display" style="font-size: 20px;">
        {{ getDeadlineLabel(props.job) }}
      </div>
      <div v-else class="fa-meta">—</div>
    </div>

    <!-- Actions -->
    <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end;">
      <a
        :href="props.job.url"
        target="_blank"
        rel="noreferrer"
        class="fa-listing-arrow"
        :aria-label="`Open posting: ${props.job.title}`"
        @click.stop
      >→</a>
      <button
        type="button"
        class="fa-meta"
        style="background: none; border: none; cursor: pointer; padding: 0; color: var(--ink-3); font-size: 10px; letter-spacing: 0.08em;"
        :style="{ color: props.saved ? 'var(--accent)' : 'var(--ink-3)' }"
        @click.stop="emit('toggle-save', props.job.url)"
      >{{ props.saved ? '★' : '☆' }}</button>
    </div>
  </article>
</template>

<style scoped>
.fa-listing-emphasized { background: rgba(122, 31, 35, 0.04); }
</style>
