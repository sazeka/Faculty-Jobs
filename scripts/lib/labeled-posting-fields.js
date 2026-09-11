function clean(value) {
  return String(value || '')
    .replace(/([a-z0-9,)])(?=(?:Brief Description|Description|Number of Vacancies|Area of Consideration)\b)/gi, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

const NEXT_LABEL = '(?:location|work location|campus location|reports?(?:\\s+directly)? to|department(?:\'s)? website|position type|job summary|summary of job duties|position summary|brief description(?: of duties)?|description|salary(?: range)?|flsa(?: status)?|classification title|supervisor title|pay (?:grade|classification|band)|number of vacancies|area of consideration|evaluation group|job code|college\\s*\\/\\s*division|work schedule|total weeks per (?:year|semester)|time type|position open to|weekly scheduled hours|start date|revision date|employment type|compensation|about|duties\\s*(?:&|and)\\s*responsibilities|job duties|opening date|closing date|required education|sub[\\s-]?department|type of appointment|catalog number)'

function labeledValue(text, label, maxLength) {
  const source = clean(text)
  // Lower bound 0, not 2, and \s* (not \s+) in the lookahead: a template can
  // leave the field blank ("Department: Evaluation group: ..."), immediately
  // followed by the next label with no separating space left for \s+ to
  // consume (the \s* right after the colon already ate it). A minimum of 2
  // plus a mandatory \s+ boundary forced the match to consume into that next
  // label's own text before the lookahead could ever fire, sinking the field.
  const match = new RegExp(`\\b${label}\\s*:\\s*(.{0,${maxLength}}?)(?=\\s*${NEXT_LABEL}\\s*:?\\s|$)`, 'i').exec(source)
  return clean(match?.[1])
}

export function extractDepartmentFromText(value) {
  const department = labeledValue(value, 'department', 160)
  if (!department || department.length > 100 || /https?:\/\/|@|\b(?:n\/?a|not applicable)\b/i.test(department)) return null
  if (/\d/.test(department) && !/[a-z]{3,}/i.test(department.replace(/\d/g, ''))) return null
  if (department.split(' ').length > 14) return null
  return department
}

export function extractLocationFromText(value) {
  const location = labeledValue(value, '(?:job )?location', 180)
  if (!location || location.length > 130 || /https?:\/\//i.test(location)) return null
  return location
}
