import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultFilters } from '../../web-vue/src/config/appConfig.js'
import { useJobFilters } from '../../web-vue/src/composables/useJobFilters.js'
import { filtersToQuery, queryToFilterPatch } from '../../web-vue/src/composables/useFilterUrlSync.js'

test('state, rank, and discipline filters allow OR selections within each facet', () => {
  const jobsRef = { value: [
    { title: 'Assistant Professor of Biology', college: 'Arizona U', state: 'Arizona', url: 'https://example.edu/1' },
    { title: 'Lecturer in History', college: 'California U', state: 'California', url: 'https://example.edu/2' },
    { title: 'Associate Professor of Chemistry', college: 'Texas U', state: 'Texas', url: 'https://example.edu/3' },
  ] }
  const filtersRef = { value: {
    ...createDefaultFilters(),
    state: ['Arizona', 'California'],
    positionType: ['Assistant Professor', 'Lecturer'],
    discipline: ['Biological Sciences', 'Humanities'],
  } }
  const { filteredJobs } = useJobFilters({ jobsRef, filtersRef, isSavedJob: () => false })
  assert.deepEqual(filteredJobs.value.map((job) => job.state).sort(), ['Arizona', 'California'])
})

test('multi-select values round-trip through repeated URL parameters', () => {
  const filters = {
    ...createDefaultFilters(),
    state: ['Arizona', 'California'],
    discipline: ['Biological Sciences', 'Humanities'],
  }
  const query = filtersToQuery(filters).toString()
  assert.match(query, /state=Arizona/)
  assert.match(query, /state=California/)
  const patch = queryToFilterPatch(`?${query}`)
  assert.deepEqual(patch.state, filters.state)
  assert.deepEqual(patch.discipline, filters.discipline)
})
