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

function presetHasFilters(preset) {
  if (!preset) return false
  return Boolean(
      preset.q ||
      preset.state !== ALL_FILTER_VALUE ||
      preset.positionType !== ALL_FILTER_VALUE ||
      preset.college !== ALL_FILTER_VALUE ||
      preset.tenureTrackOnly ||
      preset.savedOnly ||
      preset.newOnly ||
      preset.sortBy !== DEFAULT_SORT,
  )
}

function presetLabel(preset) {
  const parts = []
  if (preset.q) parts.push(`"${truncate(preset.q, 16)}"`)
  if (preset.state && preset.state !== ALL_FILTER_VALUE) parts.push(preset.state)
  if (preset.positionType && preset.positionType !== ALL_FILTER_VALUE) parts.push(preset.positionType)
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
      state: filtersRef.value.state,
      positionType: filtersRef.value.positionType,
      college: filtersRef.value.college,
      tenureTrackOnly: filtersRef.value.tenureTrackOnly,
      savedOnly: filtersRef.value.savedOnly,
      newOnly: filtersRef.value.newOnly,
      sortBy: filtersRef.value.sortBy,
    }
  }

  function applyPreset(preset) {
    updateFilters({
      ...createDefaultFilters(),
      q: preset?.q || '',
      state: preset?.state || ALL_FILTER_VALUE,
      positionType: preset?.positionType || ALL_FILTER_VALUE,
      college: preset?.college || ALL_FILTER_VALUE,
      sortBy: preset?.sortBy || DEFAULT_SORT,
      tenureTrackOnly: !!preset?.tenureTrackOnly,
      savedOnly: !!preset?.savedOnly,
      newOnly: !!preset?.newOnly,
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
