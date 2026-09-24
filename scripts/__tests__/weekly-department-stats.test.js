import test from 'node:test'
import assert from 'node:assert/strict'
import { computeDepartmentBreakdown } from '../lib/weekly-department-stats.js'

test('Department coverage follows the same usable-value rule as the listing view', () => {
  assert.deepEqual(computeDepartmentBreakdown([
    { department: 'Department of Physics' },
    { department: 'Academic Affairs' },
    { department: null },
    { department: 'Nursing' },
  ]), { classified: 2, unknown: 2, classifiedPct: 50 })
})
