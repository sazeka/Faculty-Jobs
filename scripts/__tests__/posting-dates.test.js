import assert from 'node:assert/strict'
import test from 'node:test'
import { extractPostingDatesFromText, normalizePostingDate } from '../lib/posting-dates.js'

const TODAY = new Date('2026-08-31T12:00:00Z')

test('extracts only explicitly labeled posting and deadline dates', () => {
  assert.deepEqual(extractPostingDatesFromText(
    'Open Date: May 1, 2026 Application Deadline: 09/15/2026 Anticipated start January 2027',
    { today: TODAY },
  ), { datePosted: '2026-05-01', closeDate: '2026-09-15', openUntilFilled: false })
})

test('recognizes rolling deadlines and rejects future posting dates', () => {
  assert.deepEqual(extractPostingDatesFromText(
    'Posted: 2026-09-01 Close Date: Open Until Filled',
    { today: TODAY },
  ), { datePosted: null, closeDate: null, openUntilFilled: true })
  assert.equal(normalizePostingDate('not a date'), null)
})
