#!/usr/bin/env node
// Rebuild named academic-category counts from the job feed saved with each
// weekly digest. A week is accepted only when its archived feed matches the
// published total for that week.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { computeAcademicCategorySnapshot, updateAcademicCategoryHistory } from './lib/weekly-academic-category-stats.js'

const root = path.resolve(import.meta.dirname, '..')
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const write = (relative, value) => {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`)
}
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 160 * 1024 * 1024 })

const current = read('docs/data/weekly-trends.json')
const recent = read('generated/weekly-stats-history.json').slice(-12)
const existing = read('generated/weekly-academic-category-history.json')
if (recent.at(-1)?.weekEnd !== current.weekEnd) throw new Error('Weekly history and current digest disagree')
if (!existing.some((week) => week.weekEnd === current.weekEnd)) throw new Error('Current category snapshot is missing')

const wanted = new Map(recent.map((week) => [week.weekEnd, week.totalJobs]))
const commits = git('log', '--all', '--format=%H', '--grep=^Weekly trends digest$').toString().trim().split('\n')
const matching = new Map()
for (const commit of commits) {
  let digest
  try { digest = JSON.parse(git('show', `${commit}:docs/data/weekly-trends.json`)) } catch { continue }
  if (wanted.get(digest.weekEnd) === digest.stats?.totalJobs && !matching.has(digest.weekEnd)) {
    matching.set(digest.weekEnd, commit)
  }
}

let weeks = existing
for (const [weekEnd, totalJobs] of wanted) {
  if (weeks.some((week) => week.weekEnd === weekEnd)) continue
  const commit = matching.get(weekEnd)
  if (!commit) throw new Error(`No matching archived weekly digest for ${weekEnd}`)
  const payload = JSON.parse(git('show', `${commit}:public/jobs.json`))
  if (!Array.isArray(payload.jobs) || payload.jobs.length !== totalJobs) {
    throw new Error(`Archived job count differs from weekly digest for ${weekEnd}`)
  }
  const snapshot = computeAcademicCategorySnapshot(payload.jobs, weekEnd)
  snapshot.sourceCommit = commit
  weeks = updateAcademicCategoryHistory(weeks, snapshot)
  console.log(`${weekEnd}: ${totalJobs.toLocaleString()} jobs, ${Object.keys(snapshot.disciplines).length.toLocaleString()} disciplines, ${Object.keys(snapshot.departments).length.toLocaleString()} Departments`)
}

if (weeks.length !== recent.length || weeks.some((week, i) => week.weekEnd !== recent[i].weekEnd)) {
  throw new Error('Reconstructed category weeks do not match recent weekly history')
}
const output = { weekEnd: current.weekEnd, generatedAt: current.generatedAt, weeks }
write('generated/weekly-academic-category-history.json', weeks)
for (const relative of [
  'docs/data/weekly-academic-categories.json',
  'public/data/weekly-academic-categories.json',
  'web-vue/public/data/weekly-academic-categories.json',
]) write(relative, output)
console.log(`Saved ${weeks.length} weekly category snapshots`)
