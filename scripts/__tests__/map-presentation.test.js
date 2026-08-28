import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const panel = readFileSync(new URL('../../web-vue/src/components/MapPanel.vue', import.meta.url), 'utf8')
const app = readFileSync(new URL('../../web-vue/src/App.vue', import.meta.url), 'utf8')

test('map removes redundant visible status text and overlays its controls', () => {
  assert.doesNotMatch(panel, />Map View</)
  assert.doesNotMatch(panel, /class="muted map-note"/)
  assert.match(panel, /class="map-status" aria-live="polite"/)
  assert.match(panel, /class="map-actions map-overlay-actions"/)
  assert.match(app, /\.map-overlay-actions \{\s+position: absolute;/)
  assert.match(app, /\.map-status \{\s+position: absolute;/)
})
