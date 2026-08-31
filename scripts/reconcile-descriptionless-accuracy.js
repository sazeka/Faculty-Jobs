#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeReviewedUrl } from './lib/post-quality-exclusions.js'
import { scorePost } from './lib/post-quality.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REVIEWED_AT = '2026-08-31'
const TARGETS = ['public/jobs.json', 'docs/jobs.json', 'web-vue/public/jobs.json']
const EXCLUSIONS_PATH = path.join(ROOT, 'data', 'post-quality-exclusions.json')
const PRIOR_REPORT_PATH = path.join(ROOT, 'generated', 'post-quality-backlog-reconciliation.json')
const DEAD_REPORT_PATH = path.join(ROOT, 'generated', 'job-url-dead.json')
const REPORT_PATH = path.join(ROOT, 'generated', 'descriptionless-accuracy-reconciliation.json')

function readJson(filePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return fallback }
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function isHandbookOrAgreement(job) {
  return !clean(job?.description || job?.summary)
    && /\b(?:collective bargaining agreement|faculty handbook)\b/i.test(clean(job?.title))
}

function isGenericFacultyApplication(job) {
  if (job?.college === 'Texas Southern University' && job?.title === 'General Adjunct/Visiting Faculty Application') return false
  return !clean(job?.description || job?.summary)
    && /\b(?:application form for (?:adjunct )?faculty|(?:adjunct )?faculty application|application for employment|general adjunct\/visiting faculty application|online adjunct faculty application)\b/i.test(clean(job?.title))
}

const payload = readJson(path.join(ROOT, TARGETS[0]))
const previousReport = readJson(REPORT_PATH)
const priorReport = readJson(PRIOR_REPORT_PATH)
const deadReport = readJson(DEAD_REPORT_PATH, { jobs: [] })
const existingLedger = readJson(EXCLUSIONS_PATH, { exclusions: [] })
const exclusions = new Map()

function addExclusion(entry) {
  const url = normalizeReviewedUrl(entry?.url)
  if (!url) return
  exclusions.set(url, {
    url: clean(entry.url),
    college: clean(entry.college) || null,
    title: clean(entry.title) || null,
    reason: clean(entry.reason) || 'reviewed_non_posting',
    reviewedAt: clean(entry.reviewedAt) || REVIEWED_AT,
  })
}

for (const entry of existingLedger.exclusions || []) addExclusion(entry)
for (const entry of priorReport.removals || []) addExclusion(entry)
for (const entry of priorReport.linkActions || []) {
  if (entry.remove) addExclusion({ ...entry, url: entry.oldUrl, reason: entry.remove })
}

const deadByUrl = new Map((deadReport.jobs || []).map((entry) => [normalizeReviewedUrl(entry.url), entry]))
const removed = []
const kept = []
let retainedApplicantPoolReviewed = 0
let atypicalAcademicAppointmentsReviewed = 0
let futurePostingDatesCleared = 0

for (const original of payload.jobs || []) {
  let reason = null
  if (isHandbookOrAgreement(original)) reason = 'faculty_handbook_or_agreement'
  else if (isGenericFacultyApplication(original)) reason = 'generic_faculty_application_without_vacancy'
  else if (deadByUrl.has(normalizeReviewedUrl(original.url))) {
    const dead = deadByUrl.get(normalizeReviewedUrl(original.url))
    reason = dead.status === 'dead' ? 'confirmed_dead_url' : 'homepage_redirect_or_nonposting'
  }
  else if (scorePost(original).reasons.some((entry) => entry.code === 'expired_posting')) reason = 'expired_posting'

  if (reason) {
    const entry = {
      url: clean(original.url),
      college: clean(original.college),
      title: clean(original.title),
      reason,
      reviewedAt: REVIEWED_AT,
    }
    addExclusion(entry)
    removed.push(entry)
    continue
  }

  let next = original
  if (scorePost(original).reasons.some((entry) => entry.code === 'future_posting_date')) {
    const { datePosted: _futureDate, ...withoutFutureDate } = original
    next = withoutFutureDate
    futurePostingDatesCleared += 1
  }

  if (next.college === 'Texas Southern University' && next.title === 'General Adjunct/Visiting Faculty Application') {
    kept.push({ ...next, qualityEvidence: 'reviewed-academic-appointment', qualityReviewedAt: REVIEWED_AT })
    retainedApplicantPoolReviewed += 1
  } else if (next.url === 'https://jobs.rutgers.edu/postings/269509' && next.title === 'Senior Researchers (Faculty)') {
    kept.push({ ...next, qualityEvidence: 'reviewed-academic-appointment', qualityReviewedAt: REVIEWED_AT })
    atypicalAcademicAppointmentsReviewed += 1
  } else {
    kept.push(next)
  }
}

const nextPayload = { ...payload, count: kept.length, jobs: kept }
for (const relative of TARGETS) writeJson(path.join(ROOT, relative), nextPayload)

const ledger = {
  updatedAt: REVIEWED_AT,
  count: exclusions.size,
  exclusions: [...exclusions.values()].sort((a, b) => a.url.localeCompare(b.url)),
}
writeJson(EXCLUSIONS_PATH, ledger)

const report = {
  reviewedAt: REVIEWED_AT,
  beforeCount: payload.jobs?.length || 0,
  afterCount: kept.length,
  removedCount: removed.length,
  retainedApplicantPoolReviewed,
  atypicalAcademicAppointmentsReviewed,
  futurePostingDatesCleared,
  reasonCounts: removed.reduce((counts, entry) => {
    counts[entry.reason] = (counts[entry.reason] || 0) + 1
    return counts
  }, {}),
  exclusionLedgerCount: exclusions.size,
  previousRun: previousReport?.removedCount ? {
    beforeCount: previousReport.beforeCount,
    afterCount: previousReport.afterCount,
    removedCount: previousReport.removedCount,
    reasonCounts: previousReport.reasonCounts,
  } : null,
  removed,
}
writeJson(REPORT_PATH, report)
console.log(JSON.stringify(report, null, 2))
