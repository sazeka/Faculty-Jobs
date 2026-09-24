const CLINICAL_APPOINTMENT_PATTERNS = [
  /\bclinical\b(?:\s*[/,-]?\s*(?:track|assistant|associate|full|visiting|adjunct|teaching|or|and))*[\s/,-]+(?:professor|faculty|instructor|lecturer)s?\b/,
  /\b(?:professor|faculty|instructor|lecturer)s?\s*[,(/-]\s*clinical\b(?=\s*(?:$|[,;)/-]|\bor\b|\btrack\b))/,
  /\bprofessor\s+(?:of\s+)?clinical\s+practice\b/,
  /\bprofessor\s+of\s+clinical\s*[-–]\s*/,
  /\bclinical\s+nursing\s+faculty\b/,
  /\bclinical\)\s+faculty\b/,
]

const RESEARCH_APPOINTMENT_PATTERNS = [
  /\bresearch\s+(?:(?:track|assistant|assist|asst\.?|associate|assoc\.?|full|visiting|adjunct|or|and)[\s/,.-]+)*(?:professor|faculty)\b/,
  /\b(?:professor|faculty)\s*[,(/-]\s*research\b(?=\s*(?:$|[,;)/-]|\bor\b|\btrack\b))/,
  /\bprofessor\s+research\b/,
  /\bacademic\s*[/,-]\s*research\s+faculty\b/,
]

const TEACHING_APPOINTMENT_PATTERNS = [
  /\bteaching\s+(?:professor|faculty)\b/,
  /\binstructional\s+(?:(?:assistant|associate|full)\s+)?(?:professor|faculty)\b/,
  /\bprofessor\s+of\s+(?:(?:the|professional)\s+)?practice\b/,
  /\bprofessor\s+of\s+instruction\b/,
]

function hasClinicalAppointment(title) {
  return CLINICAL_APPOINTMENT_PATTERNS.some((pattern) => pattern.test(title))
}

function hasResearchAppointment(title) {
  return !/\bpost[\s-]?(?:doc(?:toral)?|doctorate)\b/.test(title) &&
    RESEARCH_APPOINTMENT_PATTERNS.some((pattern) => pattern.test(title))
}

function hasTeachingAppointment(title) {
  return TEACHING_APPOINTMENT_PATTERNS.some((pattern) => pattern.test(title))
}

function professorRanks(title) {
  title = title.replace(/_/g, ' ')
  const ranks = new Set()
  if (/\b(?:assistant|assist|asst)\s*[-–]?\s*to\s*[-–]?\s*full\s+professor\b/.test(title)) ranks.add('Associate Professor')
  for (const professor of title.matchAll(/\bprofessors?\b/g)) {
    const before = title.slice(0, professor.index)
    for (const match of before.matchAll(/\b(assistant|assist|asst|associate|assoc|full)\b/g)) {
      const between = before.slice(match.index + match[0].length)
      if (between.length > 65) continue
      const words = between.toLowerCase().split(/[\s/,.|–-]+/).filter(Boolean)
      const rankWords = /^(?:assistant|assist|asst|associate|assoc|full|clinical|research|teaching|instructional|visiting|inst|lect|or|and|to)$/
      const subjectWords = words.filter((word) => !rankWords.test(word))
      if (subjectWords.length > 2 || subjectWords.some((word) => /^(?:dean|director|chair|vice|chief|head|time)$/.test(word))) continue
      if (/^(?:assistant|assist|asst)$/.test(match[1])) ranks.add('Assistant Professor')
      if (/^(?:associate|assoc)$/.test(match[1])) ranks.add('Associate Professor')
      if (match[1] === 'full') ranks.add('Full Professor')
    }
  }
  return ['Assistant Professor', 'Associate Professor', 'Full Professor'].filter((rank) => ranks.has(rank))
}

export function getPositionType(title) {
  const t = String(title || '').toLowerCase()
  const clinicalAppointment = hasClinicalAppointment(t)
  const researchAppointment = hasResearchAppointment(t)
  const ranks = professorRanks(t)
  if (ranks.length > 1 && hasTeachingAppointment(t)) return 'Teaching Faculty'
  if (ranks.includes('Assistant Professor')) return 'Assistant Professor'
  if (ranks.includes('Associate Professor')) return 'Associate Professor'
  // "Professor" combined with an explicit appointment modifier (Adjunct,
  // Visiting, Research, Clinical, Teaching, Professor of Practice) should
  // resolve to that modifier, not the generic Professor fallback below
  // — e.g. "Adjunct Professor of X" was incorrectly resolving to Full
  // Professor (issue #117). Skip the fallback here and let the modifier
  // checks further down (unchanged, same order as before this fix) pick it
  // up, so non-professor titles ("Adjunct Instructor", "Visiting Lecturer",
  // "Postdoctoral Research Fellow", ...) keep their existing precedence.
  const hasProfessorModifier =
    t.includes('adjunct') || t.includes('visiting') || researchAppointment || clinicalAppointment ||
    hasTeachingAppointment(t)
  if (!hasProfessorModifier && ranks.includes('Full Professor')) return 'Full Professor'
  if (!hasProfessorModifier && /\bprofessor\b/.test(t)) return 'Professor'
  if (t.includes('lecturer')) return 'Lecturer'
  if (t.includes('instructor')) return 'Instructor'
  if (t.includes('visiting')) return 'Visiting Faculty'
  if (t.includes('adjunct')) return 'Adjunct'
  if (/\bpost[\s-]?(?:doc(?:toral)?|doctorate)\b/.test(t)) return 'Postdoctoral'
  if (researchAppointment) return 'Research Faculty'
  if (clinicalAppointment) return 'Clinical Faculty'
  if (hasTeachingAppointment(t)) return 'Teaching Faculty'
  return 'Faculty'
}

