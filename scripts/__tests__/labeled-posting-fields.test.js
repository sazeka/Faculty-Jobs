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
