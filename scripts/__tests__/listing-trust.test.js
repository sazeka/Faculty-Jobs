import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifySourceLink,
  explicitInstitutionInTitle,
  institutionTitleConflict,
  sanitizePostingDate,
  summarizeCatalog,
} from '../../web-vue/src/lib/listingTrust.js'

test('suppresses invalid and future posting dates', () => {
  const reference = new Date('2026-08-25T12:00:00Z')
  assert.equal(sanitizePostingDate('2026-08-25', reference), '2026-08-25')
  assert.equal(sanitizePostingDate('2027-07-25', reference), null)
  assert.equal(sanitizePostingDate('not a date', reference), null)
})

test('distinguishes direct job URLs from unstable search-page links', () => {
  assert.equal(classifySourceLink('https://example.edu/jobs/1234'), 'direct')
  assert.equal(classifySourceLink('https://example.edu/jobs'), 'search-page')
  assert.equal(
    classifySourceLink('https://jobs.example.edu/psc/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL#SCH_JOB_TITLE$40'),
    'search-page',
  )
  assert.equal(classifySourceLink('javascript:alert(1)'), 'invalid')
})

test('flags explicit institution contradictions in dash-delimited titles', () => {
  assert.deepEqual(
    institutionTitleConflict(
      'Academic Faculty - Cancer Imaging - Wake Forest University School of Medicine',
      'Queens University of Charlotte',
    ),
    { explicitInstitution: 'Wake Forest University', listedInstitution: 'Queens University of Charlotte' },
  )
  assert.equal(
    institutionTitleConflict('Assistant Professor - Arizona State University', 'Arizona State University'),
    null,
  )
  assert.equal(
    institutionTitleConflict('Adjunct Instructor - Applied Language Institute', 'University of Missouri-Kansas City'),
    null,
  )
  assert.equal(
    institutionTitleConflict('Adjunct Instructor - High School College Partnership', 'University of Missouri-Kansas City'),
    null,
  )
})

// Issue #140: explicitInstitutionInTitle() used to stop at the first bare
// "University" token, so "... Department of Sciences and Mathematics
// University of Washington" was truncated to the invented name "...
// Mathematics University" -- which obviously never matches the real college
// "University of Washington", producing a false conflict warning. Anchoring
// on the full "University of X" construction fixes all four confirmed
// examples from the issue.
test('does not flag University of Washington department-phrase titles as institution conflicts (issue #140)', () => {
  assert.equal(
    institutionTitleConflict(
      'Assistant Professor (Teaching Track) - Organic Chemistry Department of Sciences and Mathematics University of Washington',
      'University of Washington'
    ),
    null
  )
  assert.equal(
    institutionTitleConflict(
      'Assistant Professor (Tenure Track) - Psychology Department of Social Sciences University of Washington',
      'University of Washington'
    ),
    null
  )
  assert.equal(
    institutionTitleConflict(
      'Postdoctoral Scholar – Scientific Program Manager, Paros Geohazards Center School of Oceanography University of Washington',
      'University of Washington'
    ),
    null
  )
})

test('does not flag University of Nebraska at Omaha or University of Alabama at Birmingham department-phrase titles (issue #140)', () => {
  assert.equal(
    institutionTitleConflict(
      'Assistant/Associate Professor – Department of Biomechanics, Cardiovascular Science focus College of Education, Health, and Human Sciences University of Nebraska at Omaha',
      'University of Nebraska at Omaha'
    ),
    null
  )
  assert.equal(
    institutionTitleConflict(
      'Fully remote, hybrid and/or in-person Open-Rank - Faculty Radiologist Position in Abdominal Imaging at The University of Alabama at Birmingham',
      'University of Alabama at Birmingham'
    ),
    null
  )
})

test('does not flag bot-challenge-contaminated University of Houston titles (issue #140)', () => {
  assert.equal(
    institutionTitleConflict(
      "Let's confirm you are human - of Computer Science at the University of Houston invites applications for a Postdoctoral R",
      'University of Houston'
    ),
    null
  )
})

test('still extracts the full "University of X" name, not a truncated fallback (issue #140)', () => {
  assert.equal(
    explicitInstitutionInTitle('Academic Faculty - Cancer Research - University of Washington'),
    'University of Washington'
  )
  // A title truncated right after "University of" (a corrupted scrape) has no
  // usable institution evidence in that segment.
  assert.equal(
    explicitInstitutionInTitle('Restorative Neurosurgeon — Assistant Professor, WOT Neurological Surgery University of'),
    null
  )
})

test('explains source records, grouping, and hidden closed postings', () => {
  assert.deepEqual(
    summarizeCatalog([
      { canonicalGroupId: 'a', url: 'https://a/1' },
      { canonicalGroupId: 'a', url: 'https://a/2' },
      { canonicalGroupId: 'b', url: 'https://b/1', closeDate: '2026-01-01' },
    ], new Date('2026-08-25T12:00:00Z')),
    { sourceRecords: 3, groupedPostings: 2, searchablePostings: 1, duplicateRecords: 1, closedPostings: 1 },
  )
})
