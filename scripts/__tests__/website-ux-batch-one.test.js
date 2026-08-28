import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const app = read('web-vue/src/App.vue')
const card = read('web-vue/src/components/JobCard.vue')
const drawer = read('web-vue/src/components/JobDetailDrawer.vue')
const filters = read('web-vue/src/components/FilterBar.vue')
const presets = read('web-vue/src/composables/usePresets.js')
const jobsData = read('web-vue/src/composables/useJobsData.js')

test('catalog opens an accessible in-site detail drawer with official apply and report actions', () => {
  assert.match(app, /<JobDetailDrawer/)
  assert.match(app, /@open-detail="openJobDetail"/)
  assert.match(card, /emit\('open-detail', props\.job\)/)
  assert.match(card, /emit\('report-bad-listing', props\.job\)/)
  assert.match(drawer, /role="dialog"/)
  assert.match(drawer, /Apply on university site/)
  assert.match(drawer, /Report broken or outdated listing/)
  assert.match(drawer, /event\.key === 'Escape'/)
})

test('saved searches are visible and retain every shareable facet', () => {
  assert.match(app, /<PresetBar/)
  assert.match(app, /@save-current="saveCurrentPreset"/)
  for (const key of ['department', 'discipline', 'city']) {
    assert.match(presets, new RegExp(`${key}: filtersRef\\.value\\.${key}`))
    assert.match(presets, new RegExp(`${key}: preset\\?\\.${key}`))
  }
})

test('department and city filters expose searchable controls', () => {
  assert.match(filters, /placeholder="Search departments…"/)
  assert.match(filters, /placeholder="Search cities…"/)
  assert.match(filters, /updateField\('department'/)
  assert.match(filters, /updateField\('city'/)
})

test('full-description chunks use bounded parallel loading', () => {
  assert.match(jobsData, /Promise\.all\(Array\.from\(\{ length: Math\.min\(6, chunks\.length\) \}/)
  assert.match(jobsData, /const rowsByChunk = new Array\(chunks\.length\)/)
})
