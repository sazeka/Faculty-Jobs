import assert from 'node:assert/strict'
import test from 'node:test'
import { computePositionTypeFacets } from '../lib/weekly-position-type-stats.js'

test('counts overlapping role, rank, and appointment labels without treating them as one distribution', () => {
  const result = computePositionTypeFacets([
    { title: 'Clinical Assistant/Associate Professor of Nursing' },
    { title: 'Adjunct Instructor of Biology' },
    { title: 'Postdoctoral Research Scientist' },
    { title: 'Faculty Position in Mathematics' },
  ])
  assert.equal(result.total, 4)
  assert.equal(result.groups.roles.Professor, 1)
  assert.equal(result.groups.roles.Instructor, 1)
  assert.equal(result.groups.roles.Postdoctoral, 1)
  assert.equal(result.groups.roles['Other / unspecified'], 1)
  assert.equal(result.groups.ranks['Assistant Professor'], 1)
  assert.equal(result.groups.ranks['Associate Professor'], 1)
  assert.equal(result.groups.appointments['Clinical Faculty'], 1)
  assert.equal(result.groups.appointments.Adjunct, 1)
  assert.equal(result.groups.appointments['Research Faculty'], 0)
})
