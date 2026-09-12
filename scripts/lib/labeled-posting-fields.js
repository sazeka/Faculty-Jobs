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

// Virginia's 23 community colleges share one statewide PeopleAdmin instance
// (jobs.vccs.edu). Every posting there names the ACTUAL college in an
// unlabeled-by-colon "Agency <college name> Agency/Division <code> ..." (or,
// on some templates, "Agency <college name> Division <college name> (Div)
// ...") field -- this is ground truth for which of the 23 colleges a given
// posting really belongs to, independent of whichever VA_CAMPUSES config
// entry's query happened to surface it.
const VCCS_COLLEGES = [
  'Blue Ridge Community College',
  'Brightpoint Community College',
  'Central Virginia Community College',
  'Danville Community College',
  'Eastern Shore Community College',
  'Germanna Community College',
  'J Sargeant Reynolds Community College',
  'Laurel Ridge Community College',
  'Mountain Empire Community College',
  'Mountain Gateway Community College',
  'New River Community College',
  'Northern Virginia Community College',
  'Patrick & Henry Community College',
  'Paul D Camp Community College',
  'Piedmont Virginia Community College',
  'Rappahannock Community College',
  'Southside Virginia Community College',
  'Southwest Virginia Community College',
  'Tidewater Community College',
  'Virginia Highlands Community College',
  'Virginia Peninsula Community College',
  'Virginia Western Community College',
  'Wytheville Community College',
]

// A handful of these colleges were renamed within the last few years
// (Laurel Ridge f/k/a Lord Fairfax, Mountain Gateway f/k/a Dabney S.
// Lancaster, Brightpoint f/k/a John Tyler, Patrick & Henry f/k/a Patrick
// Henry, Virginia Peninsula f/k/a Thomas Nelson) -- the statewide HR system's
// Agency field can still carry the older name on record for a posting.
const VCCS_AGENCY_RENAMES = new Map([
  ['lord fairfax community college', 'Laurel Ridge Community College'],
  ['dabney s lancaster community college', 'Mountain Gateway Community College'],
  ['dabney lancaster community college', 'Mountain Gateway Community College'],
  ['john tyler community college', 'Brightpoint Community College'],
  ['patrick henry community college', 'Patrick & Henry Community College'],
  ['thomas nelson community college', 'Virginia Peninsula Community College'],
])

function normalizeVccsAgencyName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\bva\b/g, 'virginia')
    .replace(/\s+/g, ' ')
    .trim()
}

const VCCS_COLLEGES_BY_NORM = new Map(VCCS_COLLEGES.map((name) => [normalizeVccsAgencyName(name), name]))

export function extractVccsCollegeFromText(value) {
  const text = clean(value)
  const match = /\bAgency\s+(.{2,90}?)\s+(?:Agency\/Division|Division)\b/i.exec(text)
  if (!match) return null
  const raw = clean(match[1])
  if (!raw) return null
  const norm = normalizeVccsAgencyName(raw)
  return VCCS_COLLEGES_BY_NORM.get(norm) || VCCS_AGENCY_RENAMES.get(norm) || null
}
