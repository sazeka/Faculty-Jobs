import { computed, onMounted, ref } from 'vue'

const ALERTS_KEY = 'facultyJobs.alerts.v1'

function safeParseArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function sameFilter(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {})
}

export function useAlerts({ filtersRef, countMatches }) {
  const alerts = ref([])

  function persist() {
    try {
      localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts.value))
    } catch (_err) {
      // Ignore storage failures in restricted modes.
    }
  }

  function getSnapshot() {
    return {
      q: clean(filtersRef.value.q),
      state: filtersRef.value.state,
      positionType: filtersRef.value.positionType,
      college: filtersRef.value.college,
      sortBy: filtersRef.value.sortBy,
      tenureTrackOnly: Boolean(filtersRef.value.tenureTrackOnly),
      savedOnly: Boolean(filtersRef.value.savedOnly),
      newOnly: Boolean(filtersRef.value.newOnly),
    }
  }

  function addAlert() {
    const snapshot = getSnapshot()
    const label = snapshot.q
      ? `Alert: ${snapshot.q}`
      : snapshot.college !== 'all'
        ? `Alert: ${snapshot.college}`
        : snapshot.state !== 'all'
          ? `Alert: ${snapshot.state}`
          : 'Alert: all faculty jobs'

    const deduped = alerts.value.filter((a) => !sameFilter(a.filters, snapshot))
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      filters: snapshot,
      createdAt: new Date().toISOString(),
    }
    alerts.value = [item, ...deduped].slice(0, 10)
    persist()
  }

  function removeAlert(id) {
    alerts.value = alerts.value.filter((a) => a.id !== id)
    persist()
  }

  const alertsWithCounts = computed(() =>
    alerts.value.map((a) => ({
      ...a,
      matchCount: countMatches(a.filters),
    })),
  )

  onMounted(() => {
    alerts.value = safeParseArray(ALERTS_KEY)
  })

  return {
    alertsWithCounts,
    addAlert,
    removeAlert,
  }
}
