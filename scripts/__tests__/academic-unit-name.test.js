import assert from 'node:assert/strict'
import test from 'node:test'
import { compareAcademicUnitNames } from '../lib/academic-unit-name.js'

test('recognizes harmless organizational wording and punctuation variants', () => {
  assert.equal(compareAcademicUnitNames('Department of Child and Family Studies', 'Child and Family Studies'), 'normalized')
  assert.equal(compareAcademicUnitNames('History, Geography and GIS', 'Department of History, Geography, and GIS'), 'normalized')
  assert.equal(compareAcademicUnitNames('Social Sciences Division', 'Social Sciences'), 'normalized')
})

test('keeps distinct units and donor names distinct', () => {
  assert.equal(compareAcademicUnitNames('School of Psychology', 'Department of Psychology'), 'different')
  assert.equal(compareAcademicUnitNames('Heilbrunn Department of Population and Family Health', 'Department of Population and Family Health'), 'different')
  assert.equal(compareAcademicUnitNames('School of Public Health', 'School of Nursing'), 'different')
})
