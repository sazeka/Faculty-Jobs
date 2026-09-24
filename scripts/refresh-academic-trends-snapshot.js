#!/usr/bin/env node
// Populate the current published snapshot without rewriting its narrative or
// inventing Department history for weeks that never recorded it.
import fs from 'node:fs'
import path from 'node:path'
import { computeDepartmentBreakdown } from './lib/weekly-department-stats.js'

const root = path.resolve(import.meta.dirname, '..')
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`)
const payload = read('public/jobs.json')
const history = read('generated/weekly-stats-history.json')
const out = read('public/data/weekly-trends.json')
const current = history.find((entry) => entry.weekEnd === out.weekEnd)
if (!current || out.stats?.totalJobs !== payload.jobs.length || current.totalJobs !== payload.jobs.length) {
  throw new Error('Current snapshot does not match the job feed; run the weekly generator instead')
}
const departmentBreakdown = computeDepartmentBreakdown(payload.jobs)
current.departmentBreakdown = departmentBreakdown
out.stats.departmentBreakdown = departmentBreakdown
out.history = out.history.map((week) => {
  const saved = history.find((entry) => entry.weekEnd === week.weekEnd)
  const department = saved?.departmentBreakdown
  return {
    ...week,
    departmentClassified: department?.classified ?? null,
    departmentUnknown: department?.unknown ?? null,
    departmentClassifiedPct: department?.classifiedPct ?? null,
  }
})
write('generated/weekly-stats-history.json', history)
write('public/data/weekly-trends.json', out)
write('docs/data/weekly-trends.json', out)
write('web-vue/public/data/weekly-trends.json', out)
console.log(`Refreshed ${out.weekEnd} Department coverage: ${departmentBreakdown.classified} of ${payload.jobs.length}`)
