#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractDepartmentFromText, extractLocationFromText } from './lib/labeled-posting-fields.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const TARGETS = ['public/jobs.json', 'docs/jobs.json', 'web-vue/public/jobs.json']
const REPORT_PATH = path.join(ROOT, 'generated', 'labeled-posting-fields-report.json')
const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))
const changes = []
let departmentsAdded = 0
let locationsAdded = 0

const jobs = source.jobs.map((job) => {
  if (!job.description || (job.department && job.location)) return job
  const department = !job.department ? extractDepartmentFromText(job.description) : null
  const location = !job.location ? extractLocationFromText(job.description) : null
  if (!department && !location) return job
  if (department) departmentsAdded++
  if (location) locationsAdded++
  changes.push({ college: job.college, title: job.title, department, location, url: job.url })
  return {
    ...job,
    ...(department ? { department, departmentEvidence: 'labeled-description' } : {}),
    ...(location ? { location, locationEvidence: 'labeled-description' } : {}),
  }
})

const report = { generatedAt: new Date().toISOString(), dryRun: DRY_RUN, departmentsAdded, locationsAdded, sample: changes.slice(0, 100) }
console.log(JSON.stringify(report, null, 2))
if (!DRY_RUN) {
  const output = { ...source, count: jobs.length, jobs }
  for (const relative of TARGETS) fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`)
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify({ ...report, changes }, null, 2)}\n`)
}
