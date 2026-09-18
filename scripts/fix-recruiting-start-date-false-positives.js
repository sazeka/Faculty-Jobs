#!/usr/bin/env node
// Before scripts/lib/start-date.js rejected Workday's administrative/HR
// metadata labels ("Recruiting Start Date", "Posting Start Date",
// "Application Start Date", "Review Start Date"), extractStartDate() could
// grab one of those as the faculty appointment's anticipated start (issue
// #118). This recomputes startDate for every already-scraped job using the
// now-fixed extractor, so previously-derived false values get corrected or
// cleared rather than lingering (agent-job-descriptions.js and
// backfill-start-dates.js only ever fill an *empty* startDate, so a wrong
// value set before the fix would otherwise never self-heal).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractStartDate } from './lib/start-date.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const TARGETS = ['public/jobs.json', 'docs/jobs.json']
const REPORT_PATH = path.join(ROOT, 'generated', 'recruiting-start-date-fix-report.json')
// Only touch records whose description actually contains one of the
// administrative labels this fix targets — recomputing every job with a
// startDate would also pick up unrelated description drift (descriptions get
// periodically refreshed) that has nothing to do with this bug.
const ADMIN_LABEL = /(recruiting|posting|application|review|screening)\s+start\s+date/i

const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))
const changes = []

const jobs = source.jobs.map((job) => {
  if (!job.startDate || !job.description || !ADMIN_LABEL.test(job.description)) return job
  const recomputed = extractStartDate(job.description)
  if (recomputed === job.startDate) return job
  changes.push({ url: job.url, title: job.title, from: job.startDate, to: recomputed })
  return { ...job, startDate: recomputed || undefined }
})

const report = { generatedAt: new Date().toISOString(), dryRun: DRY_RUN, fixed: changes.length, changes }
console.log(JSON.stringify(report, null, 2))
if (!DRY_RUN) {
  const output = { ...source, jobs }
  for (const relative of TARGETS) fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`)
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}
