function clean(value) {
  return String(value || '')
    .replace(/([a-z0-9,)])(?=(?:Brief Description|Description|Number of Vacancies|Area of Consideration)\b)/gi, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

const NEXT_LABEL = '(?:location|work location|campus location|reports? to|department(?:\'s)? website|position type|job summary|summary of job duties|brief description(?: of duties)?|description|salary(?: range)?|flsa(?: status)?|classification title|pay grade|number of vacancies|area of consideration|about)'

function labeledValue(text, label, maxLength) {
  const source = clean(text)
  const match = new RegExp(`\\b${label}\\s*:\\s*(.{2,${maxLength}}?)(?=\\s+${NEXT_LABEL}\\s*:?\\s|$)`, 'i').exec(source)
  return clean(match?.[1])
}

export function extractDepartmentFromText(value) {
  const department = labeledValue(value, 'department', 160)
  if (!department || department.length > 100 || /https?:\/\/|\b(?:n\/?a|not applicable)\b/i.test(department)) return null
  if (/\d/.test(department) && !/[a-z]{3,}/i.test(department.replace(/\d/g, ''))) return null
  if (department.split(' ').length > 14) return null
  return department
}

export function extractLocationFromText(value) {
  const location = labeledValue(value, '(?:job )?location', 180)
  if (!location || location.length > 130 || /https?:\/\//i.test(location)) return null
  return location
}
