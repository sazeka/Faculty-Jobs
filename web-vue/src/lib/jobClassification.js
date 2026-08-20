export function getPositionType(title) {
  const t = String(title || '').toLowerCase()
  if (t.includes('assistant professor')) return 'Assistant Professor'
  if (t.includes('associate professor')) return 'Associate Professor'
  if (t.includes('full professor') || (/(^|\W)professor(\W|$)/.test(t) && !t.includes('assistant') && !t.includes('associate'))) return 'Full Professor'
  if (t.includes('lecturer')) return 'Lecturer'
  if (t.includes('instructor')) return 'Instructor'
  if (t.includes('visiting')) return 'Visiting Faculty'
  if (t.includes('adjunct')) return 'Adjunct'
  if (/\bpost[\s-]?doc(?:toral)?\b/.test(t)) return 'Postdoctoral'
  if (t.includes('research')) return 'Research Faculty'
  if (t.includes('clinical')) return 'Clinical Faculty'
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

export function normalizeTenureTrack(value, title = '') {
  if (value === true || value === false) return value
  const status = String(value || '').toLowerCase().trim()
  if (/\bnon[\s-]?tenure|\bntt\b/.test(status)) return false
  if (/tenure[\s-]?track|tenure[\s-]?stream|tenure[\s-]?eligible|\btenured\b/.test(status)) return true

  // Enrichment can legitimately remain "unknown" even when the raw title
  // explicitly states the track. Use only explicit title language; professor
  // rank alone is not enough to infer tenure status.
  const rawTitle = String(title || '').toLowerCase()
  if (/\bnon[\s-]?tenure|\bntt\b/.test(rawTitle)) return false
  if (/tenure[\s-]?track|tenure[\s-]?stream|tenure[\s-]?eligible|\btenured\b/.test(rawTitle)) return true
  return null
}