// Return every professor rank represented by a combined/open-rank posting.
export function getPositionTypes(title) {
  const t = String(title || '').toLowerCase()
  const isAdjunct = t.includes('adjunct')
  if (/\bprofessors?\b/.test(t)) {
    const explicitRanks = professorRanks(t)
    if (/\b(all ranks|all levels|various ranks)\b/.test(t) || (!explicitRanks.length && /\b(open rank|any rank)\b/.test(t))) {
      const ranks = ['Assistant Professor', 'Associate Professor', 'Full Professor']
      if (isAdjunct) ranks.push('Adjunct')
      return ranks
    }
    const ranks = explicitRanks
    if (ranks.length) {
      if (isAdjunct) ranks.push('Adjunct')
      return ranks
    }
  }
  const primary = getPositionType(t)
  if (isAdjunct && primary !== 'Adjunct') return [primary, 'Adjunct']
  return [primary]
}

// Search facets include both the specific rank and the broader appointment
// family. A Clinical Assistant Professor should match Professor, Assistant
// Professor, and Clinical Faculty searches without losing any of those facts.
export function getPositionFilterTypes(title, rank = null) {
  const t = String(title || '').toLowerCase()
  const types = rank ? [rank] : getPositionTypes(title)
  const add = (value) => { if (!types.includes(value)) types.push(value) }

  if (types.length === 1 && types[0] === 'Faculty' && (
    /\bresearch fellow\b/.test(t) && !/\bfaculty\b/.test(t) ||
    /\b(?:dean|director|manager|coordinator)\s+(?:of\s+)?faculty\b/.test(t) ||
    /\bfaculty\s+(?:affairs|development|learning|leave|support|services|success|relations|resources|governance|engagement|training|evaluation|senate)\b/.test(t) &&
      !/\bfaculty development chairs?\b/.test(t)
  )) return []

  if (/\bprofessors?\b/.test(t) || types.some((type) => /professor/i.test(type))) add('Professor')
  if (hasClinicalAppointment(t)) add('Clinical Faculty')
  if (hasResearchAppointment(t)) add('Research Faculty')
  if (/\b(?:lecturers?|lect\.?|instructors?|inst\.?)\b/.test(t)) {
    if (/\b(?:lecturers?|lect\.?)\b/.test(t)) add('Lecturer')
    if (/\b(?:instructors?|inst\.?)\b/.test(t)) add('Instructor')
  }
  if (/\badjunct\b/.test(t)) add('Adjunct')
  if (/\bvisiting\b/.test(t) && /\b(?:professors?|faculty|lecturers?|lect\.?|instructors?|inst\.?)\b/.test(t)) add('Visiting Faculty')
  if (hasTeachingAppointment(t)) add('Teaching Faculty')
  return types
}

export function normalizeTenureTrack(value, title = '', college = '') {
  // Explicit title language is the most visible source evidence and wins over
  // stale or contradictory enrichment. Professor rank alone is never enough.
  const rawTitle = String(title || '').toLowerCase()
  // "Without tenure" is unambiguous regardless of institution -- there is no
  // reading of that phrase in a faculty title that means tenure-track.
  if (/\bnon[\s-]?tenure|\bntt\b|\bwithout\s+tenure\b/.test(rawTitle)) return false
  // Bare "WOT" (no parens) is University of Washington's own title convention
  // for "without tenure" appointments (ap.washington.edu documents WOT as a
  // distinct, explicitly non-tenure track) -- issue #145 found 11 UW records
  // titled e.g. "Assistant Professor WOT" stuck at tenureTrack: true because
  // only the parenthesized "(WOT)" form was recognized anywhere in the
  // pipeline. Scoped to UW so an unrelated "WOT" acronym elsewhere is never
  // misread as tenure evidence.
  const isUw = /\buniversity of washington\b/i.test(String(college || ''))
  if (isUw && /\bwot\b/.test(rawTitle)) return false
  if (/tenure[\s-]?track|tenure[\s-]?stream|tenure[\s-]?eligible|\btenured\b/.test(rawTitle)) return true

  if (value === true || value === false) return value
  const status = String(value || '').toLowerCase().trim()
  if (/\bnon[\s-]?tenure|\bntt\b|\bwithout\s+tenure\b/.test(status)) return false
  if (isUw && /\bwot\b/.test(status)) return false
  if (/tenure[\s-]?track|tenure[\s-]?stream|tenure[\s-]?eligible|\btenured\b/.test(status)) return true
  return null
}
