<script setup>
import { ref } from 'vue'

const props = defineProps({
  matchCount: { type: Number, default: 0 },
  status: { type: String, default: 'idle' },
  error: { type: String, default: '' },
})
const emit = defineEmits(['subscribe'])
const expanded = ref(false)
const email = ref('')

function submit() {
  if (email.value.trim()) emit('subscribe', email.value.trim())
}
</script>

<template>
  <section class="alert-signup" aria-label="Job alert for this search">
    <div>
      <strong class="fa-display">Get new matches in your inbox.</strong>
      <span class="fa-meta">Track this search across {{ props.matchCount.toLocaleString() }} current results.</span>
    </div>
    <button v-if="!expanded && props.status !== 'success'" type="button" class="fa-btn" @click="expanded = true">Create alert for this search</button>
    <form v-else-if="props.status !== 'success'" class="alert-form" @submit.prevent="submit">
      <label class="fa-sr-only" for="results-alert-email">Email address</label>
      <input id="results-alert-email" v-model="email" class="fa-input" type="email" autocomplete="email" required placeholder="you@university.edu" :disabled="props.status === 'pending'" />
      <button class="fa-btn" type="submit" :disabled="props.status === 'pending'">{{ props.status === 'pending' ? 'Sending…' : 'Send confirmation' }}</button>
      <span v-if="props.status === 'error'" class="alert-error" role="alert">{{ props.error }}</span>
    </form>
    <div v-else class="alert-success" role="status">Check your inbox to confirm your alert.</div>
  </section>
</template>

<style scoped>
.alert-signup { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin: 0 0 18px; padding: 14px 16px; border: 1px solid var(--rule-2); background: var(--paper-2); }
.alert-signup > div:first-child { display: flex; flex-direction: column; gap: 3px; }
.alert-signup strong { font-size: 17px; }
.alert-form { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.alert-form .fa-input { width: min(260px, 100%); }
.alert-error { width: 100%; color: #b3261e; font-size: 12px; text-align: right; }
.alert-success { color: var(--sage); font-size: 13px; }
@media (max-width: 760px) {
  .alert-signup { align-items: stretch; flex-direction: column; }
  .alert-form { justify-content: stretch; }
  .alert-form .fa-input, .alert-form .fa-btn { width: 100%; justify-content: center; }
}
</style>
