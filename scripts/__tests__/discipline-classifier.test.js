import assert from 'node:assert/strict'
import test from 'node:test'
import { getDiscipline } from '../../web-vue/src/composables/useJobFilters.js'

// Regression coverage for issue #115: the classifier bare-matched the
// substring 'art' inside unrelated words ('department', 'part-time',
// 'artificial'), sending them all to Arts & Music.

test('a generic "department" in the title/department does not imply Arts & Music', () => {
  assert.equal(getDiscipline({ title: 'Accounting Faculty and Department Chair', department: null }), 'Business & Economics')
  assert.equal(
    getDiscipline({ title: 'Cellular and Molecular Genetics Assistant Professor', department: '100006 - Biology Department' }),
    'Biological Sciences',
  )
})

test('"part-time" in the title does not imply Arts & Music', () => {
  assert.equal(
    getDiscipline({
      title: 'Nurse Practitioner/Physician Assistant, Clinical Instructor, Internal Medicine, Hematology & Oncology - Infusion Center - Part-Time',
      department: null,
    }),
    'Health & Medicine',
  )
})

test('"artificial intelligence" does not imply Arts & Music', () => {
  assert.equal(
    getDiscipline({ title: 'Assistant Professor of Artificial Intelligence', department: null }),
    'Computer Science & Engineering',
  )
})

test('public health, accounting, and earth science postings classify correctly', () => {
  assert.equal(
    getDiscipline({ title: 'Adjunct Instructor Pool - Department of Public Health', department: null }),
    'Health & Medicine',
  )
  assert.equal(
    getDiscipline({ title: 'Department Chair, Health Science Programs', department: null }),
    'Health & Medicine',
  )
  assert.equal(
    getDiscipline({ title: 'Assistant Professor — Earth Marine Environmt Sci', department: 'Department of Earth Science' }),
    'Natural Sciences',
  )
})

test('a genuine arts posting still classifies as Arts & Music', () => {
  assert.equal(getDiscipline({ title: 'Assistant Professor of Studio Art', department: null }), 'Arts & Music')
  assert.equal(getDiscipline({ title: 'Lecturer in Art History', department: 'Department of Art' }), 'Arts & Music')
  assert.equal(getDiscipline({ title: 'Professor', department: 'School of Visual Arts' }), 'Arts & Music')
})
