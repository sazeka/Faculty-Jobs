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

// Regression coverage for issue #128: getDiscipline() used to stop at the
// FIRST rule with any matching term anywhere in the title/department text.
// Generic role/context modifiers ('teaching', 'clinical', 'management')
// happen to sit in rules earlier in DISCIPLINE_RULES than the rules for the
// actual, more specific subject named in the same title, so the generic term
// won outright. The fix scores every rule by its most specific matching term
// and only falls back to a generic term when nothing more specific matched
// anywhere in the table.

test('"teaching" does not override an explicit subject named in the same title', () => {
  assert.equal(getDiscipline({ title: 'Assistant Teaching Professor - Psychology', department: null }), 'Psychology & Social Work')
  assert.equal(getDiscipline({ title: 'Adjunct Teaching Instructors – Chemistry', department: null }), 'Natural Sciences')
  assert.equal(getDiscipline({ title: 'Assistant Teaching Professor - Calculus', department: null }), 'Mathematics & Statistics')
  assert.equal(getDiscipline({ title: 'Assistant Teaching Professor in Chinese', department: null }), 'Languages & Linguistics')
  assert.equal(getDiscipline({ title: 'Assistant Teaching Professor in Political Science', department: null }), 'Social Sciences')
})

test('a title with only "teaching" and no more specific subject still falls back to Education', () => {
  assert.equal(getDiscipline({ title: 'Assistant Teaching Professor', department: null }), 'Education')
  assert.equal(getDiscipline({ title: 'Teaching Faculty, Multiple Positions', department: null }), 'Education')
})

test('"clinical" does not override an explicit psychology/counseling subject', () => {
  assert.equal(getDiscipline({ title: 'Adjunct Faculty - Clinical Psychology', department: null }), 'Psychology & Social Work')
  assert.equal(getDiscipline({ title: 'Assistant Professor - Clinical Psychology', department: null }), 'Psychology & Social Work')
  assert.equal(getDiscipline({ title: 'Clinical Mental Health Counseling', department: null }), 'Psychology & Social Work')
})

test('a title with only "clinical" and no more specific subject still falls back to Health & Medicine', () => {
  assert.equal(getDiscipline({ title: 'Clinical Instructor', department: null }), 'Health & Medicine')
})

test('"management" does not override an explicit clinical specialty named alongside it', () => {
  assert.equal(
    getDiscipline({ title: 'Assistant Professor of Clinical Anesthesiology, Pain Management', department: null }),
    'Health & Medicine',
  )
})

test('a title with only "management" and no more specific subject still falls back to Business & Economics', () => {
  assert.equal(getDiscipline({ title: 'Assistant Professor of Management', department: null }), 'Business & Economics')
})
