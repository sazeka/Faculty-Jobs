<script setup>
const props = defineProps({
  chips: { type: Array, required: true },
})

const emit = defineEmits(['clear-chip'])
</script>

<template>
  <section v-if="props.chips.length" class="active-filters">
    <span v-for="chip in props.chips" :key="chip.key" class="filter-chip">
      {{ chip.label }}
      <button type="button" @click="emit('clear-chip', chip.key)">x</button>
    </span>
  </section>
</template>
