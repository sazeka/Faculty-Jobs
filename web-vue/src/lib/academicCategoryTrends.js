const CATEGORY_KEYS = { discipline: 'disciplines', department: 'departments' }

export function categoryOptions(weeks, kind) {
  const key = CATEGORY_KEYS[kind]
  const current = Array.isArray(weeks) ? weeks.at(-1) : null
  if (!key || !current?.[key]) return []
  return Object.entries(current[key])
    .filter(([name, count]) => name && Number.isFinite(count) && count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export function matchingCategoryOptions(options, query, limit = 8) {
  const search = String(query || '').trim().toLocaleLowerCase()
  if (!search) return options.slice(0, limit)
  return options.filter((option) => option.name.toLocaleLowerCase().includes(search)).slice(0, limit)
}

export function categorySeries(weeks, kind, name) {
  const key = CATEGORY_KEYS[kind]
  if (!key || !name || !Array.isArray(weeks)) return []
  return weeks
    .filter((week) => week?.[key] && Number.isFinite(week.totalJobs) && week.totalJobs > 0)
    .map((week) => {
      const count = Number(week[key][name] || 0)
      return {
        weekEnd: week.weekEnd,
        count,
        sharePct: Number(((count / week.totalJobs) * 100).toFixed(4)),
      }
    })
}
