import assert from 'node:assert/strict'
import test from 'node:test'
import { categoryOptions, matchingCategoryOptions, categorySeries } from '../../web-vue/src/lib/academicCategoryTrends.js'

const weeks = [
  { weekEnd: '2026-09-27', totalJobs: 100, disciplines: { Nursing: 8, Biology: 4 }, departments: { 'School of Nursing': 3 } },
  { weekEnd: '2026-10-04', totalJobs: 120, disciplines: { Nursing: 12, Physics: 2 }, departments: { 'School of Nursing': 5, 'Department of Physics': 2 } },
]

test('selectors include every current category and search by name', () => {
  const options = categoryOptions(weeks, 'discipline')
  assert.deepEqual(options.map((item) => item.name), ['Nursing', 'Physics'])
  assert.deepEqual(matchingCategoryOptions(options, 'phy').map((item) => item.name), ['Physics'])
})

test('category history includes true zero counts for recorded weeks', () => {
  assert.deepEqual(categorySeries(weeks, 'discipline', 'Physics'), [
    { weekEnd: '2026-09-27', count: 0, sharePct: 0 },
    { weekEnd: '2026-10-04', count: 2, sharePct: 1.6667 },
  ])
  assert.equal(categorySeries(weeks, 'department', 'School of Nursing')[1].count, 5)
})
