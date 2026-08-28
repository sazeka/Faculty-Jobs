<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  filters: { type: Object, required: true },
  queryInput: { type: String, default: '' },
  stateOptions: { type: Array, required: true },
  positionTypeOptions: { type: Array, required: true },
  tenureTrackCount: { type: Number, default: 0 },
  disciplineOptions: { type: Array, default: () => [] },
  collegeOptions: { type: Array, required: true },
  departmentOptions: { type: Array, required: true },
  cityOptions: { type: Array, default: () => [] },
  subscribeStatus: { type: String, default: 'idle' }, // 'idle' | 'pending' | 'success' | 'error'
  subscribeError: { type: String, default: '' },
})

const emit = defineEmits(['update:filters', 'update:query', 'reset-filters', 'refresh-data', 'subscribe-alert'])

const disciplineSearch = ref('')
const collegeSearch = ref('')
const departmentSearch = ref('')
const citySearch = ref('')
const showAllDisciplines = ref(false)
const showAllRanks = ref(false)
const showAllStates = ref(false)
const showSubscribePanel = ref(false)
const subscribeEmail = ref('')

function submitSubscribe() {
  if (!subscribeEmail.value.trim()) return
  emit('subscribe-alert', subscribeEmail.value.trim())
}

const filteredDisciplineOptions = computed(() => {
  const q = disciplineSearch.value.trim().toLowerCase()
  if (!q) return props.disciplineOptions
  return props.disciplineOptions.filter(opt => opt.value.toLowerCase().includes(q))
})

// Institution list can run into the hundreds — only show matches once the
// user has typed something, same reasoning as the discipline search box.
// When nothing is typed, still surface the active selection (e.g. made via
// the map) so it can be reviewed or cleared from here too.
const filteredCollegeOptions = computed(() => {
  const q = collegeSearch.value.trim().toLowerCase()
  if (!q) {
    if (props.filters.college === 'all') return []
    const active = props.collegeOptions.find((opt) => opt.value === props.filters.college)
    return active ? [active] : []
  }
  return props.collegeOptions.filter(opt => opt.value.toLowerCase().includes(q)).slice(0, 25)
})

function searchableOptions(options, query, activeValue) {
  const q = query.trim().toLowerCase()
  if (!q) {
    if (activeValue === 'all') return []
    const active = options.find((opt) => opt.value === activeValue)
    return active ? [active] : []
  }
  return options.filter((opt) => opt.value.toLowerCase().includes(q)).slice(0, 25)
}

const filteredDepartmentOptions = computed(() =>
  searchableOptions(props.departmentOptions, departmentSearch.value, props.filters.department)
)
const filteredCityOptions = computed(() =>
  searchableOptions(props.cityOptions, citySearch.value, props.filters.city)
)

// Full list of states (university systems are grouped into their state upstream),
// alphabetized; show any state that currently has matches plus the active one.
const statesForFilter = computed(() =>
  props.stateOptions
    .filter((o) => o.count > 0 || o.value === props.filters.state)
    .slice()
    .sort((a, b) => String(a.value).localeCompare(String(b.value)))
)

function limitedOptions(options, expanded, activeValue, limit = 8) {
  if (expanded || options.length <= limit) return options
  const visible = options.slice(0, limit)
  const active = options.find((option) => option.value === activeValue)
  if (active && !visible.some((option) => option.value === active.value)) visible.push(active)
  return visible
}

