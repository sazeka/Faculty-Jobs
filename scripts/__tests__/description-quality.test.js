import assert from 'node:assert/strict'
import test from 'node:test'
import { isChallengeDescription } from '../lib/description-quality.js'

// Issue #130: an audit found 52 records whose description was exactly the
// bot-challenge phrase "Performing security verification..." -- this text
// should never count as real job content for scoring, completeness, or
// confidence badges.

test('detects the audited bot-challenge phrase and common variants', () => {
  assert.equal(isChallengeDescription('Performing security verification...'), true)
  assert.equal(isChallengeDescription('performing SECURITY verification. Please wait.'), true)
  assert.equal(isChallengeDescription('Access Denied. You do not have permission to access this page.'), true)
  assert.equal(isChallengeDescription('Checking your browser before accessing the site.'), true)
  assert.equal(isChallengeDescription('Please verify you are a human by completing the challenge.'), true)
})

test('real job descriptions are not flagged', () => {
  assert.equal(
    isChallengeDescription('Teach undergraduate and graduate chemistry courses and maintain an active research program.'),
    false,
  )
  assert.equal(isChallengeDescription(''), false)
  assert.equal(isChallengeDescription(null), false)
  assert.equal(isChallengeDescription(undefined), false)
})
