#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferDepartmentFromTitle } from './lib/department-inference.js'
import { readJobsFile, writeJobsFile } from './lib/jobs-file.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JOBS_PATH = path.join(ROOT, 'public/jobs.json')
const REPORT_PATH = path.join(ROOT, 'generated', 'department-backfill-report.json')
const source = readJobsFile(JOBS_PATH)

let filled = 0

const jobs = source.jobs.map((job) => {
  if (job.department && String(job.department).trim()) return job
  const titleMatch = inferDepartmentFromTitle(job.title)
  if (!titleMatch) return job
  filled++
  return { ...job, department: titleMatch, departmentInferredFrom: 'title' }
})

const output = { ...source, count: jobs.length, jobs }
writeJobsFile(JOBS_PATH, output)

const report = { generatedAt: new Date().toISOString(), totalJobs: jobs.length, filledFromTitle: filled }
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
