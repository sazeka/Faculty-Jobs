#!/usr/bin/env node
// Add only source-supported labels to the previously frozen v2 sample.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const file = path.join(root, 'generated/academic-department-holdout-v2.json')
const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
const payload = JSON.parse(fs.readFileSync(path.join(root, 'public/jobs.json'), 'utf8'))
const jobs = new Map((Array.isArray(payload) ? payload : payload.jobs).map((job) => [job.canonicalJobId || job.url, job]))

const positive = new Map([
  [19, ['Applied Sciences', 'Reports to: Dean of Applied Sciences']],
  [31, ['Lifelong Learning Program', 'adjunct instructors in the Lifelong Learning Program']],
  [38, ['Social Science', 'Department: Social Science Location:']],
  [40, ['Public Health Program', 'The Public Health Program at Langston University is seeking qualified adjunct faculty']],
  [71, ['Physical Education', 'Department Physical Education Initial Screening Date']],
  [73, ['General Education and Developmental Studies Department', 'This position reports to LSCPA’s General Education and Developmental Studies Department']],
  [74, ['Institute for Experiential AI', "Northeastern University's Institute for Experiential AI has established a position"]],
  [78, ['Public Administration', 'Division Public Administration Opening Date']],
  [95, ['Computer Science program', 'Teach lecture and laboratory courses in Computer Science program']],
  [97, ['History and Political Science department', 'Chair of the History and Political Science department']],
])
const noNamedUnit = new Map([
  [27, 'Complete posting names a subject and an unnamed School, but no hiring unit.'],
  [39, 'Complete generic adjunct posting names no hiring academic unit.'],
  [41, 'Complete training partnership posting names a training program, but no hiring academic unit.'],
  [61, 'Complete generic adjunct posting names no hiring academic unit.'],
  [75, 'Complete posting names course subject only; no hiring academic unit.'],
])

for (const [number, [name, quote]] of positive) {
  const row = rows[number - 1]
  if (row.departmentReviewStatus !== 'unreviewed') throw new Error(`Row ${number} was already reviewed`)
  const job = jobs.get(row.id)
  if (!job) throw new Error(`Missing job for row ${number}`)
  const source = `${row.title} ${job.description || ''}`.replace(/\s+/g, ' ')
  if (!source.toLowerCase().includes(quote.toLowerCase())) throw new Error(`Evidence missing for row ${number}: ${quote}`)
  row.goldDepartment = name
  row.departmentEvidence = quote
  row.departmentReviewStatus = 'reviewed'
}
for (const [number, note] of noNamedUnit) {
  const row = rows[number - 1]
  if (row.departmentReviewStatus !== 'unreviewed') throw new Error(`Row ${number} was already reviewed`)
  const description = String(jobs.get(row.id)?.description || '')
  if (description.length < 2500 || description.length >= 4000) throw new Error(`Cannot verify complete source for row ${number}`)
  row.goldDepartment = null
  row.departmentEvidence = null
  row.departmentReviewStatus = 'reviewed'
  row.departmentReviewNote = note
}
fs.writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`)
console.log(`Reviewed ${positive.size} additional named units and ${noNamedUnit.size} complete postings with no named unit`)
