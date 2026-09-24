import test from 'node:test'
import assert from 'node:assert/strict'
import { computeDepartmentBreakdown } from '../lib/weekly-department-stats.js'

test('Department coverage follows the same usable-value rule as the listing view', () => {
  assert.deepEqual(computeDepartmentBreakdown([
    { department: 'Department of Physics' },
    { department: 'Academic Affairs' },
    { department: null },
    { department: 'Nursing' },
    { department: 'Adjunct' },
    { department: 'Faculty (Open Rank)' },
  ]), { classified: 2, unknown: 4, classifiedPct: 33.3 })
})
