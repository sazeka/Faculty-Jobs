#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractPostingDatesFromText } from './lib/posting-dates.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = ['public/jobs.json', 'docs/jobs.json', 'web-vue/public/jobs.json']
const REPORT_PATH = path.join(ROOT, 'generated', 'description-date-backfill-report.json')
const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))
let datesAdded = 0
let deadlinesAdded = 0
let rollingAdded = 0

const jobs = source.jobs.map((job) => {
  if (!job.description || (job.datePosted && (job.closeDate || job.openUntilFilled))) return job
  const extracted = extractPostingDatesFromText(job.description)
  let next = job
  if (!job.datePosted && extracted.datePosted) {
    next = { ...next, datePosted: extracted.datePosted }
    datesAdded++
  }
  if (!job.closeDate && !job.openUntilFilled && extracted.closeDate) {
    next = { ...next, closeDate: extracted.closeDate }
    deadlinesAdded++
  } else if (!job.closeDate && !job.openUntilFilled && extracted.openUntilFilled) {
    next = { ...next, openUntilFilled: true }
    rollingAdded++
  }
  return next
})

const output = { ...source, count: jobs.length, jobs }
for (const relative of TARGETS) fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`)
const report = { generatedAt: new Date().toISOString(), jobs: jobs.length, datesAdded, deadlinesAdded, rollingAdded }
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
