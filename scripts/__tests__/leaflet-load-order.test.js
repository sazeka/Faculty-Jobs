import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../web-vue/src/composables/useLeafletMap.js', import.meta.url), 'utf8')

test('Leaflet is exposed before the legacy marker-cluster plugin loads', () => {
  assert.doesNotMatch(source, /^import 'leaflet\.markercluster'/m)
  assert.match(source, /window\.L = L\s+await import\('leaflet\.markercluster'\)/)
})
