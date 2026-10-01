#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { scoreAcademicFields, predictAcademicFields } from './lib/academic-field-benchmark.js'
import { extractAcademicUnit } from './lib/academic-unit-extraction.js'
import { compareAcademicUnitNames } from './lib/academic-unit-name.js'

const root = path.resolve(import.meta.dirname, '..')
const fixturePath = path.join(root, 'data/academic-field-benchmark.json')
const samplePath = path.join(root, 'generated/academic-field-review-sample.json')
const holdoutPath = path.join(root, 'generated/academic-field-holdout.json')
const departmentHoldoutV2Path = path.join(root, 'generated/academic-department-holdout-v2.json')
const departmentHoldoutV3Path = path.join(root, 'generated/academic-department-holdout-v3.json')
const reportPath = path.join(root, 'generated/academic-field-benchmark-report.json')
const reviewedReportPath = path.join(root, 'generated/academic-field-benchmark-report-reviewed.json')
const candidateReportPath = path.join(root, 'generated/academic-field-benchmark-report-candidate-extraction.json')
const sourceBaselineReportPath = path.join(root, 'generated/academic-field-benchmark-report-source-baseline.json')
const holdoutReportPath = path.join(root, 'generated/academic-field-benchmark-report-holdout.json')
const holdoutCandidateReportPath = path.join(root, 'generated/academic-field-benchmark-report-holdout-candidate-extraction.json')
const departmentHoldoutV2ReportPath = path.join(root, 'generated/academic-department-holdout-v2-report.json')
const departmentHoldoutV2CandidateReportPath = path.join(root, 'generated/academic-department-holdout-v2-candidate-report.json')
const departmentHoldoutV3CandidateReportPath = path.join(root, 'generated/academic-department-holdout-v3-candidate-report.json')
const args = new Set(process.argv.slice(2))
const v2 = args.has('--score-department-holdout-v2')
const v3 = args.has('--score-department-holdout-v3')
if ((args.has('--candidate-extraction') || args.has('--source-baseline')) && !args.has('--reviewed') && !args.has('--score-holdout') && !v2 && !v3) {
  throw new Error('--candidate-extraction and --source-baseline require a reviewed sample or holdout')
}
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

