#!/usr/bin/env node
// canonicalInstitutionName() (scripts/lib/institution-aliases.js) is applied
// to every freshly scraped job, but jobs scraped before an alias was added
// to that map are stuck under the old, non-canonical college name. When the
// same posting URL was scraped under BOTH the alias and the canonical name
// (typically because the alias was added mid-way through the site's
// history), the two labels get different canonicalGroupIds and render as
// two separate vacancies (issue #119) instead of being recognized as the
// same job.
//
// This only merges an EXACT url match where both copies canonicalize to the
// same institution name -- i.e. a true spelling/name alias, not a
// system-vs-campus umbrella label (those need individual judgment, not a
// blanket auto-merge -- see the issue for the full list of candidate pairs).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalInstitutionName, isInstitutionAlias } from './lib/institution-aliases.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const TARGETS = ['public/jobs.json', 'docs/jobs.json']
const REPORT_PATH = path.join(ROOT, 'generated', 'institution-alias-duplicate-urls-fix-report.json')

const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))

// Normalize any job still under an alias to its canonical name first (this
// alone is what a fresh scrape would already do).
const renamed = []
let normalizedJobs = source.jobs.map((job) => {
  if (!isInstitutionAlias(job.college)) return job
  const canonical = canonicalInstitutionName(job.college)
  renamed.push({ url: job.url, from: job.college, to: canonical })
  return { ...job, college: canonical }
})

// Now drop exact-URL duplicates that resulted from the rename (keep the
// first occurrence). Only drop when the URL AND the (now-canonicalized)
// college both match a previously-kept job -- a URL shared across two
// DIFFERENT, non-aliased college labels (e.g. a system-umbrella vs. a
// specific campus) is a distinct, out-of-scope case left untouched here.
const seenByUrl = new Map()
const dropped = []
normalizedJobs = normalizedJobs.filter((job) => {
  if (!job.url) return true
  const prevCollege = seenByUrl.get(job.url)
  if (prevCollege === undefined) {
    seenByUrl.set(job.url, job.college)
    return true
  }
  if (prevCollege === job.college) {
    dropped.push({ url: job.url, title: job.title, college: job.college })
    return false
  }
  return true
})

const report = {
  generatedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  renamed: renamed.length,
  droppedDuplicates: dropped.length,
  renames: renamed,
  drops: dropped,
}
console.log(JSON.stringify(report, null, 2))
if (!DRY_RUN) {
  const output = { ...source, count: normalizedJobs.length, jobs: normalizedJobs }
  for (const relative of TARGETS) fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`)
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}
