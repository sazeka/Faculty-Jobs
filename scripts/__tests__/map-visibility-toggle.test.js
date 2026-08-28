import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const app = fs.readFileSync(path.join(ROOT, 'web-vue/src/App.vue'), 'utf8')

test('catalog map can be hidden and restored without changing filters', () => {
  assert.match(app, /'Hide results map'/)
  assert.match(app, /'Show results map'/)
  assert.match(app, /class="fa-map-divider-toggle"/)
  assert.match(app, /showMapRail \? '›' : '‹'/)
  assert.match(app, /\.fa-map-divider-toggle\.is-collapsed/)
  assert.match(app, /'is-map-hidden': !showMapRail/)
  assert.match(app, /<aside v-if="showMapRail" class="fa-map-rail">/)
  assert.match(app, /localStorage\.setItem\(MAP_VISIBILITY_KEY, String\(visible\)\)/)
  assert.doesNotMatch(app, /setMapRailVisibility\([^)]*\)[\s\S]{0,120}updateFilters/)
})

test('filter column uses a matching persistent divider toggle', () => {
  assert.match(app, /'Hide filters'/)
  assert.match(app, /'Show filters'/)
  assert.match(app, /class="fa-filter-divider-toggle"/)
  assert.match(app, /showFiltersCol \? '‹' : '›'/)
  assert.match(app, /'is-filters-hidden': !showFiltersCol/)
  assert.match(app, /<aside v-if="showFiltersCol \|\| filterDrawerOpen" class="fa-filters-col"/)
  assert.match(app, /localStorage\.setItem\(FILTER_VISIBILITY_KEY, String\(visible\)\)/)
})
