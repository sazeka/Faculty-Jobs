import { canonicalDepartment, departmentKey, departmentUnitLevel } from './department-canonical.js'
import { normalizeDiscipline } from './weekly-discipline-stats.js'

function sortedObject(counts) {
  return Object.fromEntries([...counts].sort((a, b) => a[0].localeCompare(b[0])))
}

function countBy(jobs, field, normalize) {
  const counts = new Map()
  for (const job of jobs) {
    const name = normalize(job?.[field])
    if (name) counts.set(name, (counts.get(name) || 0) + 1)
  }
  return sortedObject(counts)
}

// Departments and schools are counted separately, under canonical labels.
// Spelling variants of one label ("Art & Design", "Art and Design") merge and
// are reported under their most common spelling.
function countAcademicUnits(jobs) {
  const groups = { department: new Map(), school: new Map() }
  for (const job of jobs) {
    const label = canonicalDepartment(job?.department, { college: job?.college, location: job?.location })
    if (!label) continue
    const units = groups[departmentUnitLevel(label)]
    const key = departmentKey(label)
    const unit = units.get(key) || { count: 0, labels: new Map() }
    unit.count += 1
    unit.labels.set(label, (unit.labels.get(label) || 0) + 1)
    units.set(key, unit)
  }
  const toCounts = (units) => sortedObject(new Map([...units.values()].map((unit) => [
    [...unit.labels].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    unit.count,
  ])))
  return { departments: toCounts(groups.department), schools: toCounts(groups.school) }
}

export function computeAcademicCategorySnapshot(jobs = [], weekEnd) {
  return {
    weekEnd,
    totalJobs: jobs.length,
    disciplines: countBy(jobs, 'discipline', normalizeDiscipline),
    ...countAcademicUnits(jobs),
  }
}

export function updateAcademicCategoryHistory(history = [], snapshot, limit = 12) {
  if (!snapshot?.weekEnd || !Number.isFinite(snapshot.totalJobs)) throw new Error('Invalid academic category snapshot')
  return [...history.filter((week) => week.weekEnd !== snapshot.weekEnd), snapshot]
    .sort((a, b) => a.weekEnd.localeCompare(b.weekEnd))
    .slice(-Math.max(1, limit))
}
