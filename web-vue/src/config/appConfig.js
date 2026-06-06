export const ALL_FILTER_VALUE = 'all'
export const DEFAULT_SORT = 'recent'

export const STORAGE_KEYS = {
  savedJobs: 'facultyJobs.saved.v1',
  recentPresets: 'facultyJobs.recentPresets.v1',
}

export const MAX_PRESETS = 5

export function createDefaultFilters() {
  return {
    q: '',
    state: ALL_FILTER_VALUE,
    positionType: ALL_FILTER_VALUE,
    college: ALL_FILTER_VALUE,
    department: ALL_FILTER_VALUE,
    discipline: ALL_FILTER_VALUE,
    city: ALL_FILTER_VALUE,
    sortBy: DEFAULT_SORT,
    tenureTrackOnly: false,
    savedOnly: false,
    newOnly: false,
  }
}
