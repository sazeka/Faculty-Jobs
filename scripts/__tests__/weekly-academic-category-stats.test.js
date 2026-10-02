import assert from 'node:assert/strict'
import test from 'node:test'
import { computeAcademicCategorySnapshot, updateAcademicCategoryHistory } from '../lib/weekly-academic-category-stats.js'

test('category snapshots count canonical Departments apart from schools', () => {
  const snapshot = computeAcademicCategorySnapshot([
    { discipline: 'Nursing', department: 'School of Nursing' },
    { discipline: 'Nursing', department: 'School of Nursing' },
    { discipline: 'null', department: 'Academic Affairs' },
    { discipline: 'Physics', department: null },
    { discipline: 'Accounting', department: 'Accounting (Pool)' },
    { discipline: 'Accounting', department: 'Department of Accounting' },
    { discipline: 'Accounting', department: 'ACCOUNTING' },
    { discipline: 'Art', department: 'Art & Design' },
    { discipline: 'Art', department: 'Art & Design' },
    { discipline: 'Art', department: 'Art and Design' },
    { discipline: 'Biology', department: 'Piedmont Technical College', college: 'Piedmont Technical College' },
  ], '2026-09-27')
  assert.deepEqual(snapshot, {
    weekEnd: '2026-09-27',
    totalJobs: 11,
    disciplines: { Accounting: 3, Art: 3, Biology: 1, Nursing: 2, Physics: 1 },
    departments: { Accounting: 3, 'Art & Design': 3 },
    schools: { 'School of Nursing': 2 },
  })
})

test('weekly history replaces a rerun and retains the latest recorded weeks', () => {
  const first = { weekEnd: '2026-09-20', totalJobs: 2, disciplines: {}, departments: {} }
  const current = { weekEnd: '2026-09-27', totalJobs: 3, disciplines: {}, departments: {} }
  assert.deepEqual(updateAcademicCategoryHistory([first, current], { ...current, totalJobs: 4 }, 2), [first, { ...current, totalJobs: 4 }])
  assert.deepEqual(updateAcademicCategoryHistory([first, current], { weekEnd: '2026-10-04', totalJobs: 5 }, 2).map((week) => week.weekEnd), ['2026-09-27', '2026-10-04'])
})
