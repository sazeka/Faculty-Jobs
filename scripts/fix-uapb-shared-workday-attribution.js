#!/usr/bin/env node
// The former UAPB source pointed at the unscoped University of Arkansas
// System Workday board. Every faculty-like result from that shared tenant was
// consequently labeled "University of Arkansas at Pine Bluff", even when the
// posting itself named a different institution. The live source is now scoped
// by Workday's UAPB hiring-company facet; this migration removes the historical
// false copies already present in the published dataset.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const TARGETS = ['public/jobs.json', 'docs/jobs.json', 'web-vue/public/jobs.json']
const REPORT_PATH = path.join(ROOT, 'generated', 'uapb-shared-workday-attribution-fix-report.json')
const UAPB = 'University of Arkansas at Pine Bluff'

function isConfirmedUapbPosting(job) {
  return /Institution Name:\s*University of Arkansas at Pine Bluff\b/i.test(job.description || '')
}

function isNonAcademicPosting(job) {
  return /Type of Position:\s*Clerical\b/i.test(job.description || '')
}

function hasUncontradictedTenureTrackEvidence(job) {
  const description = job.description || ''
  const positive = /Type of Position:\s*Faculty\s*-\s*Tenure\/Tenure Track\b/i.test(description)
    || /\btenure-track faculty position\b/i.test(description)
  const negative = /Type of Position:\s*Faculty\s*-\s*Non-Tenure\b/i.test(description)
  return positive && !negative
}

const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))
const removed = []
const classified = []
const jobs = []

for (const job of source.jobs) {
  if (job.college !== UAPB) {
    jobs.push(job)
    continue
  }

  if (!isConfirmedUapbPosting(job)) {
    removed.push({ url: job.url, title: job.title, reason: 'posting names another institution' })
    continue
  }

  if (isNonAcademicPosting(job)) {
    removed.push({ url: job.url, title: job.title, reason: 'clerical posting, not an academic appointment' })
    continue
  }

  if (typeof job.tenureTrack !== 'boolean' && hasUncontradictedTenureTrackEvidence(job)) {
    const evidence = (job.description.match(/Type of Position:\s*Faculty\s*-\s*Tenure\/Tenure Track\b/i)
      || job.description.match(/\btenure-track faculty position\b/i))?.[0]
    classified.push({ url: job.url, title: job.title, tenureTrack: true, evidence })
    jobs.push({ ...job, tenureTrack: true, tenureEvidence: evidence })
    continue
  }

  jobs.push(job)
}

const report = {
  generatedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  before: source.jobs.length,
  after: jobs.length,
  removed: removed.length,
  classified: classified.length,
  removals: removed,
  classifications: classified,
}

console.log(JSON.stringify({ ...report, removals: `${removed.length} entries (see report file)` }, null, 2))

if (!DRY_RUN) {
  const output = { ...source, count: jobs.length, jobs }
  for (const relative of TARGETS) {
    fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`)
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}
