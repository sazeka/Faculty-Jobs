import assert from 'node:assert/strict'
import test from 'node:test'
import { applyJobUrlCorrections } from '../lib/job-url-corrections.js'

const corrections = [
  { from: 'https://www.paycor.com/recruiting-software', to: 'https://recruitingbypaycor.com/career/JobIntroduction.action?id=1', college: 'Bushnell University', title: 'Adjunct Faculty Pool' },
]

test('reviewed corrections replace the mis-scraped link', () => {
  const { jobs, changed } = applyJobUrlCorrections([
    { url: 'https://www.paycor.com/recruiting-software/', college: 'Bushnell University', title: 'Adjunct  Faculty Pool' },
  ], corrections)
  assert.equal(changed, 1)
  assert.equal(jobs[0].url, 'https://recruitingbypaycor.com/career/JobIntroduction.action?id=1')
})

test('the same vendor URL at another school, or a different title, is left alone', () => {
  const { changed } = applyJobUrlCorrections([
    { url: 'https://www.paycor.com/recruiting-software', college: 'Other College', title: 'Adjunct Faculty Pool' },
    { url: 'https://www.paycor.com/recruiting-software', college: 'Bushnell University', title: 'Nursing Faculty' },
  ], corrections)
  assert.equal(changed, 0)
})
