import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanDepartment } from '../lib/department-clean.js'

// Issue #130: this is the one department validator shared by scoring,
// completeness, confidence badges, and the frontend's own display path, so
// they all agree on what counts as a real department value. Examples below
// are drawn from the issue's audit of 1,352 rejected raw department values.

test('rejects the audited malformed department patterns (issue #130)', () => {
  assert.equal(
    cleanDepartment('s. Come work alongside a committed group of faculty and staff to provide transformational'),
    null,
  ) // sentence fragment, well over 80 characters
  assert.equal(cleanDepartment('Biology Region: Finger Lakes Open until filled'), null) // noise keyword
  assert.equal(cleanDepartment('222720 - UGE Undergraduate Education'), null) // digit/punctuation prefix noise
  assert.equal(cleanDepartment('Biology (Adjunct) Search'), null) // leftover parenthetical noise
  assert.equal(cleanDepartment('2024 Hiring Cycle'), null) // starts with a year
  assert.equal(cleanDepartment('Program in biology. the department is growing'), null) // sentence break mid-string
  assert.equal(cleanDepartment('Open until filled'), null) // noise-only value
  assert.equal(cleanDepartment(''), null)
  assert.equal(cleanDepartment(null), null)
  assert.equal(cleanDepartment('Ch'), null) // too short to be a real department
})

test('accepts real department values', () => {
  assert.equal(cleanDepartment('Department of Chemistry'), 'Department of Chemistry')
  assert.equal(cleanDepartment('Biology'), 'Biology')
  assert.equal(cleanDepartment('Art & Art History (Studio Art)'), 'Art & Art History (Studio Art)')
  assert.equal(cleanDepartment('  Nursing  '), 'Nursing')
})
