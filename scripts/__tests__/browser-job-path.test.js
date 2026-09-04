import test from 'node:test'
import assert from 'node:assert/strict'
import { jobPath } from '../lib/job-slug.js'
import { jobDetailPath } from '../../web-vue/src/lib/jobPath.js'

test('browser job paths match generated static job paths', () => {
  const job = {
    title: 'Assistant Professor of Art & Design',
    college: 'Example University',
    canonicalJobId: 'job_374bd4a9dc53608f',
  }
  assert.equal(jobDetailPath(job), jobPath(job))
})
