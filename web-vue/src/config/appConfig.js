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
    state: [],
    positionType: [],
    college: ALL_FILTER_VALUE,
    department: ALL_FILTER_VALUE,
    discipline: [],
    city: ALL_FILTER_VALUE,
    employmentType: ALL_FILTER_VALUE,
    workMode: ALL_FILTER_VALUE,
    sortBy: DEFAULT_SORT,
    tenureTrackOnly: false,
    savedOnly: false,
    newOnly: false,
    showClosed: false,
  }
}
