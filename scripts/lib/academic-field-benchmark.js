import { getDiscipline, getSubdiscipline } from '../../web-vue/src/composables/useJobFilters.js'
import { cleanDepartment } from './department-clean.js'
import { compareAcademicUnitNames } from './academic-unit-name.js'

const comparable = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()

export function predictAcademicFields(row) {
  const department = cleanDepartment(row.department)
  const discipline = getDiscipline({ ...row, department })
  return {
    department,
    discipline,
    subdiscipline: getSubdiscipline({ ...row, department, discipline }),
  }
}

export function scoreAcademicFields(rows) {
  const fields = ['department', 'discipline', 'subdiscipline']
  const score = {}
  const disagreements = []
  const reviewedRows = new Set()
  for (const field of fields) {
    const goldKey = `gold${field[0].toUpperCase()}${field.slice(1)}`
    const statusKey = `${field}ReviewStatus`
    const eligible = rows.filter((row) => Object.hasOwn(row, goldKey) &&
      (row[statusKey] === 'reviewed' || (!Object.hasOwn(row, statusKey) && row.reviewStatus !== 'unreviewed')))
    let correct = 0
    let normalizedCorrect = 0
    let predictedPresent = 0
    let goldPresent = 0
    let truePositive = 0
    let falsePositive = 0
    let falseNegative = 0
    let wrongValue = 0
    const labels = new Map()
    for (const row of eligible) {
      reviewedRows.add(row)
      const predicted = predictAcademicFields(row)[field]
      const gold = row[goldKey]
      const p = comparable(predicted)
      const g = comparable(gold)
      if (p === g) correct++
      else disagreements.push({ id: row.id || null, title: row.title, field, gold, predicted })
      if (field === 'department' && compareAcademicUnitNames(predicted, gold) !== 'different') normalizedCorrect++
      if (p && !g) falsePositive++
      else if (!p && g) falseNegative++
      else if (p && g && p !== g) wrongValue++
      if (p) predictedPresent++
      if (g) goldPresent++
      if (p && p === g) truePositive++
      for (const label of [p, g]) if (label) labels.set(label, { label, support: 0, predicted: 0, correct: 0 })
    }
    for (const row of eligible) {
      const p = comparable(predictAcademicFields(row)[field])
      const g = comparable(row[goldKey])
      if (p) labels.get(p).predicted++
      if (g) labels.get(g).support++
      if (p && p === g) labels.get(g).correct++
    }
    score[field] = {
      reviewed: eligible.length,
      exactAccuracy: eligible.length ? correct / eligible.length : null,
      ...(field === 'department' ? { normalizedAccuracy: eligible.length ? normalizedCorrect / eligible.length : null, normalizationResolved: normalizedCorrect - correct } : {}),
      precision: predictedPresent ? truePositive / predictedPresent : null,
      recall: goldPresent ? truePositive / goldPresent : null,
      errors: { falsePositive, falseNegative, wrongValue },
      perLabel: [...labels.values()].sort((a, b) => b.support - a.support || a.label.localeCompare(b.label)).map((item) => ({
        label: item.label,
        support: item.support,
        precision: item.predicted ? item.correct / item.predicted : null,
        recall: item.support ? item.correct / item.support : null,
      })),
    }
  }
  return { reviewed: reviewedRows.size, fields: score, disagreements }
}
