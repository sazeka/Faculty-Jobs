#!/usr/bin/env node
// Seed selectable category history from the current published week without
// rewriting the weekly narrative or inventing older category counts.
import fs from 'node:fs'
import path from 'node:path'
import { computeAcademicCategorySnapshot, updateAcademicCategoryHistory } from './lib/weekly-academic-category-stats.js'

const root = path.resolve(import.meta.dirname, '..')
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const write = (relative, value) => {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`)
}
const payload = read('public/jobs.json')
const trends = read('public/data/weekly-trends.json')
if (trends.stats?.totalJobs !== payload.jobs.length) throw new Error('Job feed and weekly digest totals differ')
const historyFile = path.join(root, 'generated/weekly-academic-category-history.json')
const previous = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : []
const weeks = updateAcademicCategoryHistory(previous, computeAcademicCategorySnapshot(payload.jobs, trends.weekEnd))
const output = { weekEnd: trends.weekEnd, generatedAt: trends.generatedAt, weeks }
write('generated/weekly-academic-category-history.json', weeks)
for (const relative of [
  'docs/data/weekly-academic-categories.json',
  'public/data/weekly-academic-categories.json',
  'web-vue/public/data/weekly-academic-categories.json',
]) write(relative, output)
console.log(`Seeded ${weeks.length} recorded week(s) of academic category counts`)
