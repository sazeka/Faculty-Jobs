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

// Soft "anticipated start" — startDate is either YYYY-MM-DD (format it) or a
// season/month string like "Fall 2026" (show as-is).
function getStartLabel(job) {
  const s = job.startDate
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00')
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
  }
  return String(s)
}

</script>

<template>
  <article
    class="fa-listing"
    :class="{ 'fa-listing-emphasized': props.emphasized }"
    @mouseenter="emit('hover-college', props.job.college || null)"
    @mouseleave="emit('hover-college', null)"
  >
    <div class="fa-listing-main">
      <a
        v-if="props.job.linkQuality !== 'invalid'"
        :href="props.job.url"
        target="_blank"
        rel="noreferrer"
        class="fa-listing-title"
        :aria-label="`Open posting: ${props.job.title}`"
      >{{ props.job.title }}</a>
      <div v-else class="fa-listing-title">{{ props.job.title }}</div>

      <div class="fa-listing-inst">
        {{ props.job.college || 'Institution not specified' }}
        <span v-if="props.job.location || props.job.state"> · {{ props.job.location || props.job.state }}</span>
      </div>

      <div class="fa-listing-tags">
        <span v-if="props.job.isClosed" class="fa-tag fa-tag-closed">Closed</span>
        <span v-if="props.job.isNew" class="fa-tag fa-tag-accent" title="First cataloged by Faculty Atlas since your previous visit">New to Atlas</span>
        <span v-if="trackLabel(props.job)" class="fa-tag">{{ trackLabel(props.job) }}</span>
        <span v-for="pt in (props.job.positionTypes || []).filter((p) => p && p !== 'Faculty').slice(0, 2)" :key="pt" class="fa-tag">{{ pt }}</span>
        <span v-if="props.job.discipline" class="fa-tag">{{ props.job.discipline }}</span>
        <span v-if="props.job.duplicateCount > 1" class="fa-tag">{{ props.job.duplicateCount }} grouped</span>
        <span v-for="badge in props.job.confidenceBadges || []" :key="badge.label" class="fa-tag fa-tag-warning" :title="badge.detail || badge.label">⚠ {{ badge.label }}</span>
      </div>
    </div>

    <div class="fa-listing-side">
      <button type="button" class="fa-save-button" :class="{ saved: props.saved }" :aria-label="props.saved ? 'Remove saved job' : 'Save job'" @click.stop="emit('toggle-save', props.job.url)">
        {{ props.saved ? '♥' : '♡' }}
      </button>
      <div class="fa-listing-date" :title="getPostedLabel(props.job)?.verb">
        {{ getPostedLabel(props.job)?.date || 'Date unavailable' }}
      </div>
      <div v-if="getDeadlineLabel(props.job)" class="fa-listing-deadline">Deadline {{ getDeadlineLabel(props.job) }}</div>
      <div v-else-if="getStartLabel(props.job)" class="fa-listing-deadline">Starts {{ getStartLabel(props.job) }}</div>
    </div>
  </article>
</template>

<style scoped>
.fa-listing-emphasized { background: rgba(46, 113, 151, 0.06); }
.fa-tag-warning {
  color: #8a4b12 !important;
  background: rgba(180, 104, 30, 0.1) !important;
}
</style>
