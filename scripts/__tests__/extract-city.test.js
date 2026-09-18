import assert from 'node:assert/strict'
import test from 'node:test'
import { extractCity } from '../../web-vue/src/composables/useJobFilters.js'

// Regression coverage for issue #120: a nonempty location that's just the
// institution's own name plus a state suffix was exposed as a real city in
// the city filter.

test('does not expose the institution name itself as a city', () => {
  assert.equal(extractCity('Wilson Community College, NC', 'Wilson Community College'), null)
  assert.equal(extractCity('Harvard University, MA', 'Harvard University'), null)
  // No "university"/"college"/etc. in the name, so this only gets caught by
  // comparing against the college field, not the institution-word check.
  assert.equal(extractCity('SUNY Cortland, NY', 'SUNY Cortland'), null)
  assert.equal(extractCity('Midwestern Baptist Theological Seminary, MO', 'Midwestern Baptist Theological Seminary'), null)
})

test('keeps real cities, including ones named the same as their institution', () => {
  assert.equal(extractCity('Santa Clara, CA', 'Santa Clara University'), 'Santa Clara, CA')
  assert.equal(extractCity('Houston, TX', 'University of Houston'), 'Houston, TX')
  assert.equal(extractCity('Radford, VA', 'Radford University'), 'Radford, VA')
  assert.equal(extractCity('Philadelphia, PA', 'Drexel University'), 'Philadelphia, PA')
})

test('keeps a real satellite-campus city even when the college name embeds the campus suffix', () => {
  assert.equal(
    extractCity("Saint Joseph's University - Lancaster, PA", "Saint Joseph's University - Lancaster"),
    'Lancaster, PA',
  )
})
