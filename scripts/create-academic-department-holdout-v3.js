#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const destination = path.join(root, 'generated/academic-department-holdout-v3.json')
if (fs.existsSync(destination)) throw new Error(`Holdout already exists: ${destination}`)
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
const prior = new Set([
  ...read('generated/academic-field-review-sample.json'),
  ...read('generated/academic-field-holdout.json'),
  ...read('generated/academic-department-holdout-v2.json'),
].map((row) => row.id))
const payload = read('public/jobs.json')
const jobs = Array.isArray(payload) ? payload : payload.jobs
const hash = (value) => {
  let h = 2166136261
  for (const char of value) h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0
  return h
}
const unique = [...new Map(jobs.map((job) => [job.canonicalJobId || job.url, job])).values()]
const rows = unique
  .filter((job) => !prior.has(job.canonicalJobId || job.url))
  .sort((a, b) => hash(`academic-department-holdout-v3:${a.canonicalJobId || a.url}`) - hash(`academic-department-holdout-v3:${b.canonicalJobId || b.url}`))
  .slice(0, 80)
  .map((job) => ({
    id: job.canonicalJobId || job.url,
    title: job.titleClean || job.title || '',
    college: job.college || null,
    url: job.url || null,
    goldDepartment: null,
    departmentEvidence: null,
    departmentReviewStatus: 'unreviewed',
  }))
fs.mkdirSync(path.dirname(destination), { recursive: true })
fs.writeFileSync(destination, `${JSON.stringify(rows, null, 2)}\n`)
console.log(`Wrote ${rows.length} disjoint listings to ${destination}`)
