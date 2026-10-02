import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalDepartment, departmentKey, departmentUnitLevel } from '../lib/department-canonical.js'

test('trims pools, terms, codes, campuses and institutions from Department labels', () => {
  const cases = {
    'Accounting (Pool)': 'Accounting',
    'Accounting (1111)': 'Accounting',
    'Accounting (Fall 2026)': 'Accounting',
    'Accounting Department Pool': 'Accounting',
    'Accounting — Creating a Pool': 'Accounting',
    'Department of Chemistry': 'Chemistry',
    'English Department': 'English',
    'ABE ESL - FY 2027': 'ABE ESL',
    'Biology - Idabel Campus': 'Biology',
    'Biology, Prescott Campus': 'Biology',
    'Applied Behavior Analysis — Chicago Campus': 'Applied Behavior Analysis',
    'Accounting - State University': 'Accounting',
    'Psychiatry — Thomas Jefferson University': 'Psychiatry',
    'Climate School, Columbia University': 'Climate School',
    "University of Hawai'i at Manoa - College of Natural Sciences - Chemistry": 'Chemistry',
    "University of Hawai'i at Manoa - College of Education": 'College of Education',
    'Biology - Tenure Track': 'Biology',
    'Lung Transplant Program — Faculty (Open Rank)': 'Lung Transplant Program',
    HVAC: 'HVAC',
    'MECHANICAL ENGINEERING': 'Mechanical Engineering',
    'COLLEGE OF VETERINARY MEDICINE (STW)': 'College of Veterinary Medicine',
  }
  for (const [raw, expected] of Object.entries(cases)) assert.equal(canonicalDepartment(raw), expected, raw)
})

test('returns null when no usable unit remains', () => {
  assert.equal(canonicalDepartment('Instruction'), null)
  assert.equal(canonicalDepartment('Adjunct Pool'), null)
  assert.equal(canonicalDepartment(null), null)
})

test('separates schools and colleges from departments', () => {
  assert.equal(departmentUnitLevel('School of Nursing'), 'school')
  assert.equal(departmentUnitLevel('Faculty of Arts and Sciences'), 'school')
  assert.equal(departmentUnitLevel('Harvard Medical School'), 'school')
  assert.equal(departmentUnitLevel('Liberal Arts & Sciences'), 'school')
  assert.equal(departmentUnitLevel('Nursing'), 'department')
  assert.equal(departmentUnitLevel('Division of Mathematics'), 'department')
})

test('spelling variants share a key', () => {
  assert.equal(departmentKey('Art & Design'), departmentKey('Art and Design'))
  assert.equal(departmentKey('Art & Design'), departmentKey('art and design'))
})
