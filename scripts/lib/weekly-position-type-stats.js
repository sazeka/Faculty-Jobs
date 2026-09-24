import { getPositionFilterTypes } from '../../web-vue/src/lib/jobClassification.js'

export const POSITION_TYPE_GROUPS = [
  { key: 'roles', label: 'Role', values: ['Professor', 'Lecturer', 'Instructor', 'Postdoctoral', 'Faculty, role unspecified', 'Other / unclear'] },
  { key: 'ranks', label: 'Professor rank', values: ['Assistant Professor', 'Associate Professor', 'Full Professor', 'Rank unspecified'] },
  { key: 'appointmentStatus', label: 'Appointment status', values: ['Adjunct', 'Visiting Faculty'] },
  { key: 'facultyFocus', label: 'Faculty focus', values: ['Clinical Faculty', 'Research Faculty', 'Teaching Faculty'] },
]

function hasFacultyRole(title) {
  const t = String(title || '').toLowerCase()
  if (/\bfaculty development chairs?\b/.test(t)) return true
  if (/\b(?:dean|director|manager|coordinator)\s+(?:of\s+)?faculty\b/.test(t)) return false
  const withoutNonRoleUses = t.replace(
    /\bfaculty\s+(?:affairs|development|learning|leave|support|services|success|relations|resources|governance|engagement|training|evaluation|senate)\b/g,
    ''
  )
  return /\bfaculty\b/.test(withoutNonRoleUses)
}

export function getPositionDisplayRoles(job, typeLabels = getPositionFilterTypes(job.titleClean || job.title || '', job.rank)) {
  const types = new Set(typeLabels)
  const namedRoles = POSITION_TYPE_GROUPS[0].values.slice(0, -2).filter((role) => types.has(role))
  if (namedRoles.length) return namedRoles
  return [hasFacultyRole(job.titleClean || job.title) ? 'Faculty, role unspecified' : 'Other / unclear']
}

export function computePositionTypeFacets(jobs) {
  const groups = Object.fromEntries(POSITION_TYPE_GROUPS.map(({ key, values }) => [key, Object.fromEntries(values.map((value) => [value, 0]))]))
  for (const job of jobs) {
    const types = new Set(getPositionFilterTypes(job.titleClean || job.title || '', job.rank))
    for (const role of getPositionDisplayRoles(job, types)) groups.roles[role]++

    if (types.has('Professor')) {
      let hasRank = false
      for (const rank of POSITION_TYPE_GROUPS[1].values.slice(0, -1)) {
        if (types.has(rank)) { groups.ranks[rank]++; hasRank = true }
      }
      if (!hasRank) groups.ranks['Rank unspecified']++
    }

    for (const group of POSITION_TYPE_GROUPS.slice(2)) {
      for (const label of group.values) {
        if (types.has(label)) groups[group.key][label]++
      }
    }
  }
  return { total: jobs.length, groups }
}