const visibleDisciplineOptions = computed(() => {
  if (disciplineSearch.value.trim()) return filteredDisciplineOptions.value
  return limitedOptions(filteredDisciplineOptions.value, showAllDisciplines.value, props.filters.discipline)
})
const visibleRankOptions = computed(() =>
  limitedOptions(props.positionTypeOptions, showAllRanks.value, props.filters.positionType)
)
const visibleStateOptions = computed(() =>
  limitedOptions(statesForFilter.value, showAllStates.value, props.filters.state)
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
function toggleCollege(value) {
  updateField('college', props.filters.college === value ? 'all' : value)
  collegeSearch.value = ''
}
function toggleDepartment(value) {
  updateField('department', props.filters.department === value ? 'all' : value)
  departmentSearch.value = ''
}
function toggleCity(value) {
  updateField('city', props.filters.city === value ? 'all' : value)
  citySearch.value = ''
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
        :value="props.queryInput"
        type="search"
        placeholder="Title, university, department…"
        aria-label="Search jobs"
        @input="emit('update:query', $event.target.value)"
      />
    </div>

    <!-- Institution -->
    <div style="margin-bottom: 28px;">
      <div class="fa-display" style="font-size: 18px; margin-bottom: 10px;">Institution</div>
      <input
        class="fa-input"
        v-model="collegeSearch"
        type="search"
        placeholder="Search institutions…"
        aria-label="Search institutions"
        style="font-size: 13px; margin-bottom: 8px;"
      />
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label
          v-for="opt in filteredCollegeOptions"
          :key="opt.value"
          class="fa-facet-item"
          :class="{ active: filters.college === opt.value }"
          @click="toggleCollege(opt.value)"
        >
          <span class="fa-check" :class="{ checked: filters.college === opt.value }">
            {{ filters.college === opt.value ? '✓' : '' }}
          </span>
          <span style="flex: 1;">{{ opt.value }}</span>
          <span class="fa-meta" style="font-size: 10px;">{{ opt.count }}</span>
        </label>
        <div v-if="collegeSearch.trim() && filteredCollegeOptions.length === 0" class="fa-meta" style="padding: 4px 0; font-style: italic;">No match</div>
      </div>
    </div>

    <!-- Department -->
    <div style="margin-bottom: 28px;">
      <div class="fa-display" style="font-size: 18px; margin-bottom: 10px;">Department</div>
      <input
        class="fa-input"
        v-model="departmentSearch"
        type="search"
        placeholder="Search departments…"
        aria-label="Search departments"
        style="font-size: 13px; margin-bottom: 8px;"
      />
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <button
          v-for="opt in filteredDepartmentOptions"
          :key="opt.value"
          type="button"
          class="fa-facet-item facet-button"
          :class="{ active: filters.department === opt.value }"
          @click="toggleDepartment(opt.value)"
        >
          <span class="fa-check" :class="{ checked: filters.department === opt.value }">{{ filters.department === opt.value ? '✓' : '' }}</span>
          <span style="flex: 1; text-align: left;">{{ opt.value }}</span>
          <span class="fa-meta" style="font-size: 10px;">{{ opt.count }}</span>
        </button>
        <div v-if="departmentSearch.trim() && filteredDepartmentOptions.length === 0" class="fa-meta" style="padding: 4px 0; font-style: italic;">No match</div>
      </div>
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
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label
          v-for="opt in visibleDisciplineOptions"
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
        <button
          v-if="!disciplineSearch.trim() && filteredDisciplineOptions.length > 8"
          type="button"
          class="fa-btn fa-btn-ghost"
          style="margin-top: 6px; justify-content: center;"
          @click="showAllDisciplines = !showAllDisciplines"
        >{{ showAllDisciplines ? 'Show less' : `View ${filteredDisciplineOptions.length - 8} more` }}</button>
      </div>
    </div>

    <!-- City -->
    <div style="margin-bottom: 28px;">
      <div class="fa-display" style="font-size: 18px; margin-bottom: 10px;">City</div>
      <input
        class="fa-input"
        v-model="citySearch"
        type="search"
        placeholder="Search cities…"
        aria-label="Search cities"
        style="font-size: 13px; margin-bottom: 8px;"
      />
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <button
          v-for="opt in filteredCityOptions"
          :key="opt.value"
          type="button"
          class="fa-facet-item facet-button"
          :class="{ active: filters.city === opt.value }"
          @click="toggleCity(opt.value)"
        >
          <span class="fa-check" :class="{ checked: filters.city === opt.value }">{{ filters.city === opt.value ? '✓' : '' }}</span>
          <span style="flex: 1; text-align: left;">{{ opt.value }}</span>
          <span class="fa-meta" style="font-size: 10px;">{{ opt.count }}</span>
        </button>
        <div v-if="citySearch.trim() && filteredCityOptions.length === 0" class="fa-meta" style="padding: 4px 0; font-style: italic;">No match</div>
      </div>
    </div>

    <!-- Position Type -->
    <div style="margin-bottom: 28px;">
      <div class="fa-display" style="font-size: 18px; margin-bottom: 12px;">Rank</div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label
          v-for="opt in visibleRankOptions"
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
        <button
          v-if="positionTypeOptions.length > 8"
          type="button"
          class="fa-btn fa-btn-ghost"
          style="margin-top: 6px; justify-content: center;"
          @click="showAllRanks = !showAllRanks"
        >{{ showAllRanks ? 'Show less' : `View ${positionTypeOptions.length - 8} more` }}</button>
      </div>
    </div>

    <!-- Tenure Track -->
    <div style="margin-bottom: 28px;">
      <div class="fa-display" style="font-size: 18px; margin-bottom: 12px;">Track</div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label class="fa-facet-item" :class="{ active: filters.tenureTrackOnly }" @click="updateField('tenureTrackOnly', !filters.tenureTrackOnly)">
          <span class="fa-check" :class="{ checked: filters.tenureTrackOnly }">{{ filters.tenureTrackOnly ? '✓' : '' }}</span>
          <span style="flex: 1;">Tenure-Track only</span>
          <span class="fa-meta" style="font-size: 10px;">{{ tenureTrackCount }}</span>
        </label>
      </div>
    </div>

    <!-- State -->
    <div style="margin-bottom: 28px;">
      <div class="fa-display" style="font-size: 18px; margin-bottom: 12px;">State</div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label
          v-for="opt in visibleStateOptions"
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
        <button
          v-if="statesForFilter.length > 8"
          type="button"
          class="fa-btn fa-btn-ghost"
          style="margin-top: 6px; justify-content: center;"
          @click="showAllStates = !showAllStates"
        >{{ showAllStates ? 'Show less' : `View ${statesForFilter.length - 8} more` }}</button>
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
        <label class="fa-facet-item" :class="{ active: filters.showClosed }" @click="updateField('showClosed', !filters.showClosed)">
          <span class="fa-check" :class="{ checked: filters.showClosed }">{{ filters.showClosed ? '✓' : '' }}</span>
          <span style="flex: 1;">Show closed postings</span>
        </label>
      </div>
    </div>

    <!-- Actions -->
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <button class="fa-btn fa-btn-ghost" style="width: 100%; justify-content: center;" type="button" @click="emit('reset-filters')">
        Clear filters
      </button>
      <button
        v-if="subscribeStatus !== 'success'"
        class="fa-btn fa-btn-ghost"
        style="width: 100%; justify-content: center;"
        type="button"
        @click="showSubscribePanel = !showSubscribePanel"
      >
        ⏿ Email me new matches
      </button>

      <div v-if="showSubscribePanel && subscribeStatus !== 'success'" style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
        <div class="fa-meta">We'll only email you when new postings match this exact search — unsubscribe anytime.</div>
        <input
          class="fa-input"
          v-model="subscribeEmail"
          type="email"
          placeholder="you@university.edu"
          aria-label="Email address for job alerts"
          :disabled="subscribeStatus === 'pending'"
          @keydown.enter="submitSubscribe"
        />
        <button
          class="fa-btn"
          style="width: 100%; justify-content: center;"
          type="button"
          :disabled="subscribeStatus === 'pending' || !subscribeEmail.trim()"
          @click="submitSubscribe"
        >
          {{ subscribeStatus === 'pending' ? 'Sending…' : 'Send confirmation email' }}
        </button>
        <div v-if="subscribeStatus === 'error'" class="fa-meta" style="color: #b3261e;">{{ subscribeError }}</div>
      </div>

      <div v-if="subscribeStatus === 'success'" class="fa-meta">
        Check your inbox to confirm — you'll start getting alerts once you click the link.
      </div>
    </div>
  </div>
</template>

<style scoped>
.facet-button { appearance: none; width: 100%; border: 0; padding-left: 0; padding-right: 0; background: none; text-align: left; }
</style>
