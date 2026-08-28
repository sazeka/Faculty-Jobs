import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTINENTAL_US_BOUNDS,
  isContinentalUsPoint,
  overviewBoundsPoints,
} from '../../web-vue/src/lib/mapViewport.js'

test('the map overview frames the continental United States when it has lower-48 results', () => {
  const points = [[39.5, -98.35], [61.37, -152.4], [21.09, -157.5]]

  assert.deepEqual(overviewBoundsPoints(points), CONTINENTAL_US_BOUNDS)
  assert.equal(isContinentalUsPoint(points[0]), true)
  assert.equal(isContinentalUsPoint(points[1]), false)
  assert.equal(isContinentalUsPoint(points[2]), false)
})

test('Alaska- or Hawaii-only result sets remain visible', () => {
  const points = [{ lat: 61.37, lng: -152.4 }, { lat: 21.09, lng: -157.5 }]

  assert.equal(overviewBoundsPoints(points), points)
})