if (args.has('--sample')) {
  if (fs.existsSync(samplePath) && !args.has('--force')) throw new Error(`Review sample already exists: ${samplePath}`)
  const raw = read(path.join(root, 'public/jobs.json'))
  const jobs = Array.isArray(raw) ? raw : raw.jobs
  const unique = [...new Map(jobs.map((job) => [job.canonicalJobId || job.url, job])).values()]
  const buckets = new Map()
  for (const job of unique) {
    const label = predictAcademicFields({ ...job, title: job.titleClean || job.title || '' }).discipline
    if (!buckets.has(label)) buckets.set(label, [])
    buckets.get(label).push(job)
  }
  // A fixed hash ranking makes the review set reproducible across runs and
  // keeps it independent of the current ordering of jobs.json.
  const hash = (s) => {
    let h = 2166136261
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
    return h
  }
  const sample = []
  const included = new Set()
  const sourceEvidence = (job) => {
    const description = String(job.description || '').replace(/\s+/g, ' ')
    const snippets = []
    const raw = String(job.department || '').trim()
    const index = raw ? description.toLowerCase().indexOf(raw.toLowerCase()) : -1
    if (index >= 0) snippets.push(description.slice(Math.max(0, index - 45), Math.min(description.length, index + raw.length + 75)))
    const unitPattern = /\b(?:Department|Division|School|College|Program|Institute|Center)\s+of\s+[A-Za-z][^.\n|]{3,100}/gi
    for (const match of description.matchAll(unitPattern)) {
      const snippet = description.slice(Math.max(0, match.index - 20), Math.min(description.length, match.index + 125))
      if (!snippets.some((s) => s.includes(match[0]))) snippets.push(snippet)
      if (snippets.length >= 4) break
    }
    return snippets
  }
  const add = (job, bucket) => {
    const id = job.canonicalJobId || job.url
    const title = job.titleClean || job.title || ''
    included.add(id)
    sample.push({
      id,
      bucket,
      title,
      college: job.college || null,
      url: job.url || null,
      rawDepartment: job.department || null,
      descriptionAvailable: Boolean(job.description),
      sourceEvidence: sourceEvidence(job),
      storedDiscipline: job.discipline || null,
      department: job.department || null,
      ...predictAcademicFields({ ...job, title }),
      goldDepartment: null,
      goldDiscipline: null,
      goldSubdiscipline: null,
      departmentReviewStatus: 'unreviewed',
      disciplineReviewStatus: 'unreviewed',
      subdisciplineReviewStatus: 'unreviewed',
      reviewStatus: 'unreviewed',
    })
  }
  // Select the population sample first so excluding reviewed strata cannot
  // bias its composition.
  for (const job of unique.sort((a, b) => hash(`random:${a.canonicalJobId || a.url}`) - hash(`random:${b.canonicalJobId || b.url}`))) {
    add(job, 'random')
    if (sample.length >= 100) break
  }
  for (const [bucket, members] of [...buckets].sort((a, b) => a[0].localeCompare(b[0]))) {
    let count = 0
    for (const job of members.sort((a, b) => hash(String(a.canonicalJobId || a.url)) - hash(String(b.canonicalJobId || b.url)))) {
      if (included.has(job.canonicalJobId || job.url)) continue
      add(job, bucket)
      if (++count >= 10) break
    }
  }
  const labelsPath = path.join(root, 'data/academic-field-reviewed-labels.json')
  if (fs.existsSync(labelsPath)) {
    const labels = new Map(read(labelsPath).map((row) => [row.id, row]))
    for (const row of sample) {
      const label = labels.get(row.id)
      if (!label) continue
      for (const key of ['goldDepartment', 'goldDiscipline', 'goldSubdiscipline', 'departmentEvidence', 'departmentReviewStatus', 'disciplineReviewStatus', 'subdisciplineReviewStatus', 'annotationMethod']) {
        if (Object.hasOwn(label, key)) row[key] = label[key]
      }
    }
  }
  write(samplePath, sample)
  console.log(`Wrote ${sample.length} listings (stratified and random) to ${samplePath}`)
} else {
  let rows = v3 ? read(departmentHoldoutV3Path) : v2 ? read(departmentHoldoutV2Path) : args.has('--score-holdout') ? read(holdoutPath) : args.has('--reviewed') ? read(samplePath) : read(fixturePath)
  if (args.has('--reviewed') || args.has('--score-holdout') || v2 || v3) {
    const raw = read(path.join(root, 'public/jobs.json'))
    const jobs = new Map((Array.isArray(raw) ? raw : raw.jobs).map((job) => [job.canonicalJobId || job.url, job]))
    rows = rows.map((row) => {
      const job = jobs.get(row.id)
      if (!job) return row
      const before = Object.hasOwn(job, 'departmentBeforeAcademicReview') ? job.departmentBeforeAcademicReview : job.department
      const extracted = args.has('--candidate-extraction') ? extractAcademicUnit({ ...job, title: row.title, department: before }) : null
      const department = extracted
        ? extracted.department
        : args.has('--source-baseline') ? before : job.department
      return { ...row, department, description: job.description, ...(extracted ? { extractionConfidence: extracted.confidence, extractionSource: extracted.source } : {}) }
    })
  }
  const result = scoreAcademicFields(rows)
  if ((args.has('--reviewed') || args.has('--score-holdout') || v2 || v3) && result.reviewed === 0) throw new Error('No reviewed annotations in sample')
  const randomSample = args.has('--reviewed') ? scoreAcademicFields(rows.filter((row) => row.bucket === 'random')) : null
  const extractionByConfidence = args.has('--candidate-extraction') ? Object.fromEntries(['high', 'medium', 'low', 'none'].map((level) => {
    const subset = rows.filter((row) => row.departmentReviewStatus === 'reviewed' && row.extractionConfidence === level)
    const predicted = subset.filter((row) => row.department).length
    const exact = subset.filter((row) => compareAcademicUnitNames(row.department, row.goldDepartment) === 'exact').length
    const normalized = subset.filter((row) => compareAcademicUnitNames(row.department, row.goldDepartment) !== 'different').length
    return [level, { reviewed: subset.length, predicted, exact, normalized, exactAccuracy: subset.length ? exact / subset.length : null, normalizedAccuracy: subset.length ? normalized / subset.length : null }]
  })) : null
  const destination = v3 && args.has('--candidate-extraction') ? departmentHoldoutV3CandidateReportPath
    : v2 && args.has('--candidate-extraction') ? departmentHoldoutV2CandidateReportPath
    : v2 ? departmentHoldoutV2ReportPath
    : args.has('--score-holdout') && args.has('--candidate-extraction') ? holdoutCandidateReportPath
    : args.has('--score-holdout') ? holdoutReportPath
    : args.has('--candidate-extraction') ? candidateReportPath
    : args.has('--source-baseline') ? sourceBaselineReportPath
      : args.has('--reviewed') ? reviewedReportPath : reportPath
  write(destination, { generatedAt: new Date().toISOString(), source: v3 ? departmentHoldoutV3Path : v2 ? departmentHoldoutV2Path : args.has('--score-holdout') ? holdoutPath : args.has('--reviewed') ? samplePath : fixturePath, ...result, randomSample, extractionByConfidence })
  for (const [field, metric] of Object.entries(result.fields)) {
    if ((v2 || v3) && metric.reviewed === 0) continue
    const pct = (value) => value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`
    console.log(`${field}: ${metric.reviewed} reviewed, accuracy ${pct(metric.exactAccuracy)}${field === 'department' ? `, normalized ${pct(metric.normalizedAccuracy)}` : ''}, precision ${pct(metric.precision)}, recall ${pct(metric.recall)}`)
  }
  if (randomSample) console.log(`Random sample: ${randomSample.reviewed} reviewed`)
  console.log(`Report: ${destination}`)
  if (args.has('--check') && result.disagreements.length) process.exitCode = 1
}
