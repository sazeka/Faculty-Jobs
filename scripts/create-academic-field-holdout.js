#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const destination = path.join(root, 'generated/academic-field-holdout.json')
if (fs.existsSync(destination) && !process.argv.includes('--force')) throw new Error(`Holdout already exists: ${destination}`)
const raw = JSON.parse(fs.readFileSync(path.join(root, 'public/jobs.json'), 'utf8'))
const jobs = Array.isArray(raw) ? raw : raw.jobs
const development = new Set(JSON.parse(fs.readFileSync(path.join(root, 'generated/academic-field-review-sample.json'), 'utf8')).map((row) => row.id))
const hash = (value) => {
  let h = 2166136261
  for (const char of value) h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0
  return h
}
const unique = [...new Map(jobs.map((job) => [job.canonicalJobId || job.url, job])).values()]
const holdout = unique
  .filter((job) => !development.has(job.canonicalJobId || job.url))
  .sort((a, b) => hash(`academic-holdout:${a.canonicalJobId || a.url}`) - hash(`academic-holdout:${b.canonicalJobId || b.url}`))
  .slice(0, 100)
  .map((job) => ({
    id: job.canonicalJobId || job.url,
    title: job.titleClean || job.title || '',
    college: job.college || null,
    url: job.url || null,
    rawDepartment: job.department || null,
    goldDepartment: null,
    goldDiscipline: null,
    goldSubdiscipline: null,
    departmentReviewStatus: 'unreviewed',
    disciplineReviewStatus: 'unreviewed',
    subdisciplineReviewStatus: 'unreviewed',
    reviewStatus: 'unreviewed',
  }))
fs.writeFileSync(destination, `${JSON.stringify(holdout, null, 2)}\n`)
console.log(`Wrote ${holdout.length} disjoint holdout listings to ${destination}`)
