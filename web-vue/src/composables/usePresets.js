import { computed, onMounted, ref } from 'vue'
import { ALL_FILTER_VALUE, DEFAULT_SORT, MAX_PRESETS, STORAGE_KEYS, createDefaultFilters } from '../config/appConfig'

function parseStoredArray(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function truncate(value, length) {
  const str = String(value || '')
  return str.length > length ? `${str.slice(0, length - 1)}...` : str
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  return value && value !== ALL_FILTER_VALUE ? [value] : []
}

function presetHasFilters(preset) {
  if (!preset) return false
  return Boolean(
      preset.q ||
      asArray(preset.state).length ||
      asArray(preset.positionType).length ||
      preset.college !== ALL_FILTER_VALUE ||
      preset.department !== ALL_FILTER_VALUE ||
      asArray(preset.discipline).length ||
      preset.city !== ALL_FILTER_VALUE ||
      preset.employmentType !== ALL_FILTER_VALUE ||
      preset.workMode !== ALL_FILTER_VALUE ||
      preset.tenureTrackOnly ||
      preset.savedOnly ||
      preset.newOnly ||
      preset.sortBy !== DEFAULT_SORT,
  )
}

function presetLabel(preset) {
  const parts = []
  if (preset.q) parts.push(`"${truncate(preset.q, 16)}"`)
  if (asArray(preset.state).length) parts.push(asArray(preset.state).join(', '))
  if (asArray(preset.positionType).length) parts.push(asArray(preset.positionType).join(', '))
  if (asArray(preset.discipline).length) parts.push(asArray(preset.discipline).join(', '))
  if (preset.department && preset.department !== ALL_FILTER_VALUE) parts.push(truncate(preset.department, 18))
  if (preset.city && preset.city !== ALL_FILTER_VALUE) parts.push(preset.city)
  if (preset.employmentType && preset.employmentType !== ALL_FILTER_VALUE) parts.push(preset.employmentType)
  if (preset.workMode && preset.workMode !== ALL_FILTER_VALUE) parts.push(preset.workMode)
  if (preset.savedOnly) parts.push('Saved')
  if (preset.newOnly) parts.push('New')
  if (preset.tenureTrackOnly) parts.push('Tenure')
  return parts.length ? parts.join(' · ') : 'Default filters'
}

export function usePresets({ filtersRef, updateFilters }) {
  const recentPresets = ref([])

  function persistRecentPresets() {
    localStorage.setItem(STORAGE_KEYS.recentPresets, JSON.stringify(recentPresets.value.slice(0, MAX_PRESETS)))
  }

  function getPresetSnapshot() {
    return {
      q: filtersRef.value.q.trim(),
      state: [...filtersRef.value.state],
      positionType: [...filtersRef.value.positionType],
      college: filtersRef.value.college,
      department: filtersRef.value.department,
      discipline: [...filtersRef.value.discipline],
      city: filtersRef.value.city,
      employmentType: filtersRef.value.employmentType,
      workMode: filtersRef.value.workMode,
      tenureTrackOnly: filtersRef.value.tenureTrackOnly,
      savedOnly: filtersRef.value.savedOnly,
      newOnly: filtersRef.value.newOnly,
      showClosed: filtersRef.value.showClosed,
      sortBy: filtersRef.value.sortBy,
    }
  }

  function applyPreset(preset) {
    updateFilters({
      ...createDefaultFilters(),
      q: preset?.q || '',
      state: asArray(preset?.state),
      positionType: asArray(preset?.positionType),
      college: preset?.college || ALL_FILTER_VALUE,
      department: preset?.department || ALL_FILTER_VALUE,
      discipline: asArray(preset?.discipline),
      city: preset?.city || ALL_FILTER_VALUE,
      employmentType: preset?.employmentType || ALL_FILTER_VALUE,
      workMode: preset?.workMode || ALL_FILTER_VALUE,
      sortBy: preset?.sortBy || DEFAULT_SORT,
      tenureTrackOnly: !!preset?.tenureTrackOnly,
      savedOnly: !!preset?.savedOnly,
      newOnly: !!preset?.newOnly,
      showClosed: !!preset?.showClosed,
    })
  }

  function saveCurrentPreset() {
    const snapshot = getPresetSnapshot()
    if (!presetHasFilters(snapshot)) return

    const encoded = JSON.stringify(snapshot)
    const deduped = recentPresets.value.filter((preset) => JSON.stringify(preset) !== encoded)
    recentPresets.value = [snapshot, ...deduped].slice(0, MAX_PRESETS)
    persistRecentPresets()
  }

  function removePreset(index) {
    if (index < 0 || index >= recentPresets.value.length) return
    recentPresets.value = recentPresets.value.filter((_, idx) => idx !== index)
    persistRecentPresets()
  }

  const presetItems = computed(() =>
    recentPresets.value.map((preset, idx) => ({
      idx,
      preset,
      label: presetLabel(preset),
    })),
  )

  onMounted(() => {
    recentPresets.value = parseStoredArray(STORAGE_KEYS.recentPresets).slice(0, MAX_PRESETS)
  })

  return {
    recentPresets,
    presetItems,
    applyPreset,
    saveCurrentPreset,
    removePreset,
  }
}
