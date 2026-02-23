<script setup>
const props = defineProps({
  items: { type: Array, required: true },
})

const emit = defineEmits(['save-current', 'apply-preset', 'remove-preset'])
</script>

<template>
  <button type="button" @click="emit('save-current')">Save Current Preset</button>
  <span v-if="props.items.length === 0" class="muted">No saved presets yet.</span>
  <div v-else class="preset-list">
    <span v-for="item in props.items" :key="`${item.label}-${item.idx}`" class="preset-item">
      <button type="button" class="preset-apply" @click="emit('apply-preset', item.preset)">
        {{ item.label }}
      </button>
      <button type="button" class="preset-remove" @click="emit('remove-preset', item.idx)">x</button>
    </span>
  </div>
</template>
