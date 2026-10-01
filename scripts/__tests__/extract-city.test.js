import assert from 'node:assert/strict'
import test from 'node:test'
import { displayLocation, extractCity } from '../../web-vue/src/composables/useJobFilters.js'

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

test('uses the parsed city as the user-facing location', () => {
  assert.equal(displayLocation('Main Campus - Starkville, MS', 'Mississippi State University', 'MS'), 'Starkville, MS')
  assert.equal(displayLocation('Brandeis - Waltham, MA', 'Brandeis University', 'MA'), 'Waltham, MA')
})

test('does not repeat the institution name as the user-facing location', () => {
  assert.equal(displayLocation('Augusta University', 'Augusta University', 'GA'), 'GA')
  assert.equal(displayLocation('Fairleigh Dickinson University, NJ', 'Fairleigh Dickinson University', 'NJ'), 'NJ')
  assert.equal(displayLocation('University of Wisconsin Eau Claire, WI', 'University of Wisconsin-Eau Claire', 'WI'), 'WI')
})

test('keeps non-placeholder locations and remote roles visible', () => {
  assert.equal(displayLocation('College Station, TX', 'Texas A&M University', 'TX'), 'College Station, TX')
  assert.equal(displayLocation('Remote', 'Harvard University', 'MA'), 'Remote')
})
