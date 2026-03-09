<script setup>
const props = defineProps({
  filters: { type: Object, required: true },
  stateOptions: { type: Array, required: true },
  positionTypeOptions: { type: Array, required: true },
  collegeOptions: { type: Array, required: true },
  showSearch: { type: Boolean, default: true },
})

const emit = defineEmits(['update:filters', 'reset-filters', 'refresh-data', 'save-alert'])

function updateField(key, value) {
  emit('update:filters', { [key]: value })
}
</script>

<template>
  <input
    v-if="props.showSearch"
    :value="props.filters.q"
    type="search"
    placeholder="Search title, university, department, state..."
    @input="updateField('q', $event.target.value)"
  />

  <select :value="props.filters.state" @change="updateField('state', $event.target.value)">
    <option value="all">All States ({{ props.stateOptions.reduce((sum, option) => sum + option.count, 0) }})</option>
    <option
      v-for="option in props.stateOptions"
      :key="option.value"
      :value="option.value"
      :disabled="option.disabled"
      :title="option.fullLabel || option.label"
    >
      {{ option.label }}
    </option>
  </select>

  <select :value="props.filters.positionType" @change="updateField('positionType', $event.target.value)">
    <option value="all">All Position Types ({{ props.positionTypeOptions.reduce((sum, option) => sum + option.count, 0) }})</option>
    <option
      v-for="option in props.positionTypeOptions"
      :key="option.value"
      :value="option.value"
      :disabled="option.disabled"
      :title="option.fullLabel || option.label"
    >
      {{ option.label }}
    </option>
  </select>

  <select :value="props.filters.college" @change="updateField('college', $event.target.value)">
    <option value="all">All Universities ({{ props.collegeOptions.reduce((sum, option) => sum + option.count, 0) }})</option>
    <option
      v-for="option in props.collegeOptions"
      :key="option.value"
      :value="option.value"
      :disabled="option.disabled"
      :title="option.fullLabel || option.label"
    >
      {{ option.label }}
    </option>
  </select>

  <select :value="props.filters.sortBy" @change="updateField('sortBy', $event.target.value)">
    <option value="relevance">Sort: Relevance</option>
    <option value="title-asc">Sort: Title A-Z</option>
    <option value="title-desc">Sort: Title Z-A</option>
    <option value="university">Sort: University</option>
    <option value="state">Sort: State</option>
  </select>

  <label class="check">
    <input
      :checked="props.filters.tenureTrackOnly"
      type="checkbox"
      @change="updateField('tenureTrackOnly', $event.target.checked)"
    />
    Tenure Track Only
  </label>
  <label class="check">
    <input
      :checked="props.filters.savedOnly"
      type="checkbox"
      @change="updateField('savedOnly', $event.target.checked)"
    />
    Saved Jobs Only
  </label>
  <label class="check">
    <input
      :checked="props.filters.newOnly"
      type="checkbox"
      @change="updateField('newOnly', $event.target.checked)"
    />
    New Since Last Visit
  </label>

  <button type="button" @click="emit('reset-filters')">Clear Filters</button>
  <button type="button" @click="emit('save-alert')">Save Alert</button>
  <button type="button" @click="emit('refresh-data')">Refresh Data</button>
</template>
