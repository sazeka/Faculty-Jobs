import { watch } from 'vue'
import { createDefaultFilters } from '../config/appConfig'

// Shareable filter state. We sync the "search" filters to the URL query string
// so a view can be linked or bookmarked. savedOnly and newOnly are deliberately
// excluded: they're per-visitor (local saved jobs / "new since YOUR last visit")
// and meaningless — or misleading — in a link shared with someone else.
const STRING_KEYS = ['q', 'state', 'positionType', 'college', 'department', 'discipline', 'city', 'sortBy']
const BOOL_KEYS = ['tenureTrackOnly', 'showClosed']

// Build a query string holding only the filters that differ from the defaults,
// so a pristine view stays at a clean URL with no query at all.
export function filtersToQuery(filters) {
  const defaults = createDefaultFilters()
  const params = new URLSearchParams()
  for (const key of STRING_KEYS) {
    const value = filters[key]
    if (value != null && String(value).length && value !== defaults[key]) {
      params.set(key, String(value))
    }
  }
  for (const key of BOOL_KEYS) {
    if (filters[key]) params.set(key, '1')
  }
  return params
}

// Parse a query string into a partial filters patch. Unknown params are ignored;
// values are trusted as-is — an invalid value simply yields no matches, which the
// UI already handles, and option lists aren't known until job data has loaded.
export function queryToFilterPatch(search) {
  const params = new URLSearchParams(search)
  const patch = {}
  for (const key of STRING_KEYS) {
    if (params.has(key)) {
      const value = params.get(key)
      if (value) patch[key] = value
    }
  }
  for (const key of BOOL_KEYS) {
    if (params.has(key)) patch[key] = params.get(key) === '1' || params.get(key) === 'true'
  }
  return patch
}

export function buildShareUrl(filters) {
  const qs = filtersToQuery(filters).toString()
  return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ''}`
}

export function useFilterUrlSync({ filtersRef, updateFilters }) {
  // Apply filters carried in the current URL. Passed as one patch so
  // updateFilters' state→college reset doesn't clobber a shared college.
  function applyFromUrl() {
    const patch = queryToFilterPatch(window.location.search)
    if (Object.keys(patch).length) updateFilters(patch)
  }

  // Mirror filter changes back to the URL via replaceState (no history spam).
  function startSync() {
    watch(
      filtersRef,
      (f) => {
        const qs = filtersToQuery(f).toString()
        const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`
        window.history.replaceState(null, '', url)
      },
      { deep: true },
    )
  }

  return { applyFromUrl, startSync }
}
