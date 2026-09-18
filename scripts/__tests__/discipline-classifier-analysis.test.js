import assert from 'node:assert/strict'
import test from 'node:test'
import { getDiscipline } from '../../web-vue/src/composables/useJobFilters.js'

// Regression coverage for issue #116: the classifier bare-matched the
// standalone term 'analysis' inside Mathematics, so unrelated fields
// ("applied behavior analysis", "business analysis", "data analysis") were
// all misrouted to Mathematics & Statistics.

test('generic "analysis" fields do not imply Mathematics & Statistics', () => {
  assert.equal(
    getDiscipline({ title: 'Adjunct Faculty - Applied Behavior Analysis - Chicago Campus', department: null }),
    'Other',
  )
  assert.equal(
    getDiscipline({ title: 'Postdoctoral Scholar - Evans School Policy Analysis and Research Group', department: 'Evans School of Public Policy & Governance' }),
    'Social Sciences',
  )
  assert.equal(
    getDiscipline({ title: 'Assistant Professor of Environmental Analysis (Critical Geographer)', department: null }),
    'Other',
  )
  assert.equal(
    getDiscipline({ title: 'Adjunct Assistant Professor, Programming and Analysis (ITE)', department: null }),
    'Other',
  )
})

test('a genuine mathematical-analysis subfield still classifies as Mathematics & Statistics', () => {
  assert.equal(getDiscipline({ title: 'Assistant Professor of Real Analysis', department: null }), 'Mathematics & Statistics')
  assert.equal(getDiscipline({ title: 'Lecturer in Complex Analysis', department: 'Mathematics' }), 'Mathematics & Statistics')
  assert.equal(getDiscipline({ title: 'Professor of Numerical Analysis', department: null }), 'Mathematics & Statistics')
})
