import { getPositionFilterTypes } from '../../web-vue/src/lib/jobClassification.js'
import { getPositionDisplayRoles } from './weekly-position-type-stats.js'

export const POSITION_LABELS = [
  'Professor', 'Assistant Professor', 'Associate Professor', 'Full Professor',
  'Lecturer', 'Instructor', 'Clinical Faculty', 'Research Faculty',
  'Adjunct', 'Visiting Faculty', 'Teaching Faculty', 'Postdoctoral', 'Faculty',
]

export function scorePositionLabels(rows) {
  const labels = POSITION_LABELS.filter((label) => label !== 'Faculty')
  const perLabel = labels.map((label) => {
    let truePositive = 0
    let falsePositive = 0
    let falseNegative = 0
    for (const row of rows) {
      const gold = row.gold.includes(label)
      const predicted = row.predicted.includes(label)
      if (gold && predicted) truePositive++
      else if (predicted) falsePositive++
      else if (gold) falseNegative++
    }
    return {
      label,
      support: truePositive + falseNegative,
      precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null,
      recall: truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : null,
      truePositive,
      falsePositive,
      falseNegative,
    }
  })
  const exact = rows.filter((row) =>
    row.gold.length === row.predicted.length && row.gold.every((label) => row.predicted.includes(label))
  ).length
  return { count: rows.length, exactMatch: rows.length ? exact / rows.length : null, perLabel }
}

export function evaluatePositionSample(sample, jobs) {
  const byId = new Map(jobs.map((job) => [job.canonicalJobId || job.url, job]))
  const byUrl = new Map()
  for (const job of jobs) {
    if (!job.url) continue
    byUrl.set(job.url, byUrl.has(job.url) ? null : job)
  }
  const rows = []
  const missing = []
  const changed = []
  for (const annotation of sample) {
    const job = byId.get(annotation.id) || (annotation.url ? byUrl.get(annotation.url) : null)
    if (!job) { missing.push(annotation.id); continue }
    const title = job.titleClean || job.title || ''
    if (annotation.title && annotation.title !== title) {
      changed.push({ id: annotation.id, reviewedTitle: annotation.title, currentTitle: title })
      continue
    }
    if (!Array.isArray(annotation.gold) || annotation.gold.some((label) => !POSITION_LABELS.includes(label))) {
      throw new Error(`Invalid gold labels for ${annotation.id}`)
    }
    rows.push({
      ...annotation,
      title,
      stored: job.positionType || null,
      predicted: getPositionFilterTypes(title, job.rank),
      ...(Array.isArray(annotation.roleGold) ? { predictedRoles: getPositionDisplayRoles(job) } : {}),
    })
  }
  return { ...scorePositionLabels(rows), rows, missing, changed }
}
