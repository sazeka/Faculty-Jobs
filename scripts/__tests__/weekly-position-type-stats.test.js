import assert from 'node:assert/strict'
import test from 'node:test'
import { computePositionTypeFacets } from '../lib/weekly-position-type-stats.js'

test('counts overlapping roles, ranks, appointment status, and faculty focus', () => {
  const result = computePositionTypeFacets([
    { title: 'Clinical Assistant/Associate Professor of Nursing' },
    { title: 'Adjunct Instructor of Biology' },
    { title: 'Postdoctoral Research Scientist' },
    { title: 'Faculty Position in Mathematics' },
    { title: 'Faculty Learning Communities Coordinator' },
    { title: 'Adjunct, Biology' },
    { title: 'Faculty Recruitment (Open Rank)' },
    { title: 'Faculty Development Chairs in Materials Science' },
    { title: 'Faculty Services and Instructional Design Librarian' },
    { title: 'Dean of Faculty' },
    { title: 'Faculty Leave Manager' },
  ])
  assert.equal(result.total, 11)
  assert.equal(result.groups.roles.Professor, 1)
  assert.equal(result.groups.roles.Instructor, 1)
  assert.equal(result.groups.roles.Postdoctoral, 1)
  assert.equal(result.groups.roles['Faculty, role unspecified'], 3)
  assert.equal(result.groups.roles['Other / unclear'], 5)
  assert.equal(result.groups.ranks['Assistant Professor'], 1)
  assert.equal(result.groups.ranks['Associate Professor'], 1)
  assert.equal(result.groups.facultyFocus['Clinical Faculty'], 1)
  assert.equal(result.groups.appointmentStatus.Adjunct, 2)
  assert.equal(result.groups.facultyFocus['Research Faculty'], 0)
})
