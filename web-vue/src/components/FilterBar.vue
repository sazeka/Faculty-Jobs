<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  filters: { type: Object, required: true },
  stateOptions: { type: Array, required: true },
  positionTypeOptions: { type: Array, required: true },
  disciplineOptions: { type: Array, default: () => [] },
  collegeOptions: { type: Array, required: true },
  departmentOptions: { type: Array, required: true },
  cityOptions: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:filters', 'reset-filters', 'refresh-data', 'save-alert'])

const disciplineSearch = ref('')

const filteredDisciplineOptions = computed(() => {
  const q = disciplineSearch.value.trim().toLowerCase()
  if (!q) return props.disciplineOptions
  return props.disciplineOptions.filter(opt => opt.value.toLowerCase().includes(q))
})

// Full list of states (university systems are grouped into their state upstream),
// alphabetized; show any state that currently has matches plus the active one.
const statesForFilter = computed(() =>
  props.stateOptions
    .filter((o) => o.count > 0 || o.value === props.filters.state)
    .slice()
    .sort((a, b) => String(a.value).localeCompare(String(b.value)))
)

function updateField(key, value) {
  emit('update:filters', { [key]: value })
}

function toggleState(value) {
  updateField('state', props.filters.state === value ? 'all' : value)
}
function togglePositionType(value) {
  updateField('positionType', props.filters.positionType === value ? 'all' : value)
}
function toggleDiscipline(value) {
  updateField('discipline', props.filters.discipline === value ? 'all' : value)
}
</script>

<template>
  <div class="fa-sidebar-inner">
    <div class="fa-label" style="margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid var(--rule)">
      Refine
    </div>

    <!-- Search -->
    <div style="margin-bottom: 28px;">
      <div class="fa-display" style="font-size: 18px; margin-bottom: 10px;">Search</div>
      <input
        class="fa-input"
        :value="props.filters.q"
        type="search"
        placeholder="Title, university, department…"
        aria-label="Search jobs"
        @input="updateField('q', $event.target.value)"
      />
    </div>

    <!-- Discipline -->
    <div style="margin-bottom: 28px;">
      <div class="fa-display" style="font-size: 18px; margin-bottom: 10px;">Discipline</div>
      <input
        class="fa-input"
        v-model="disciplineSearch"
        type="search"
        placeholder="Search disciplines…"
        aria-label="Search disciplines"
        style="font-size: 13px; margin-bottom: 8px;"
      />
      <div style="display: flex; flex-direction: column; gap: 4px; max-height: 200px; overflow-y: auto;">
        <label
          v-for="opt in filteredDisciplineOptions"
          :key="opt.value"
          class="fa-facet-item"
          :class="{ active: filters.discipline === opt.value }"
          @click="toggleDiscipline(opt.value)"
        >
          <span class="fa-check" :class="{ checked: filters.discipline === opt.value }">
            {{ filters.discipline === opt.value ? '✓' : '' }}
          </span>
          <span style="flex: 1;">{{ opt.value }}</span>
          <span class="fa-meta" style="font-size: 10px;">{{ opt.count }}</span>
        </label>
        <div v-if="filteredDisciplineOptions.length === 0" class="fa-meta" style="padding: 4px 0; font-style: italic;">No match</div>
      </div>
    </div>

    <!-- Position Type -->
    <div style="margin-bottom: 28px;">
      <div class="fa-display" style="font-size: 18px; margin-bottom: 12px;">Rank</div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label
          v-for="opt in positionTypeOptions.slice(0, 8)"
          :key="opt.value"
          class="fa-facet-item"
          :class="{ active: filters.positionType === opt.value }"
          @click="togglePositionType(opt.value)"
        >
          <span class="fa-check" :class="{ checked: filters.positionType === opt.value }">
            {{ filters.positionType === opt.value ? '✓' : '' }}
          </span>
          <span style="flex: 1;">{{ opt.label }}</span>
          <span class="fa-meta" style="font-size: 10px;">{{ opt.count }}</span>
        </label>
      </div>
    </div>

    <!-- Tenure Track -->
    <div style="margin-bottom: 28px;">
      <div class="fa-display" style="font-size: 18px; margin-bottom: 12px;">Track</div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label class="fa-facet-item" :class="{ active: filters.tenureTrackOnly }" @click="updateField('tenureTrackOnly', !filters.tenureTrackOnly)">
          <span class="fa-check" :class="{ checked: filters.tenureTrackOnly }">{{ filters.tenureTrackOnly ? '✓' : '' }}</span>
          <span style="flex: 1;">Tenure-Track only</span>
        </label>
      </div>
    </div>

    <!-- State -->
    <div style="margin-bottom: 28px;">
      <div class="fa-display" style="font-size: 18px; margin-bottom: 12px;">State</div>
      <div style="display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto;">
        <label
          v-for="opt in statesForFilter"
          :key="opt.value"
          class="fa-facet-item"
          :class="{ active: filters.state === opt.value }"
          @click="toggleState(opt.value)"
        >
          <span class="fa-check" :class="{ checked: filters.state === opt.value }">
            {{ filters.state === opt.value ? '✓' : '' }}
          </span>
          <span style="flex: 1;">{{ opt.value }}</span>
          <span class="fa-meta" style="font-size: 10px;">{{ opt.count }}</span>
        </label>
      </div>
    </div>

    <!-- Quick toggles -->
    <div style="margin-bottom: 28px;">
      <div class="fa-display" style="font-size: 18px; margin-bottom: 12px;">View</div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label class="fa-facet-item" :class="{ active: filters.newOnly }" @click="updateField('newOnly', !filters.newOnly)">
          <span class="fa-check" :class="{ checked: filters.newOnly }">{{ filters.newOnly ? '✓' : '' }}</span>
          <span style="flex: 1;">New since last visit</span>
        </label>
        <label class="fa-facet-item" :class="{ active: filters.savedOnly }" @click="updateField('savedOnly', !filters.savedOnly)">
          <span class="fa-check" :class="{ checked: filters.savedOnly }">{{ filters.savedOnly ? '✓' : '' }}</span>
          <span style="flex: 1;">Saved jobs only</span>
        </label>
      </div>
    </div>

    <!-- Actions -->
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <button class="fa-btn fa-btn-ghost" style="width: 100%; justify-content: center;" type="button" @click="emit('reset-filters')">
        Clear filters
      </button>
      <button class="fa-btn fa-btn-ghost" style="width: 100%; justify-content: center;" type="button" @click="emit('save-alert')">
        ⏿ Save alert
      </button>
    </div>
  </div>
</template>
