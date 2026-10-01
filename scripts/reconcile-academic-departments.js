#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { extractAcademicUnit } from './lib/academic-unit-extraction.js'
import { cleanDepartment } from './lib/department-clean.js'
import { compareAcademicUnitNames } from './lib/academic-unit-name.js'

const root = path.resolve(import.meta.dirname, '..')
const targets = ['public/jobs.json', 'docs/jobs.json', 'web-vue/public/jobs.json']
const apply = process.argv.includes('--apply')
const allEvidence = process.argv.includes('--all-evidence')
const highConfidence = process.argv.includes('--high-confidence')
const reportPath = path.join(root, highConfidence ? 'generated/academic-department-reconciliation-report-high-confidence.json'
  : allEvidence ? 'generated/academic-department-reconciliation-report-all-evidence.json'
    : 'generated/academic-department-reconciliation-report.json')
if (apply && allEvidence) throw new Error('Experimental all-evidence extraction is report-only; apply reviewed labels instead')
if (highConfidence && allEvidence) throw new Error('Choose one extraction mode')
const payload = JSON.parse(fs.readFileSync(path.join(root, targets[0]), 'utf8'))
const jobsById = new Map(payload.jobs.map((job) => [job.canonicalJobId || job.url, job]))
const holdouts = highConfidence ? [
  JSON.parse(fs.readFileSync(path.join(root, 'generated/academic-department-holdout-v2.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(root, 'generated/academic-department-holdout-v3.json'), 'utf8')),
] : []
const audits = holdouts.map((holdout) => holdout.filter((row) => row.departmentReviewStatus === 'reviewed').map((row) => {
  const job = jobsById.get(row.id)
  if (!job) throw new Error(`Fresh holdout job is missing: ${row.id}`)
  const before = Object.hasOwn(job, 'departmentBeforeAcademicReview') ? job.departmentBeforeAcademicReview : job.department
  const candidate = extractAcademicUnit({ ...job, title: row.title, department: before })
  return { row, candidate }
}).filter(({ candidate }) => candidate.confidence === 'high' && candidate.department)).map((evaluated) => ({
  reviewed: evaluated.length,
  exact: evaluated.filter(({ row, candidate }) => compareAcademicUnitNames(candidate.department, row.goldDepartment) === 'exact').length,
  normalized: evaluated.filter(({ row, candidate }) => compareAcademicUnitNames(candidate.department, row.goldDepartment) !== 'different').length,
}))
const highConfidenceAudit = highConfidence ? { v2: audits[0], v3: audits[1] } : null
if (apply && highConfidence && audits.some((audit) => audit.reviewed < 20 || audit.normalized / audit.reviewed < 0.95 || audit.exact / audit.reviewed < 0.9)) {
  throw new Error('Independent high-confidence accuracy gate not met; review the dry-run report and continue source review')
}
const reviewedLabels = new Map([
  ...JSON.parse(fs.readFileSync(path.join(root, 'data/academic-field-reviewed-labels.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(root, 'generated/academic-department-holdout-v2.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(root, 'generated/academic-department-holdout-v3.json'), 'utf8')),
].filter((row) => row.departmentReviewStatus === 'reviewed').map((row) => [row.id, row]))
const changes = []
const jobs = payload.jobs.map((job) => {
  const label = reviewedLabels.get(job.canonicalJobId || job.url)
  if (!allEvidence && !highConfidence && !label) return job
  const extracted = allEvidence || highConfidence
    ? extractAcademicUnit(job)
    : { department: label.goldDepartment, evidence: label.departmentEvidence, source: 'source-reviewed' }
  const before = cleanDepartment(job.department)
  if (highConfidence && (extracted.confidence !== 'high' || before)) return job
  // Keep source-provided values when the saved posting has no stronger
  // evidence. An explicit title-derived subject was handled by the earlier
  // title backfill cleanup and is never restored here.
  const proposed = allEvidence && !extracted.evidence ? before : extracted.department
  if (proposed === before && (job.department == null || job.department === proposed)) return job
  changes.push({ id: job.canonicalJobId || job.url, title: job.title, before, rawBefore: job.department || null, after: proposed, source: extracted.source, evidence: extracted.evidence })
  if (!apply) return job
  return {
    ...job,
    department: proposed,
    departmentBeforeAcademicReview: Object.hasOwn(job, 'departmentBeforeAcademicReview') ? job.departmentBeforeAcademicReview : job.department || null,
    departmentSource: extracted.source,
    departmentEvidence: extracted.evidence,
  }
})

const report = {
  generatedAt: new Date().toISOString(),
  applied: apply,
  mode: allEvidence ? 'all-evidence' : highConfidence ? 'high-confidence-fill' : 'reviewed-only',
  highConfidenceAudit,
  totalJobs: jobs.length,
  changed: changes.length,
  filled: changes.filter((item) => !item.before && item.after).length,
  replaced: changes.filter((item) => item.before && item.after).length,
  cleared: changes.filter((item) => item.rawBefore && !item.after).length,
  bySource: Object.fromEntries([...new Set(changes.map((item) => item.source))].map((source) => [source, changes.filter((item) => item.source === source).length])),
  sample: changes.slice(0, 30),
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
if (apply) {
  const output = { ...payload, jobs }
  for (const target of targets) {
    const destination = path.join(root, target)
    if (fs.existsSync(destination)) fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`)
  }
}
console.log(JSON.stringify({ applied: apply, totalJobs: report.totalJobs, changed: report.changed, filled: report.filled, replaced: report.replaced, cleared: report.cleared, bySource: report.bySource, highConfidenceAudit }, null, 2))
console.log(`Report: ${reportPath}`)
