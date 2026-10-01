import assert from 'node:assert/strict'
import test from 'node:test'
import { predictAcademicFields, scoreAcademicFields } from '../lib/academic-field-benchmark.js'

test('specific academic subjects outrank generic clinical and parent-school terms', () => {
  assert.deepEqual(predictAcademicFields({ title: 'Clinical Nursing Faculty', department: null }), {
    department: null,
    discipline: 'Health & Medicine',
    subdiscipline: 'Nursing',
  })
  assert.equal(predictAcademicFields({ title: 'Assistant Professor of Microbiology' }).subdiscipline, 'Microbiology')
  assert.equal(predictAcademicFields({ title: 'Assistant Professor of Nursing', department: 'School of Medicine' }).subdiscipline, 'Nursing')
})

test('benchmark scores only reviewed gold fields and exposes disagreements', () => {
  const result = scoreAcademicFields([
    { title: 'Professor of Chemistry', department: 'Department of Chemistry', goldDepartment: 'Department of Chemistry', goldDiscipline: 'Natural Sciences', reviewStatus: 'reviewed' },
    { title: 'Professor of Physics', department: null, goldDiscipline: 'Arts & Music', reviewStatus: 'reviewed' },
    { title: 'Professor of Nursing', department: 'Human Resources', goldDepartment: null, reviewStatus: 'reviewed' },
    { title: 'Professor of Music', goldDiscipline: 'Arts & Music', reviewStatus: 'unreviewed' },
  ])
  assert.equal(result.reviewed, 3)
  assert.equal(result.fields.department.reviewed, 2)
  assert.equal(result.fields.department.exactAccuracy, 1)
  assert.equal(result.fields.discipline.reviewed, 2)
  assert.equal(result.fields.discipline.exactAccuracy, 0.5)
  assert.equal(result.disagreements.length, 1)
})

test('department scoring distinguishes exact and normalized name agreement', () => {
  const result = scoreAcademicFields([
    { title: 'Assistant Professor', department: 'Psychology', goldDepartment: 'Department of Psychology', departmentReviewStatus: 'reviewed' },
    { title: 'Assistant Professor', department: 'School of Chemistry', goldDepartment: 'Department of Chemistry', departmentReviewStatus: 'reviewed' },
  ])
  assert.equal(result.fields.department.exactAccuracy, 0)
  assert.equal(result.fields.department.normalizedAccuracy, 0.5)
  assert.equal(result.fields.department.normalizationResolved, 1)
})
