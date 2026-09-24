import { getPositionFilterTypes } from '../../web-vue/src/lib/jobClassification.js'

export const POSITION_TYPE_GROUPS = [
  { key: 'roles', label: 'Role', values: ['Professor', 'Lecturer', 'Instructor', 'Postdoctoral', 'Other / unspecified'] },
  { key: 'ranks', label: 'Professor rank', values: ['Assistant Professor', 'Associate Professor', 'Full Professor', 'Rank unspecified'] },
  { key: 'appointments', label: 'Appointment type', values: ['Adjunct', 'Clinical Faculty', 'Research Faculty', 'Teaching Faculty', 'Visiting Faculty'] },
]

export function computePositionTypeFacets(jobs) {
  const groups = Object.fromEntries(POSITION_TYPE_GROUPS.map(({ key, values }) => [key, Object.fromEntries(values.map((value) => [value, 0]))]))
  for (const job of jobs) {
    const types = new Set(getPositionFilterTypes(job.titleClean || job.title || '', job.rank))
    let hasRole = false
    for (const role of POSITION_TYPE_GROUPS[0].values.slice(0, -1)) {
      if (types.has(role)) { groups.roles[role]++; hasRole = true }
    }
    if (!hasRole) groups.roles['Other / unspecified']++

    if (types.has('Professor')) {
      let hasRank = false
      for (const rank of POSITION_TYPE_GROUPS[1].values.slice(0, -1)) {
        if (types.has(rank)) { groups.ranks[rank]++; hasRank = true }
      }
      if (!hasRank) groups.ranks['Rank unspecified']++
    }

    for (const appointment of POSITION_TYPE_GROUPS[2].values) {
      if (types.has(appointment)) groups.appointments[appointment]++
    }
  }
  return { total: jobs.length, groups }
}
