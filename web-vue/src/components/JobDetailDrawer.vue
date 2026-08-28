<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({
  job: { type: Object, required: true },
  saved: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'toggle-save', 'report-bad-listing'])
const drawer = ref(null)
let previousBodyOverflow = ''

function formatDate(value) {
  if (!value) return null
  const text = String(value)
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text)
  if (Number.isNaN(parsed.getTime())) return text
  return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

const posted = computed(() => formatDate(props.job.datePosted || props.job.firstSeen))
const deadline = computed(() => props.job.openUntilFilled ? 'Rolling / open until filled' : formatDate(props.job.closeDate) || props.job.closeDateRaw || null)
const startDate = computed(() => formatDate(props.job.startDate))
const positionTypes = computed(() => (props.job.positionTypes || []).filter((value) => value && value !== 'Faculty'))
const description = computed(() => String(props.job.description || props.job.summary || '').replace(/\s+/g, ' ').trim())
const salary = computed(() => props.job.salaryText || props.job.salary || null)

function onKeydown(event) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  window.addEventListener('keydown', onKeydown)
  requestAnimationFrame(() => drawer.value?.focus())
})
onUnmounted(() => {
  document.body.style.overflow = previousBodyOverflow
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="detail-backdrop" @click.self="emit('close')">
    <aside ref="drawer" class="detail-drawer" role="dialog" aria-modal="true" tabindex="-1" :aria-label="`Job details: ${props.job.title}`">
      <div class="detail-topbar">
        <div class="fa-label">Posting details</div>
        <button type="button" class="detail-close" aria-label="Close job details" @click="emit('close')">✕</button>
      </div>

      <div class="detail-heading">
        <h2 class="fa-display">{{ props.job.title }}</h2>
        <p class="detail-institution">{{ props.job.college }}</p>
        <p v-if="props.job.department" class="fa-meta detail-department">{{ props.job.department }}</p>
      </div>

      <div class="detail-tags">
        <span v-if="props.job.tenureTrack === true" class="fa-tag fa-tag-accent">Tenure-Track</span>
        <span v-else-if="props.job.tenureTrack === false" class="fa-tag">Non-Tenure</span>
        <span v-for="type in positionTypes" :key="type" class="fa-tag">{{ type }}</span>
        <span v-if="props.job.discipline" class="fa-tag">{{ props.job.discipline }}</span>
      </div>

      <dl class="detail-facts">
        <div><dt>Location</dt><dd>{{ props.job.location || props.job.state || 'Not provided' }}</dd></div>
        <div><dt>{{ props.job.datePosted ? 'Posted' : 'Atlas listed' }}</dt><dd>{{ posted || 'Not provided' }}</dd></div>
        <div><dt>Deadline</dt><dd>{{ deadline || 'Not provided' }}</dd></div>
        <div v-if="startDate"><dt>Anticipated start</dt><dd>{{ startDate }}</dd></div>
        <div v-if="salary"><dt>Salary</dt><dd>{{ salary }}</dd></div>
      </dl>

      <section class="detail-description">
        <div class="fa-label">Position summary</div>
        <p v-if="description">{{ description }}</p>
        <p v-else class="detail-muted">A description was not available in the source feed. Open the official posting for complete requirements.</p>
      </section>

      <div class="detail-actions">
        <a v-if="props.job.linkQuality !== 'invalid'" :href="props.job.url" target="_blank" rel="noreferrer" class="fa-btn">Apply on university site →</a>
        <button type="button" class="fa-btn fa-btn-ghost" @click="emit('toggle-save', props.job.url)">
          {{ props.saved ? '♥ Saved' : '♡ Save job' }}
        </button>
        <button type="button" class="detail-report" @click="emit('report-bad-listing', props.job)">Report broken or outdated listing</button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.detail-backdrop { position: fixed; inset: 0; z-index: 1200; display: flex; justify-content: flex-end; background: rgba(21, 17, 13, 0.58); backdrop-filter: blur(2px); }
.detail-drawer { width: min(680px, 94vw); height: 100%; overflow-y: auto; padding: 28px 42px 48px; border-left: 1px solid var(--rule); background: var(--paper); box-shadow: -20px 0 60px rgba(21, 17, 13, 0.2); }
.detail-drawer:focus { outline: none; }
.detail-topbar { display: flex; align-items: center; justify-content: space-between; }
.detail-close { appearance: none; border: 0; padding: 6px; color: var(--ink-3); background: none; cursor: pointer; font-size: 18px; }
.detail-close:hover, .detail-close:focus-visible { color: var(--accent); outline: 1px solid currentColor; }
.detail-heading { padding: 44px 0 24px; border-bottom: 1px solid var(--rule); }
.detail-heading h2 { margin: 0; font-size: clamp(42px, 6vw, 72px); line-height: 0.96; }
.detail-institution { margin: 18px 0 0; color: var(--ink-2); font-size: 20px; font-style: italic; }
.detail-department { margin: 7px 0 0; }
.detail-tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 18px 0; }
.detail-facts { display: grid; grid-template-columns: 1fr 1fr; margin: 0; border-top: 1px solid var(--rule-2); }
.detail-facts > div { padding: 18px 14px 18px 0; border-bottom: 1px solid var(--rule-2); }
.detail-facts dt { margin-bottom: 5px; color: var(--ink-3); font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; }
.detail-facts dd { margin: 0; font-family: var(--font-display); font-size: 21px; }
.detail-description { padding: 32px 0; }
.detail-description p { margin: 14px 0 0; color: var(--ink-2); font-size: 16px; line-height: 1.72; white-space: pre-wrap; }
.detail-description .detail-muted { color: var(--ink-3); font-style: italic; }
.detail-actions { display: flex; flex-wrap: wrap; gap: 10px; padding-top: 22px; border-top: 1px solid var(--rule); }
.detail-report { width: 100%; margin-top: 8px; border: 0; padding: 4px 0; color: var(--ink-3); background: none; cursor: pointer; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-align: left; text-transform: uppercase; }
.detail-report:hover, .detail-report:focus-visible { color: var(--accent); outline: none; text-decoration: underline; }
@media (max-width: 640px) {
  .detail-drawer { width: 100%; padding: 22px 20px 40px; }
  .detail-heading { padding-top: 28px; }
  .detail-facts { grid-template-columns: 1fr; }
  .detail-actions .fa-btn { width: 100%; justify-content: center; }
}
</style>
