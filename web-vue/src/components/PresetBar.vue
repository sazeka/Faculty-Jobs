<script setup>
const props = defineProps({
  items: { type: Array, required: true },
  hasActiveFilters: { type: Boolean, default: false },
})

const emit = defineEmits(['save-current', 'apply-preset', 'remove-preset'])
</script>

<template>
  <div v-if="props.items.length || props.hasActiveFilters" class="preset-bar" aria-label="Saved searches">
    <div class="preset-label">Saved searches</div>
    <div class="preset-list">
      <span v-for="item in props.items" :key="`${item.label}-${item.idx}`" class="preset-item">
        <button type="button" class="preset-apply" @click="emit('apply-preset', item.preset)">{{ item.label }}</button>
        <button type="button" class="preset-remove" :aria-label="`Remove saved search: ${item.label}`" @click="emit('remove-preset', item.idx)">×</button>
      </span>
      <button v-if="props.hasActiveFilters" type="button" class="preset-save" @click="emit('save-current')">＋ Save this search</button>
    </div>
  </div>
</template>

<style scoped>
.preset-bar { display: flex; align-items: center; gap: 14px; margin: 12px 0 18px; padding: 10px 0; border-top: 1px solid var(--rule-2); border-bottom: 1px solid var(--rule-2); }
.preset-label { flex: 0 0 auto; color: var(--ink-3); font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; }
.preset-list { display: flex; flex-wrap: wrap; gap: 6px; }
.preset-item { display: inline-flex; border: 1px solid var(--rule-2); background: var(--paper); }
.preset-apply, .preset-remove, .preset-save { appearance: none; border: 0; padding: 5px 8px; color: var(--ink-2); background: none; cursor: pointer; font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.04em; }
.preset-remove { border-left: 1px solid var(--rule-2); color: var(--ink-4); }
.preset-save { border: 1px dashed var(--rule); }
.preset-apply:hover, .preset-remove:hover, .preset-save:hover,
.preset-apply:focus-visible, .preset-remove:focus-visible, .preset-save:focus-visible { color: var(--accent); background: var(--paper-2); outline: none; }
@media (max-width: 700px) { .preset-bar { align-items: flex-start; flex-direction: column; gap: 8px; } }
</style>
