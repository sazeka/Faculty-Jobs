<script setup>
const props = defineProps({
  chips: { type: Array, required: true },
})

const emit = defineEmits(['clear-chip'])
</script>

<template>
  <section v-if="props.chips.length" class="active-filters">
    <span v-for="chip in props.chips" :key="chip.id || chip.key" class="filter-chip">
      {{ chip.label }}
      <button type="button" :aria-label="`Remove ${chip.label} filter`" @click="emit('clear-chip', chip.key, chip.value)">x</button>
    </span>
  </section>
</template>
