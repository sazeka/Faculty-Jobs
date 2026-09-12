import assert from 'node:assert/strict'
import test from 'node:test'
import { extractDepartmentFromText, extractLocationFromText, extractVccsCollegeFromText } from '../lib/labeled-posting-fields.js'

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

test('stops at "Position Summary" (Clovis Community College, Villanova University templates)', () => {
  const text = 'Department: Instruction Position Summary Under general supervision of and in accordance with Clovis Community College and departmentally established practices...'
  assert.equal(extractDepartmentFromText(text), 'Instruction')
  const text2 = 'Department: 576-Dean, Professional Studies Position Summary: Villanova University invites applications for adjunct faculty positions...'
  assert.equal(extractDepartmentFromText(text2), '576-Dean, Professional Studies')
})

test('stops at "Duties & Responsibilities" and "Job Duties" (Virginia Commonwealth University, Maysville CTC)', () => {
  const text = 'Department: Management Duties & Responsibilities: Ability to teach at least one of the following courses...'
  assert.equal(extractDepartmentFromText(text), 'Management')
  const text2 = 'Department: Academic Services Job Duties: Adjunct nursing clinical instructors are responsible for facilitating clinical learning experiences...'
  assert.equal(extractDepartmentFromText(text2), 'Academic Services')
})

test('stops at "Opening Date" (North Florida College)', () => {
  const text = 'Department: Career and Workforce Education Opening Date: 7/28/2026 Closing Date: Open until filled'
  assert.equal(extractDepartmentFromText(text), 'Career and Workforce Education')
})

test('stops at "Required Education" (Felician University)', () => {
  const text = "Department: School of Arts & Sciences, University Library Required Education: Master's degree in Library and/or Information Science"
  assert.equal(extractDepartmentFromText(text), 'School of Arts & Sciences, University Library')
})

test('stops at "Sub department" and "Type of Appointment" (Baton Rouge Community College)', () => {
  const text = 'Department: Academic & Student Affairs Sub department: Business and Law Type of Appointment: Unclassified - Adjunct'
  assert.equal(extractDepartmentFromText(text), 'Academic & Student Affairs')
})

test('stops at "Catalog Number" even when glued to the preceding word (Eastern Iowa Community College District)', () => {
  const text = 'Department: Health Sciences/Career AcademiesCatalog Number: HSC-137Credit Hours: 3'
  assert.equal(extractDepartmentFromText(text), 'Health Sciences/Career Academies')
})

test('extracts the real VCCS college from the shared jobs.vccs.edu "Agency" field', () => {
  // Live example: this posting was scraped under the "Central Virginia
  // Community College" config (an unfiltered statewide query), but its own
  // Agency field names the actual college -- Northern Virginia Community
  // College, abbreviated "VA" in the raw HR record.
  const text = 'Position Number 280G0093 Agency Northern VA Community College Agency/Division NV280-VP Workforce Development Work Location Loudoun - 107'
  assert.equal(extractVccsCollegeFromText(text), 'Northern Virginia Community College')
})

test('handles the "Agency X Division X (Div)" template variant (no Agency/Division combined label)', () => {
  const text = 'Position Number 999 Agency Blue Ridge Community College Division Blue Ridge Community College (Div) Work Location Augusta - 015'
  assert.equal(extractVccsCollegeFromText(text), 'Blue Ridge Community College')
})

test('normalizes punctuation variants of a real VCCS college name', () => {
  assert.equal(
    extractVccsCollegeFromText('Agency Paul D. Camp Community College Agency/Division Paul D. Camp Community College (Div)'),
    'Paul D Camp Community College'
  )
  assert.equal(
    extractVccsCollegeFromText('Agency J. Sargeant Reynolds Community College Agency/Division J. Sargeant Reynolds Comm'),
    'J Sargeant Reynolds Community College'
  )
})

test('maps a pre-rename VCCS agency name to its current college name', () => {
  assert.equal(
    extractVccsCollegeFromText('Agency Dabney S. Lancaster Community College Agency/Division DSLCC'),
    'Mountain Gateway Community College'
  )
  assert.equal(
    extractVccsCollegeFromText('Agency Lord Fairfax Community College Agency/Division LFCC'),
    'Laurel Ridge Community College'
  )
})

test('returns null when there is no Agency field to parse', () => {
  assert.equal(extractVccsCollegeFromText('Department: Nursing Location: Lynchburg, VA'), null)
})
