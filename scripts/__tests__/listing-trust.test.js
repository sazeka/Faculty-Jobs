import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifySourceLink,
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
