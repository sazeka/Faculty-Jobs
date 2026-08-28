import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../../web-vue/src/App.vue', import.meta.url), 'utf8')

test('expanded map uses the full content width without a Top regions sidebar', () => {
  assert.doesNotMatch(app, /Top regions|topRegions|fa-region-list/)
  assert.match(app, /\.fa-map-page-grid \{ display: block; \}/)
  assert.match(app, /\.fa-map-page-grid \.leaflet-map-wrap \{ height: clamp\(560px, 68vh, 680px\); min-height: 560px; \}/)
})
