import assert from 'node:assert/strict'
import test from 'node:test'
import { extractDepartmentFromText, extractLocationFromText } from '../lib/labeled-posting-fields.js'

test('extracts bounded labeled department and location fields', () => {
  const text = 'Department: Teacher Education Location: Joplin, MO Reports To: Dean Job Summary: Teach courses.'
  assert.equal(extractDepartmentFromText(text), 'Teacher Education')
  assert.equal(extractLocationFromText(text), 'Joplin, MO')
})

test('handles joined page labels and rejects URLs and opaque codes', () => {
  assert.equal(extractLocationFromText('Location: 4200 Connecticut Ave NW, Washington, DC 20008 Brief Description of Duties'), '4200 Connecticut Ave NW, Washington, DC 20008')
  assert.equal(extractDepartmentFromText('Department: https://example.edu Department Website: example'), null)
  assert.equal(extractDepartmentFromText('Department: CC00238 WM001 Location: DC'), null)
})

test('does not swallow an unrelated field when Department is left blank (Workday template)', () => {
  // Live example (Lindenwood University, Workday): the Department field is
  // empty, and "Evaluation group" -- not in the original terminator list --
  // let the regex run on into the next field entirely.
  const text = 'Job title: Adjunct Instructor Job code: Department: Evaluation group: Adjunct Instructor FLSA status: Exempt Positions Supervised: N/A'
  assert.equal(extractDepartmentFromText(text), null)
})

test('stops at a "College/Division" label not in the original terminator list', () => {
  // Live example (Mercer University, Workday): otherwise-correct "Mechanical
  // Engineering" was running on into "College/Division: School Of
  // Engineering Primary Job Posting" before this label was recognized.
  const text = 'Department: Mechanical Engineering College/Division: School Of Engineering Primary Job Posting Location: Macon, GA 31207'
  assert.equal(extractDepartmentFromText(text), 'Mechanical Engineering')
})

test('stops at "Reports Directly to" (not just "Reports to")', () => {
  const text = 'Department: Academic Affairs Reports Directly to: Engineering Chair Status: Exempt; Full-time'
  assert.equal(extractDepartmentFromText(text), 'Academic Affairs')
})

test('rejects a captured value containing an email address', () => {
  const text = 'Department: Samantha Kaelin, Coordinator samantha.kaelin@wnc.edu Job Summary: Teach courses.'
  assert.equal(extractDepartmentFromText(text), null)
})

test('stops at a "Pay Classification" label not in the original terminator list', () => {
  // Live example (Hill College, ADP): a genuine department value ("Job
  // Workforce and Training Partnerships") was previously running on into
  // "Pay Classification: PT" because that label wasn't recognized either.
  const text = 'Department: Job Workforce and Training Partnerships Pay Classification: PT Reports To: Dean'
  assert.equal(extractDepartmentFromText(text), 'Job Workforce and Training Partnerships')
})
