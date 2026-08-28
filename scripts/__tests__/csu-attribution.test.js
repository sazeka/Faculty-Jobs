import assert from 'node:assert/strict'
import test from 'node:test'
import { mapCsuLocationToCampus } from '../../server.js'

test('maps expanded Cal Poly locations to the canonical CSU institution', () => {
  assert.equal(
    mapCsuLocationToCampus('Cal Poly - San Luis Obispo Campus, CA'),
    'California Polytechnic State University-San Luis Obispo',
  )
  assert.equal(
    mapCsuLocationToCampus('Cal Poly - Solano Campus (Vallejo)'),
    'California Polytechnic State University-San Luis Obispo',
  )
});
