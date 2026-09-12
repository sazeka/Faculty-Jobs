#!/usr/bin/env node
// Central Virginia Community College's VA_CAMPUSES entry (server.js) queries
// jobs.vccs.edu -- the single statewide PeopleAdmin instance shared by all 23
// Virginia community colleges -- with no organizational-tier facet at all, so
// it was acting as a wrong catch-all bucket: every posting it turned up got
// labeled "Central Virginia Community College" regardless of which college the
// posting actually belonged to. Each posting's own description carries an
// "Agency: <real college>" field naming the true college. This backfills the
// college (and derived location) for every already-scraped job caught by that
// bug, using the same extractVccsCollegeFromText() the scraper itself now
// uses going forward (see server.js scrapePeopleAdminAs).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractVccsCollegeFromText } from './lib/labeled-posting-fields.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const TARGETS = ['public/jobs.json', 'docs/jobs.json', 'web-vue/public/jobs.json']
const REPORT_PATH = path.join(ROOT, 'generated', 'vccs-college-attribution-fix-report.json')
const MISATTRIBUTED_COLLEGE = 'Central Virginia Community College'

const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))
const changes = []

const jobs = source.jobs.map((job) => {
  if (job.college !== MISATTRIBUTED_COLLEGE || !job.description) return job
  const realCollege = extractVccsCollegeFromText(job.description)
  if (!realCollege || realCollege === MISATTRIBUTED_COLLEGE) return job

  const oldLocation = job.location
  const newLocation = oldLocation === `${MISATTRIBUTED_COLLEGE}, VA` ? `${realCollege}, VA` : oldLocation
  changes.push({ url: job.url, title: job.title, from: MISATTRIBUTED_COLLEGE, to: realCollege, oldLocation, newLocation })
  return { ...job, college: realCollege, location: newLocation }
})

const report = { generatedAt: new Date().toISOString(), dryRun: DRY_RUN, fixed: changes.length, changes }
console.log(JSON.stringify(report, null, 2))
if (!DRY_RUN) {
  const output = { ...source, count: jobs.length, jobs }
  for (const relative of TARGETS) fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`)
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}
