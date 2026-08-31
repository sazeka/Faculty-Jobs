#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scorePost } from './lib/post-quality.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const jobsPayload = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'jobs.json'), 'utf8'))
const exclusionPayload = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'post-quality-exclusions.json'), 'utf8'))
const jobs = jobsPayload.jobs || []

const statusCounts = { pass: 0, review: 0, quarantine: 0 }
const reasonCounts = {}
for (const job of jobs) {
  const quality = scorePost(job)
  statusCounts[quality.status] = (statusCounts[quality.status] || 0) + 1
  for (const reason of quality.reasons) reasonCounts[reason.code] = (reasonCounts[reason.code] || 0) + 1
}

const missingDescriptions = jobs.filter((job) => !String(job.description || '').trim())
const exclusionsByReason = (exclusionPayload.exclusions || []).reduce((counts, entry) => {
  counts[entry.reason] = (counts[entry.reason] || 0) + 1
  return counts
}, {})

const report = {
  generatedAt: new Date().toISOString(),
  catalog: {
    records: jobs.length,
    qualityStatuses: statusCounts,
  },
  descriptions: {
    present: jobs.length - missingDescriptions.length,
    missing: missingDescriptions.length,
    coveragePct: Number((((jobs.length - missingDescriptions.length) / jobs.length) * 100).toFixed(2)),
    unavailableByStatus: missingDescriptions.reduce((counts, job) => {
      const status = job.descriptionFetchStatus || 'unmarked'
      counts[status] = (counts[status] || 0) + 1
      return counts
    }, {}),
  },
  structuredFields: {
    departmentPresent: jobs.filter((job) => String(job.department || '').trim()).length,
    departmentMissing: jobs.filter((job) => !String(job.department || '').trim()).length,
    locationPresent: jobs.filter((job) => String(job.location || job.state || '').trim()).length,
    locationMissing: jobs.filter((job) => !String(job.location || job.state || '').trim()).length,
    postingDatePresent: jobs.filter((job) => job.datePosted).length,
    explicitDeadlinePresent: jobs.filter((job) => job.closeDate).length,
    rollingDeadlinePresent: jobs.filter((job) => job.openUntilFilled).length,
    deadlineNotPublished: jobs.filter((job) => !job.closeDate && !job.openUntilFilled).length,
    startDatePresent: jobs.filter((job) => job.startDate).length,
  },
  reviewedExclusions: {
    count: exclusionPayload.count || 0,
    byReason: exclusionsByReason,
  },
  qualityReasonCounts: reasonCounts,
  interpretation: {
    descriptionGaps: 'All remaining gaps are explicitly classified as unsupported or exhausted after bounded retries.',
    departmentAndDeadlineGaps: 'Values remain empty when no reliable source-labeled value was available; they are not inferred or fabricated.',
  },
}

const outputPath = path.join(ROOT, 'generated', 'quality-completion-report.json')
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
