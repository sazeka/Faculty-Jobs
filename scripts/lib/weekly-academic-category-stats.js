import { cleanDepartment } from './department-clean.js'
import { normalizeDiscipline } from './weekly-discipline-stats.js'

function countBy(jobs, field, normalize) {
  const counts = new Map()
  for (const job of jobs) {
    const name = normalize(job?.[field])
    if (name) counts.set(name, (counts.get(name) || 0) + 1)
  }
  return Object.fromEntries([...counts].sort((a, b) => a[0].localeCompare(b[0])))
}

export function computeAcademicCategorySnapshot(jobs = [], weekEnd) {
  return {
    weekEnd,
    totalJobs: jobs.length,
    disciplines: countBy(jobs, 'discipline', normalizeDiscipline),
    departments: countBy(jobs, 'department', cleanDepartment),
  }
}

export function updateAcademicCategoryHistory(history = [], snapshot, limit = 12) {
  if (!snapshot?.weekEnd || !Number.isFinite(snapshot.totalJobs)) throw new Error('Invalid academic category snapshot')
  return [...history.filter((week) => week.weekEnd !== snapshot.weekEnd), snapshot]
    .sort((a, b) => a.weekEnd.localeCompare(b.weekEnd))
    .slice(-Math.max(1, limit))
}
