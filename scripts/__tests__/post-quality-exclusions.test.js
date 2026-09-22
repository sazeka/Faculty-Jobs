import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReviewedExclusionMap, normalizeReviewedUrl, reviewedExclusionReason } from '../lib/post-quality-exclusions.js'

test('reviewed URL exclusions are exact and survive harmless URL normalization', () => {
  const exclusions = buildReviewedExclusionMap([
    { url: 'https://Example.edu/faculty-handbook/', reason: 'faculty_handbook' },
  ])
  assert.equal(reviewedExclusionReason({ url: 'https://example.edu/faculty-handbook' }, exclusions), 'faculty_handbook')
  assert.equal(reviewedExclusionReason({ url: 'https://example.edu/faculty-job' }, exclusions), null)
  assert.equal(normalizeReviewedUrl('not a url'), 'not a url')
})

test('reviewed Soka staff and catalog pages are excluded without broad title matching', () => {
  const exclusions = buildReviewedExclusionMap([
    { url: 'https://soka.wd5.myworkdayjobs.com/sokacareersite/job/SUA-Main-Campus/Faculty-Assistant-and-Assistant-to-the-Office-of-the-Dean_JR-416', reason: 'staff_role' },
    { url: 'https://catalog.soka.edu/core/core-100', reason: 'course_catalog_page' },
  ])
  assert.equal(reviewedExclusionReason({ url: 'https://catalog.soka.edu/core/core-100/' }, exclusions), 'course_catalog_page')
  assert.equal(reviewedExclusionReason({ url: 'https://apply.interfolio.com/186050' }, exclusions), null)
})
