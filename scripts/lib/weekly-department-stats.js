import { cleanDepartment } from './department-clean.js'

// Coverage uses the same display validation as the job cards and filters.
// It measures usable Department fields, not independently verified labels.
export function computeDepartmentBreakdown(jobs = []) {
  const classified = jobs.filter((job) => Boolean(cleanDepartment(job?.department))).length
  const unknown = jobs.length - classified
  return {
    classified,
    unknown,
    classifiedPct: jobs.length ? Number(((classified / jobs.length) * 100).toFixed(1)) : 0,
  }
}
