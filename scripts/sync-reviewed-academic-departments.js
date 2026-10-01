#!/usr/bin/env node
// Copy only source-reviewed Department corrections into the published indexes
// and chunks. Preserve other generated data and avoid a full site rebuild.
import fs from 'node:fs'
import path from 'node:path'
import { compactListingJob } from './lib/jobs-listing-index.js'

const root = path.resolve(import.meta.dirname, '..')
const apply = process.argv.includes('--apply')
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const source = read(path.join(root, 'public/jobs.json'))
const jobs = new Map(source.jobs.map((job) => [job.canonicalJobId || job.url, job]))
const reviewed = new Map([
  ...read(path.join(root, 'data/academic-field-reviewed-labels.json')),
  ...read(path.join(root, 'generated/academic-department-holdout-v2.json')),
  ...read(path.join(root, 'generated/academic-department-holdout-v3.json')),
].filter((row) => row.departmentReviewStatus === 'reviewed').map((row) => [row.id, row]))
for (const [id, row] of reviewed) {
  if (!jobs.has(id) || jobs.get(id).department !== row.goldDepartment) throw new Error(`Reviewed correction missing from jobs.json: ${id}`)
}
const fields = ['department', 'departmentBeforeAcademicReview', 'departmentSource', 'departmentEvidence']
const summary = []
for (const relative of ['docs/data', 'public/data', 'web-vue/public/data']) {
  const directory = path.join(root, relative)
  let chunkChanged = 0
  const foundInChunks = new Set()
  for (const name of fs.readdirSync(path.join(directory, 'chunks')).filter((name) => name.endsWith('.json'))) {
    const file = path.join(directory, 'chunks', name)
    const payload = read(file)
    let changed = false
    for (const row of payload.jobs || []) {
      const id = row.canonicalJobId || row.url
      if (!reviewed.has(id)) continue
      foundInChunks.add(id)
      const job = jobs.get(id)
      for (const field of fields) {
        if (job[field] === undefined) {
          if (field in row) { delete row[field]; changed = true }
        } else if (row[field] !== job[field]) {
          row[field] = job[field]
          changed = true
        }
      }
    }
    if (changed) {
      chunkChanged++
      if (apply) fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
    }
  }
  const indexPath = path.join(directory, 'jobs-index.json')
  const index = read(indexPath)
  let indexChanged = 0
  const foundInIndex = new Set()
  for (const row of index.jobs || []) {
    const id = row.canonicalJobId || row.url
    if (!reviewed.has(id)) continue
    foundInIndex.add(id)
    const compact = compactListingJob(jobs.get(id))
    if (row.department !== compact.department || row.searchText !== compact.searchText) {
      if (compact.department === undefined) delete row.department
      else row.department = compact.department
      row.searchText = compact.searchText
      indexChanged++
    }
  }
  if (foundInChunks.size !== reviewed.size || foundInIndex.size !== reviewed.size) {
    throw new Error(`${relative}: reviewed rows missing from chunks or listing index (${foundInChunks.size}/${foundInIndex.size}/${reviewed.size})`)
  }
  if (apply && indexChanged) fs.writeFileSync(indexPath, `${JSON.stringify(index)}\n`)
  summary.push({ directory: relative, chunkFilesChanged: chunkChanged, indexRowsChanged: indexChanged })
}
console.log(JSON.stringify({ applied: apply, reviewed: reviewed.size, summary }, null, 2))
