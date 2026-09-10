#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferDepartmentFromTitle } from './lib/department-inference.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = ['public/jobs.json', 'docs/jobs.json', 'web-vue/public/jobs.json']
const REPORT_PATH = path.join(ROOT, 'generated', 'department-backfill-report.json')
const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))

let filled = 0

const jobs = source.jobs.map((job) => {
  if (job.department && String(job.department).trim()) return job
  const titleMatch = inferDepartmentFromTitle(job.title)
  if (!titleMatch) return job
  filled++
  return { ...job, department: titleMatch, departmentInferredFrom: 'title' }
})

const output = { ...source, count: jobs.length, jobs }
for (const relative of TARGETS) {
  const filePath = path.join(ROOT, relative)
  if (!fs.existsSync(filePath)) continue
  fs.writeFileSync(filePath, `${JSON.stringify(output, null, 2)}\n`)
}

const report = { generatedAt: new Date().toISOString(), totalJobs: jobs.length, filledFromTitle: filled }
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
