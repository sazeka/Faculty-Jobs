import assert from 'node:assert/strict'
import test from 'node:test'
import { extractAcademicUnit } from '../lib/academic-unit-extraction.js'

test('reads a labeled academic unit while keeping a hyphenated unit name', () => {
  const result = extractAcademicUnit({
    title: 'Adjunct Instructor - Nursing',
    college: 'Texas A&M University - Texarkana',
    department: 'Nursing',
    description: 'Job Title Adjunct Instructor - Nursing Department CNHHS - Nursing Proposed Minimum Salary Commensurate Job Location Texarkana, Texas',
  })
  assert.equal(result.department, 'CNHHS - Nursing')
  assert.equal(result.source, 'description-field')
})

test('uses a named unit in the title when the description contains unrelated administrative boilerplate', () => {
  const result = extractAcademicUnit({
    title: 'Professor, School of Nursing',
    description: 'The Department of Education Office for Civil Rights may receive complaints.',
  })
  assert.equal(result.department, 'School of Nursing')
})

test('finds a department named in posting prose', () => {
  const result = extractAcademicUnit({
    title: 'Assistant Professor, Psychology',
    department: 'Psychology',
    description: 'The Department of Psychology at Winthrop University invites applications.',
  })
  assert.equal(result.department, 'Department of Psychology')
})

test('a specific position field wins over a broader center in the title', () => {
  const result = extractAcademicUnit({
    title: 'Associate Professor - Center for Urban Health Equity',
    department: 'Center for Urban Health Equity',
    description: 'Position Title Associate Professor Department School of Community Health & Policy Work Status Full Time',
  })
  assert.equal(result.department, 'School of Community Health & Policy')
  assert.equal(result.confidence, 'high')
})

test('an untyped field code does not replace a named school in the title', () => {
  const result = extractAcademicUnit({
    title: 'Adjunct, School of Communication and Mass Media',
    description: 'Department Mass Media JM Opening Date 08/01/2026',
  })
  assert.equal(result.department, 'School of Communication and Mass Media')
})
