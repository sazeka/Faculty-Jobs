#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { evaluatePositionSample } from './lib/position-type-benchmark.js'

const root = path.resolve(import.meta.dirname, '..')
const jobsPath = path.join(root, 'public/jobs.json')
const samplePath = path.join(root, 'generated/position-type-benchmark-sample.json')
const holdoutPath = path.join(root, 'generated/position-type-benchmark-holdout.json')
const rarePath = path.join(root, 'generated/position-type-benchmark-rare.json')
const reportPath = path.join(root, 'generated/position-type-benchmark-report.json')
const raw = JSON.parse(fs.readFileSync(jobsPath, 'utf8'))
const jobs = Array.isArray(raw) ? raw : raw.jobs

function shuffled(items, seed) {
  let state = seed >>> 0
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const j = state % (i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function sampleJobs(mode = 'main') {
  const unique = [...new Map(jobs.map((job) => [job.canonicalJobId || job.url, job])).values()]
  const excluded = new Set()
  const excludedUrls = new Set()
  if (mode !== 'main') {
    for (const file of [samplePath, ...(mode === 'rare' ? [holdoutPath] : [])]) {
      if (fs.existsSync(file)) for (const row of JSON.parse(fs.readFileSync(file, 'utf8'))) {
        excluded.add(row.id)
        if (row.url) excludedUrls.add(row.url)
      }
    }
  }
  const selected = new Map()
  const take = (bucket, candidates, count, seed) => {
    for (const job of shuffled(candidates, seed)) {
      const id = job.canonicalJobId || job.url
      if (selected.has(id) || excluded.has(id) || (job.url && excludedUrls.has(job.url))) continue
      selected.set(id, { id, url: job.url || null, bucket, title: job.titleClean || job.title || '', stored: job.positionType || null, gold: [], reviewStatus: 'unreviewed' })
      if ([...selected.values()].filter((item) => item.bucket === bucket).length === count) break
    }
  }
  const title = (job) => job.titleClean || job.title || ''
  if (mode === 'rare') {
    take('lecturer-review', unique.filter((job) => /\blecturers?\b/i.test(title(job))), 8, 301)
    take('research-review', unique.filter((job) => /\bresearch\b/i.test(title(job)) && /\b(?:professor|faculty|fellow)\b/i.test(title(job))), 8, 302)
    take('visiting-review', unique.filter((job) => /\bvisiting\b/i.test(title(job))), 8, 303)
    take('postdoctoral-review', unique.filter((job) => /\bpost[\s-]?(?:doc|doctoral)\b/i.test(title(job))), 8, 304)
    take('faculty-role-review', unique.filter((job) => /\bfaculty\b/i.test(title(job)) && !/\b(?:professor|lecturer|instructor|postdoc)\b/i.test(title(job))), 8, 305)
    take('faculty-nonrole-review', unique.filter((job) => /\bfaculty\s+(?:affairs|development|learning|support|services|success|relations|recruitment|resources|governance|engagement|training|evaluation|senate)\b/i.test(title(job))), 8, 306)
    return [...selected.values()]
  }
  if (mode === 'holdout') {
    take('random-holdout', unique, 80, 20260924)
    take('clinical-holdout', unique.filter((job) => /clinical/i.test(title(job)) || job.positionType === 'Clinical'), 10, 21)
    take('research-holdout', unique.filter((job) => /research/i.test(title(job)) || job.positionType === 'Research'), 10, 22)
    take('mixed-rank-holdout', unique.filter((job) => /\b(?:assistant|asst|associate|assoc|full)\b.*(?:\/|\bor\b|,).*\b(?:assistant|asst|associate|assoc|full|professor)\b/i.test(title(job))), 10, 23)
    take('generic-faculty-holdout', unique.filter((job) => /\bfaculty\b/i.test(title(job)) && !/\b(?:professor|lecturer|instructor|clinical|research|adjunct|visiting|postdoc)\b/i.test(title(job))), 10, 24)
    return [...selected.values()]
  }
  take('random', unique, 240, 20260923)
  take('clinical', unique.filter((job) => /clinical/i.test(title(job)) || job.positionType === 'Clinical'), 32, 11)
  take('research', unique.filter((job) => /research/i.test(title(job)) || job.positionType === 'Research'), 32, 12)
  take('mixed-rank', unique.filter((job) => /\b(?:assistant|asst|associate|assoc|full)\b.*(?:\/|\bor\b|,).*\b(?:assistant|asst|associate|assoc|full|professor)\b/i.test(title(job))), 32, 13)
  take('generic-faculty', unique.filter((job) => /\bfaculty\b/i.test(title(job)) && !/\b(?:professor|lecturer|instructor|clinical|research|adjunct|visiting|postdoc)\b/i.test(title(job))), 32, 14)
  take('stored-conflict', unique.filter((job) => job.positionType === 'Full Professor' && !/\bfull\s+professor\b/i.test(title(job))), 32, 15)
  return [...selected.values()]
}

if (process.argv.includes('--sample') || process.argv.includes('--holdout') || process.argv.includes('--rare-sample')) {
  const mode = process.argv.includes('--rare-sample') ? 'rare' : process.argv.includes('--holdout') ? 'holdout' : 'main'
  const destination = mode === 'rare' ? rarePath : mode === 'holdout' ? holdoutPath : samplePath
  if (fs.existsSync(destination) && !process.argv.includes('--force')) throw new Error(`Sample exists: ${destination}`)
  const sample = sampleJobs(mode)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, `${JSON.stringify(sample, null, 2)}\n`)
  console.log(`Wrote ${sample.length} listings to ${destination}`)
} else {
  const scoreRare = process.argv.includes('--score-rare')
  const scoreHoldout = process.argv.includes('--score-holdout')
  const sample = JSON.parse(fs.readFileSync(scoreRare ? rarePath : scoreHoldout ? holdoutPath : samplePath, 'utf8'))
  const reviewed = sample.filter((row) => row.reviewStatus === 'reviewed')
  if (!reviewed.length) throw new Error('No reviewed annotations in sample')
  const result = evaluatePositionSample(reviewed, jobs)
  if (!result.count) throw new Error('No reviewed listings match current public/jobs.json; the sample IDs are stale. Generate a fresh review set before scoring.')
  const random = evaluatePositionSample(reviewed.filter((row) => row.bucket.startsWith('random')), jobs)
  const report = { date: new Date().toISOString(), reviewed: reviewed.length, totalSample: sample.length, overallSample: { count: result.count, exactMatch: result.exactMatch, perLabel: result.perLabel }, randomSample: { count: random.count, exactMatch: random.exactMatch, perLabel: random.perLabel }, missing: result.missing, changed: result.changed, disagreements: result.rows.filter((row) => row.gold.length !== row.predicted.length || row.gold.some((label) => !row.predicted.includes(label))) }
  const roleRows = result.rows.filter((row) => Array.isArray(row.roleGold))
  if (roleRows.length) {
    const disagreements = roleRows.filter((row) => row.roleGold.length !== row.predictedRoles.length || row.roleGold.some((role) => !row.predictedRoles.includes(role)))
    report.roleReview = { count: roleRows.length, exactMatch: (roleRows.length - disagreements.length) / roleRows.length, disagreements }
  }
  const destination = scoreRare ? reportPath.replace('.json', '-rare.json') : scoreHoldout ? reportPath.replace('.json', '-holdout.json') : reportPath
  fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`)
  const percent = (value) => value === null ? 'n/a' : `${(100 * value).toFixed(1)}%`
  console.log(`Reviewed ${reviewed.length}/${sample.length}; scored ${result.count}; random exact match ${percent(random.exactMatch)}; all exact match ${percent(result.exactMatch)}`)
  if (report.roleReview) console.log(`Chart-role exact match ${percent(report.roleReview.exactMatch)} on ${report.roleReview.count} reviewed titles`)
  for (const row of result.perLabel) console.log(`${row.label.padEnd(22)} support ${String(row.support).padStart(3)}  precision ${row.precision === null ? 'n/a' : (100 * row.precision).toFixed(1) + '%'}  recall ${row.recall === null ? 'n/a' : (100 * row.recall).toFixed(1) + '%'}`)
  console.log(`Report: ${destination}`)
}
