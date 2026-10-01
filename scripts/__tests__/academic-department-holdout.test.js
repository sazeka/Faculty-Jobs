import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '../..')
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))

test('Department holdouts are disjoint and reviewed labels are source grounded', () => {
  const v2 = read('generated/academic-department-holdout-v2.json')
  const v3 = read('generated/academic-department-holdout-v3.json')
  const earlier = new Set([
    ...read('generated/academic-field-review-sample.json'),
    ...read('generated/academic-field-holdout.json'),
  ].map((row) => row.id))
  const jobs = new Map(read('public/jobs.json').jobs.map((job) => [job.canonicalJobId || job.url, job]))
  for (const [rows, expectedLength, reviewed] of [[v2, 100, 68], [v3, 80, 50]]) {
    assert.equal(rows.length, expectedLength)
    assert.equal(new Set(rows.map((row) => row.id)).size, expectedLength)
    assert.equal(rows.filter((row) => row.departmentReviewStatus === 'reviewed').length, reviewed)
    for (const row of rows) {
      assert.equal(earlier.has(row.id), false)
      if (row.departmentReviewStatus !== 'reviewed') continue
      const description = jobs.get(row.id)?.description || ''
      if (row.goldDepartment) {
        const source = `${row.title} ${description}`.replace(/\s+/g, ' ').toLowerCase()
        assert.ok(source.includes(row.departmentEvidence.toLowerCase()), row.id)
      } else {
        assert.equal(row.departmentEvidence, null)
        assert.ok(row.departmentReviewNote, row.id)
        assert.ok(description.length >= 2500 && description.length < 4000, row.id)
      }
    }
    for (const row of rows) earlier.add(row.id)
  }
})
