export function getPositionType(title) {
  const t = String(title || '').toLowerCase()
  if (t.includes('assistant professor')) return 'Assistant Professor'
  if (t.includes('associate professor')) return 'Associate Professor'
  // "Professor" combined with an explicit appointment modifier (Adjunct,
  // Visiting, Research, Clinical, Teaching, Professor of Practice) should
  // resolve to that modifier, not the generic Full Professor fallback below
  // — e.g. "Adjunct Professor of X" was incorrectly resolving to Full
  // Professor (issue #117). Skip the fallback here and let the modifier
  // checks further down (unchanged, same order as before this fix) pick it
  // up, so non-professor titles ("Adjunct Instructor", "Visiting Lecturer",
  // "Postdoctoral Research Fellow", ...) keep their existing precedence.
  const hasProfessorModifier =
    t.includes('adjunct') || t.includes('visiting') || t.includes('research') || t.includes('clinical') ||
    t.includes('teaching professor') || t.includes('professor of practice')
  if (!hasProfessorModifier && (t.includes('full professor') || (/(^|\W)professor(\W|$)/.test(t) && !t.includes('assistant') && !t.includes('associate')))) return 'Full Professor'
  if (t.includes('lecturer')) return 'Lecturer'
  if (t.includes('instructor')) return 'Instructor'
  if (t.includes('visiting')) return 'Visiting Faculty'
  if (t.includes('adjunct')) return 'Adjunct'
  if (/\bpost[\s-]?doc(?:toral)?\b/.test(t)) return 'Postdoctoral'
  if (t.includes('research')) return 'Research Faculty'
  if (t.includes('clinical')) return 'Clinical Faculty'
  if (t.includes('teaching professor') || t.includes('professor of practice')) return 'Teaching Faculty'
  return 'Faculty'
}

// Return every professor rank represented by a combined/open-rank posting.
export function getPositionTypes(title) {
  const t = String(title || '').toLowerCase()
  const isAdjunct = t.includes('adjunct')
  if (/professor/.test(t)) {
    if (/\b(all ranks|open rank|any rank|all levels|various ranks)\b/.test(t)) {
      const ranks = ['Assistant Professor', 'Associate Professor', 'Full Professor']
      if (isAdjunct) ranks.push('Adjunct')
      return ranks
    }
    const ranks = []
    if (/\b(?:assistant|asst)\b/.test(t)) ranks.push('Assistant Professor')
    if (/\b(?:associate|assoc)\b/.test(t)) ranks.push('Associate Professor')
    if (/\bfull professor\b/.test(t)) ranks.push('Full Professor')
    if (ranks.length) {
      if (isAdjunct) ranks.push('Adjunct')
      return ranks
    }
  }
  const primary = getPositionType(t)
  if (isAdjunct && primary !== 'Adjunct') return [primary, 'Adjunct']
  return [primary]
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
