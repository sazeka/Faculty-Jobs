import assert from 'node:assert/strict'
import test from 'node:test'
import { expirationCutoff, filterExpiredDeadlineCache, isExpiredPastGrace, partitionExpiredJobs } from '../lib/post-expiration.js'

const TODAY = new Date('2026-08-27T12:00:00Z')

test('deadline cleanup preserves a full seven-day grace period', () => {
  assert.equal(expirationCutoff(TODAY, 7), '2026-08-20')
  assert.equal(isExpiredPastGrace({ closeDate: '2026-08-19' }, { today: TODAY, graceDays: 7 }), true)
  assert.equal(isExpiredPastGrace({ closeDate: '2026-08-20' }, { today: TODAY, graceDays: 7 }), false)
  assert.equal(isExpiredPastGrace({ closeDate: '2026-08-26' }, { today: TODAY, graceDays: 7 }), false)
});

test('rolling, missing, and invalid deadlines are never purged', () => {
  assert.equal(isExpiredPastGrace({ closeDate: '2020-01-01', openUntilFilled: true }, { today: TODAY }), false)
  assert.equal(isExpiredPastGrace({}, { today: TODAY }), false)
  assert.equal(isExpiredPastGrace({ closeDate: 'not-a-date' }, { today: TODAY }), false)
});

test('partitioning removes only posts beyond the deadline grace period', () => {
  const expired = { canonicalJobId: 'expired', closeDate: '2026-08-01' }
  const grace = { canonicalJobId: 'grace', closeDate: '2026-08-22' }
  const rolling = { canonicalJobId: 'rolling', closeDate: '2020-01-01', openUntilFilled: true }
  const result = partitionExpiredJobs([expired, grace, rolling], { today: TODAY, graceDays: 7 })
  assert.deepEqual(result.expired, [expired])
  assert.deepEqual(result.kept, [grace, rolling])
});

test('deadline cache blocks rediscovery but yields to explicit reopening evidence', () => {
  const cache = { 'https://example.edu/job/1': { closeDate: '2026-07-01' } }
  const stale = { url: 'https://example.edu/job/1' }
  const extended = { url: 'https://example.edu/job/1', closeDate: '2026-10-01' }
  const rolling = { url: 'https://example.edu/job/1', openUntilFilled: true }
  const unknown = { url: 'https://example.edu/job/2' }
  const result = filterExpiredDeadlineCache([stale, extended, rolling, unknown], cache, { today: TODAY, graceDays: 7 })
  assert.deepEqual(result.expired, [stale])
  assert.deepEqual(result.kept, [extended, rolling, unknown])
});
