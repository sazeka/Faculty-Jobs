import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluatePositionSample, scorePositionLabels } from '../lib/position-type-benchmark.js'

test('scores overlapping position labels independently', () => {
  const result = scorePositionLabels([
    { gold: ['Professor', 'Assistant Professor', 'Clinical Faculty'], predicted: ['Professor', 'Assistant Professor'] },
    { gold: ['Professor', 'Research Faculty'], predicted: ['Professor', 'Clinical Faculty'] },
  ])
  assert.equal(result.exactMatch, 0)
  const clinical = result.perLabel.find((row) => row.label === 'Clinical Faculty')
  assert.deepEqual(
    { truePositive: clinical.truePositive, falsePositive: clinical.falsePositive, falseNegative: clinical.falseNegative, precision: clinical.precision, recall: clinical.recall },
    { truePositive: 0, falsePositive: 1, falseNegative: 1, precision: 0, recall: 0 }
  )
  assert.equal(result.perLabel.find((row) => row.label === 'Professor').recall, 1)
})

test('matches reviewed annotations to source listings by stable id', () => {
  const jobs = [{ canonicalJobId: 'one', title: 'Clinical Assistant Professor' }]
  const result = evaluatePositionSample([
    { id: 'one', gold: ['Professor', 'Assistant Professor', 'Clinical Faculty'] },
    { id: 'missing', gold: ['Professor'] },
  ], jobs)
  assert.equal(result.count, 1)
  assert.equal(result.exactMatch, 1)
  assert.deepEqual(result.missing, ['missing'])
})

test('does not score an annotation after its source title changes', () => {
  const result = evaluatePositionSample(
    [{ id: 'one', title: 'Professor of History', gold: ['Professor'] }],
    [{ canonicalJobId: 'one', title: 'Professor of Chemistry' }]
  )
  assert.equal(result.count, 0)
  assert.deepEqual(result.changed, [{ id: 'one', reviewedTitle: 'Professor of History', currentTitle: 'Professor of Chemistry' }])
})

test('matches a changed job id through a unique source URL but rejects ambiguous URLs', () => {
  const sample = [{ id: 'old-id', url: 'https://example.edu/job/1', title: 'Visiting Lecturer', gold: ['Lecturer', 'Visiting Faculty'] }]
  const jobs = [{ canonicalJobId: 'new-id', url: 'https://example.edu/job/1', title: 'Visiting Lecturer' }]
  assert.equal(evaluatePositionSample(sample, jobs).exactMatch, 1)
  assert.deepEqual(evaluatePositionSample(sample, [...jobs, { ...jobs[0], canonicalJobId: 'another-id' }]).missing, ['old-id'])
})

test('reviews the chart role separately from overlapping filter labels', () => {
  const rows = evaluatePositionSample(
    [{ id: 'one', title: 'Adjunct Faculty - Biology', gold: ['Adjunct'], roleGold: ['Faculty, role unspecified'] }],
    [{ canonicalJobId: 'one', title: 'Adjunct Faculty - Biology' }]
  ).rows
  assert.deepEqual(rows[0].predictedRoles, ['Faculty, role unspecified'])
})
