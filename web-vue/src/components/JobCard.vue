<script setup>
const props = defineProps({
  job: { type: Object, required: true },
  saved: { type: Boolean, default: false },
  emphasized: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle-save', 'hover-college'])

function getDeadlineLabel(job) {
  if (job.openUntilFilled) return 'Open until filled'
  if (job.closeDateRaw) return job.closeDateRaw
  if (job.closeDate) {
    const parsed = new Date(job.closeDate)
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString()
  }
  return null
}
</script>

<template>
  <article
    class="card"
    :class="{ 'state-focus': props.emphasized }"
    @mouseenter="emit('hover-college', props.job.college || null)"
    @mouseleave="emit('hover-college', null)"
  >
    <h2>{{ props.job.title }}</h2>
    <section
      v-if="props.job.positionType || props.job.tenureTrack !== null || props.job.location || getDeadlineLabel(props.job)"
      class="quick-facts"
    >
      <article v-if="props.job.positionType" class="quick-fact">
        <span class="k">Rank</span>
        <span class="v">{{ props.job.positionType }}</span>
      </article>
      <article v-if="props.job.tenureTrack === true" class="quick-fact positive">
        <span class="k">Track</span>
        <span class="v">Tenure Track</span>
      </article>
      <article v-else-if="props.job.tenureTrack === false" class="quick-fact neutral">
        <span class="k">Track</span>
        <span class="v">Non-Tenure</span>
      </article>
      <article v-if="props.job.location" class="quick-fact">
        <span class="k">Location</span>
        <span class="v">{{ props.job.location }}</span>
      </article>
      <article v-if="getDeadlineLabel(props.job)" class="quick-fact">
        <span class="k">Deadline</span>
        <span class="v">{{ getDeadlineLabel(props.job) }}</span>
      </article>
    </section>
    <p class="meta-strip">
      <span class="meta-pill">{{ props.job.state || 'N/A' }}</span>
      <span class="meta-pill">{{ props.job.positionType || 'Faculty' }}</span>
      <span v-if="props.job.tenureTrack === true" class="meta-pill">Tenure Track</span>
      <span v-else-if="props.job.tenureTrack === false" class="meta-pill">Non-Tenure</span>
    </p>
    <section v-if="props.job.college || props.job.department || props.job.location || getDeadlineLabel(props.job)" class="info-grid">
      <template v-if="props.job.college">
        <span class="info-label">University</span>
        <span class="info-value">{{ props.job.college }}</span>
      </template>
      <template v-if="props.job.department">
        <span class="info-label">Department</span>
        <span class="info-value">{{ props.job.department }}</span>
      </template>
      <template v-if="props.job.location">
        <span class="info-label">Location</span>
        <span class="info-value">{{ props.job.location }}</span>
      </template>
      <template v-if="getDeadlineLabel(props.job)">
        <span class="info-label">Deadline</span>
        <span class="info-value">{{ getDeadlineLabel(props.job) }}</span>
      </template>
    </section>
    <p v-if="props.job.description" class="description">{{ props.job.description }}</p>
    <details v-if="props.job.summary" class="summary-box">
      <summary>AI Summary</summary>
      <p>{{ props.job.summary }}</p>
    </details>
    <div class="card-actions">
      <a :href="props.job.url" target="_blank" rel="noreferrer">View Position</a>
      <button type="button" :class="{ saved: props.saved }" @click="emit('toggle-save', props.job.url)">
        {{ props.saved ? 'Saved' : 'Save' }}
      </button>
    </div>
  </article>
</template>
