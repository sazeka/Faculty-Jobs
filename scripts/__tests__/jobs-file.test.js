import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readJobsFile, writeJobsFile, normalizeJobsFile, descriptionsDirFor } from '../lib/jobs-file.js'

function tmpJobs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-file-'))
  return path.join(dir, 'jobs.json')
}
const payload = { scrapedAt: 'x', count: 2, jobs: [
  { canonicalJobId: 'job_a', title: 'A', description: 'Alpha text' },
  { canonicalJobId: 'job_b', title: 'B', description: 'Beta text' },
] }

test('round-trips descriptions through the shards and keeps jobs.json slim', () => {
  const p = tmpJobs()
  writeJobsFile(p, payload)
  const slim = JSON.parse(fs.readFileSync(p, 'utf8'))
  assert.ok(slim.jobs.every((j) => !j.description))
  assert.deepEqual(readJobsFile(p).jobs.map((j) => j.description), ['Alpha text', 'Beta text'])
  assert.equal(readJobsFile(p, { descriptions: false }).jobs[0].description, undefined)
})

test('writing back a slim read keeps descriptions; an explicit empty one clears it', () => {
  const p = tmpJobs()
  writeJobsFile(p, payload)
  const slim = readJobsFile(p, { descriptions: false })
  writeJobsFile(p, { ...slim, jobs: [slim.jobs[0], { ...slim.jobs[1], description: '' }] })
  assert.deepEqual(readJobsFile(p).jobs.map((j) => j.description), ['Alpha text', ''])
  assert.ok(fs.readdirSync(descriptionsDirFor(p)).every((f) => !fs.readFileSync(path.join(descriptionsDirFor(p), f), 'utf8').includes('Beta text')))
})

test('dropped jobs lose their shard entries', () => {
  const p = tmpJobs()
  writeJobsFile(p, payload)
  writeJobsFile(p, { ...payload, jobs: [readJobsFile(p).jobs[0]] })
  const all = fs.readdirSync(descriptionsDirFor(p)).flatMap((f) => Object.keys(JSON.parse(fs.readFileSync(path.join(descriptionsDirFor(p), f), 'utf8'))))
  assert.deepEqual(all, ['job_a'])
})

test('an inline description written directly to jobs.json wins, and normalize moves it', () => {
  const p = tmpJobs()
  writeJobsFile(p, payload)
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
  raw.jobs[0].description = 'Updated alpha'
  fs.writeFileSync(p, JSON.stringify(raw))
  assert.equal(readJobsFile(p).jobs[0].description, 'Updated alpha')
  assert.equal(normalizeJobsFile(p), 1)
  assert.ok(!JSON.parse(fs.readFileSync(p, 'utf8')).jobs[0].description)
  assert.equal(readJobsFile(p).jobs[0].description, 'Updated alpha')
})

test('null and empty descriptions stay inline so derived files keep the same shape', () => {
  const p = tmpJobs()
  writeJobsFile(p, { jobs: [{ canonicalJobId: 'job_n', description: null }, { canonicalJobId: 'job_e', description: '' }] })
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')).jobs, [{ canonicalJobId: 'job_n', description: null }, { canonicalJobId: 'job_e', description: '' }])
  assert.deepEqual(readJobsFile(p).jobs.map((j) => j.description), [null, ''])
})
