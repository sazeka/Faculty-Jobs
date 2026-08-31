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
