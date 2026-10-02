import { cleanDepartment, cleanJobDepartment } from './department-clean.js'
import { inferDepartmentFromTitle } from './department-inference.js'

const ADMIN_UNIT = /^(?:academic affairs|human resources|student affairs|district office|instruction|learning|provost|office of|university of|department of (?:labor|education office of civil rights)|(?:interim|contact|health) department)\b/i
const ROLE_TAIL = /\s+(?:non[- ]tenure|tenure[- ]track|faculty|professor|instructor|lecturer|applicant pool|opening|position|posting|job description)\b.*$/i
const SENTENCE_TAIL = /\s+(?:at|in|within|seeks|invites|is|has|will|to|from|located|recruits?|offers?|for the)\b.*$/i
const STOP_WORD = /^(?:at|in|within|seeks|invites|is|has|will|to|from|located|recruits?|offers?|faculty|professor|instructor|lecturer|posting|position|job|university|applicants|director|chair|dean|instruction|track|division|department|college\/division|the)$/i
const FIELD_END = '(?:Opening Date|Open Date|Closing Date|Initial Screening Date|Job Open Date|Proposed Minimum Salary|Salary(?: Range| Details)?|Job (?:Location|Type|Description|Summary|Title)|Work Location|Location|Campus|Description|Posting (?:Number|Details)|FLSA|Bargaining Unit|Mission & Vision Statement|Work Status|Position (?:Category|Title|Description)|About The Position|Category|Job Summary|Division|Department(?:/Unit|\x27s Website)?|College(?:/Division)?|Faculty Rank|Work Type|Work Schedule|Work Arrangement|Employment Type|Benefits|Position Purpose|Quicklink|Schedule|Executive Area)'
const result = (department, evidence, source, confidence) => ({ department, evidence, source, confidence })

function structuredCandidates(description) {
  const candidates = []
  const source = String(description || '').replace(/\s+/g, ' ')
  const pattern = new RegExp(`(?<![A-Za-z])Department\\s*:\\s*(.{3,85}?)(?=\\s*${FIELD_END}\\b)`, 'gi')
  const unlabeled = new RegExp(`\\bDepartment(?:/Unit)?\\s+((?!of\\b)[A-Z][^.;:]{2,85}?)(?=\\s+${FIELD_END}\\b)`, 'g')
  for (const regex of [pattern, unlabeled]) {
    for (const match of source.matchAll(regex)) {
      const name = normalizeUnit(match[1])
      if (!name || /^(?:contact|name|summary|area|head|chair|of)\b/i.test(name) || /\d{3,}/.test(name)) continue
      candidates.push({ name, evidence: match[0], index: match.index, kind: 'structured' })
    }
  }
  return candidates
}

function normalizeUnit(value) {
  let unit = String(value || '').replace(/\s+/g, ' ').trim()
  unit = unit.split(/\s+[–—]\s+/)[0]
  unit = unit.replace(SENTENCE_TAIL, '').replace(ROLE_TAIL, '')
  unit = unit.replace(/\s+\([^)]*(?:pool|posting|tenure|rank)[^)]*\).*$/i, '')
  unit = unit.replace(/[.,;:]+$/, '').trim()
  unit = unit.replace(/\s+(?:University|College) of [A-Z][\w -]+$/i, '').trim()
  if (!cleanDepartment(unit) || ADMIN_UNIT.test(unit) || /^(?:department|division|school|college|institute|center)(?:\s+(?:of|for))?$/i.test(unit)) return null
  if (/\bDepartment of Education\b|^(?:US|U S|Work The|Degree|Plus|Adjunct|Chair of)\b/i.test(unit)) return null
  if (/^Department\s+(?:School|College|Division)\b/i.test(unit)) return null
  if (/https?:|\b(?:website|contact|phone|email|salary|location|benefits|applicants|laborknow)\b/i.test(unit)) return null
  return unit
}

function capitalizedName(source, start) {
  const words = []
  for (const raw of source.slice(start).split(/\s+/).slice(0, 14)) {
    if (/^[.;:|]/.test(raw)) break
    const stopAfter = /[.;:|]$/.test(raw)
    if (raw.startsWith('(') && words.length) break
    const word = raw.split(/[.;:|]/)[0].replace(/^[,(]+|[),.;:|]+$/g, '')
    if (!word) continue
    if (STOP_WORD.test(word) || (words.length && /^(?:Department|Division|School|College|Program|Institute|Center)$/.test(word))) break
    if (/^(?:and|of|the|for|&|\+)$/i.test(word)) {
      if (!words.length) break
      words.push(word)
      continue
    }
    if (!/^[A-Z][A-Za-z0-9&+'/-]*$/.test(word)) break
    words.push(word + (raw.endsWith(',') ? ',' : ''))
    if (stopAfter || raw.includes('.')) break
  }
  while (words.length && /^(?:and|of|the|for|&|\+)$/i.test(words.at(-1))) words.pop()
  return words.join(' ')
}

function namedCandidates(text) {
  const candidates = []
  const source = String(text || '').replace(/\s+/g, ' ')
  const structured = /\bDepartment\s*:?[ \t]+([A-Z][A-Za-z&+'/-]*(?:\s+(?:[A-Z][A-Za-z&+'/-]*|and|of)){0,8}?)(?=\s+(?:Opening Date|Open Date|Division|Salary|Job|Work Location|Location|Description|Posting|FLSA|Campus|Worker|Career|Agency)\b)/g
  for (const match of source.matchAll(structured)) {
    const name = normalizeUnit(match[1])
    if (name) candidates.push({ name, evidence: match[0], index: match.index, kind: 'structured' })
  }
  const prefix = /\b(?:Department|Division|School|College|Institute|Center)\s+(?:of|for)\s+/g
  for (const match of source.matchAll(prefix)) {
    const name = normalizeUnit(match[0] + capitalizedName(source, match.index + match[0].length))
    if (!name) continue
    candidates.push({ name, evidence: name, index: match.index, kind: 'prefix' })
  }
  const lowerNamed = /\bdepartment of ([a-z]+(?:\s+[a-z]+){0,5})(?=\s+(?:is|seeks|invites|offers))\b/g
  for (const match of source.matchAll(lowerNamed)) {
    const name = normalizeUnit(match[0])
    if (name) candidates.push({ name, evidence: match[0], index: match.index, kind: 'prefix' })
  }
  const suffix = /\b(?:[A-Z][A-Za-z&+/-]*\s+){1,8}(?:Department|Program|Division|Institute)\b/g
  for (const match of source.matchAll(suffix)) {
    if (source[match.index + match[0].length] === ':') continue
    const name = normalizeUnit(match[0].replace(/^(?:(?:The|Job|Summary|Posting|Position|Title|Area|Agency|Organizational|Direct|Report|Unit)\s+)+/g, ''))
    if (!name) continue
    if (/\b(?:Agency|Organizational|Direct Report|Community College|Area Division)\b/i.test(name) || /^(?:Division|Department|Work|Description|Instruction|Academic Affairs|The|This|Position|The Public)\b/i.test(name)) continue
    candidates.push({ name, evidence: match[0], index: match.index, kind: 'suffix' })
  }
  const namedSchool = /\b[A-Z][A-Za-z'-]+ School of [A-Z][A-Za-z&+'/-]+(?:\s+(?:[A-Z][A-Za-z&+'/-]+|and|of)){0,5}/g
  for (const match of source.matchAll(namedSchool)) {
    const name = normalizeUnit(match[0])
    if (name) candidates.push({ name, evidence: match[0], index: match.index, kind: 'prefix' })
  }
  return candidates
}

function unitPriority(name) {
  if (/\b(?:Department|Division)\b/i.test(name)) return 5
  if (/\bProgram\b/i.test(name)) return 4
  if (/\bSchool\b/i.test(name)) return 3
  if (/\b(?:College|Institute)\b/i.test(name)) return 2
  if (/\bCenter\b/i.test(name)) return 1
  return 0
}

export function extractAcademicUnit(job = {}) {
  const title = String(job.title || '')
  const description = String(job.description || '')
  const raw = cleanJobDepartment(job)
  const titleSuffix = !/\bDepartment of\b/i.test(title) && title.match(/\b([A-Z][A-Za-z&]+(?:\s+(?:[A-Z][A-Za-z&]+|and|of)){1,7}\s+Department)\b/)
  const titleUnit = titleSuffix?.[1]?.replace(/^.*?\b(?:Chair of|Professor of)\s+/i, '') || inferDepartmentFromTitle(title)
  const structured = structuredCandidates(description)
  const prose = namedCandidates(description).filter((item) => !ADMIN_UNIT.test(item.name))
  const expandedField = structured.find(({ name }) => prose.some((item) => item.name.toLowerCase().includes(name.toLowerCase()) && item.name.length > name.length + 8))
  if (expandedField) {
    const full = prose.find((item) => item.name.toLowerCase().includes(expandedField.name.toLowerCase()) && item.name.length > expandedField.name.length + 8)
    if (full && /^(?:Department|Division) of\b/i.test(full.name)) return result(full.name, full.evidence, 'description-named-unit', 'high')
  }
  const specificProse = prose.find((item) => /\bDepartment\b/i.test(item.name) && (item.index < 500 || /\b(?:is seeking|invites applications|to join the)\b/i.test(description.slice(item.index, item.index + 160))))
  if (titleUnit && specificProse && unitPriority(specificProse.name) > unitPriority(titleUnit)) {
    return result(specificProse.name, specificProse.evidence, 'description-named-unit', 'medium')
  }
  const subjectWords = new Set(`${title} ${raw || ''}`.toLowerCase().match(/[a-z]{5,}/g) || [])
  const supported = structured.find(({ name }) =>
    (name.toLowerCase().match(/[a-z]{5,}/g) || []).some((word) =>
      subjectWords.has(word) && !/^(?:faculty|school|college|department|science|studies|program|division)$/.test(word)))
  // A position's explicit structured field can identify a more specific
  // hiring unit than the college or center named in its title. Keep the
  // title when the field is an untyped code or a broader unit.
  if (titleUnit && supported && unitPriority(supported.name) > unitPriority(titleUnit)) {
    return result(supported.name, supported.evidence, 'description-field', supported.index < 2500 ? 'high' : 'medium')
  }
  if (titleUnit) {
    const multipleUnits = (title.match(/\b(?:Department|Division|School|College|Program|Institute|Center)\s+(?:of|for)\b/gi) || []).length > 1
    return result(titleUnit, title, 'title-named-unit', multipleUnits ? 'medium' : 'high')
  }
  if (supported) return result(supported.name, supported.evidence, 'description-field', supported.index < 2500 ? 'high' : 'medium')

  // A bounded posting field is stronger than a course or program mention.
  // Prefer its full prose spelling when the field is visibly abbreviated.
  const firstField = structured.find(({ name }) => !/^(?:SHP\s*-|IU\s+)/i.test(name) || !prose.some((item) => /Department of/i.test(item.name)))
  if (firstField) {
    const fieldWords = (firstField.name.toLowerCase().match(/[a-z]{5,}/g) || []).filter((word) => !/^(?:department|science|studies)$/.test(word))
    const expanded = prose.find((item) => /^(?:Department|Division) of\b/i.test(item.name) && fieldWords.some((word) => item.name.toLowerCase().includes(word)) && item.name.length > firstField.name.length + 6)
    const chosen = expanded || firstField
    return result(chosen.name, chosen.evidence, expanded ? 'description-named-unit' : 'description-field', chosen.index < 2500 ? 'high' : 'medium')
  }

  const institutionWord = String(job.college || '').toLowerCase().replace(/^the\s+/, '').match(/[a-z]{4,}/)?.[0]
  const focus = title.match(/\b(?:Professor|Lecturer|Instructor|Faculty)\s+(?:of|in)\s+(.+?)(?:\s+in\s+the\b|$)/i)?.[1] || title
  const focusWords = new Set((focus.toLowerCase().match(/[a-z]{4,}/g) || []).filter((word) => !/^(?:assistant|associate|professor|lecturer|instructor|faculty|clinical|teaching|college|school|department|division|track|position)$/.test(word)))
  const candidates = prose
    .map((candidate) => {
      let name = candidate.name
      const college = String(job.college || '').trim()
      const collegeStart = college.replace(/\bUniversity\b.*$/i, '').trim()
      if (collegeStart.length >= 8) {
        const index = name.toLowerCase().indexOf(collegeStart.toLowerCase())
        if (index > 0) name = name.slice(0, index).trim()
      }
      if (institutionWord) {
        const pieces = name.split(/,\s*/)
        const institutionIndex = pieces.findIndex((part, index) => index > 0 && part.toLowerCase().startsWith(institutionWord))
        if (institutionIndex > 0) name = pieces.slice(0, institutionIndex).join(', ')
      }
      return { ...candidate, name }
    })
    .filter(({ name, index }) => {
      if (job.college && String(job.college).toLowerCase().includes(name.toLowerCase())) return false
      const before = description.slice(Math.max(0, index - 70), index)
      if (/\b(?:contact|questions|email|chair of)\b[^.]{0,55}$/i.test(before)) return false
      return true
    })
    .sort((a, b) => {
      const score = (candidate) => {
        const overlap = new Set((candidate.name.toLowerCase().match(/[a-z]{4,}/g) || []).filter((word) => focusWords.has(word))).size
        return unitPriority(candidate.name) + (candidate.kind === 'structured' ? 6 : candidate.kind === 'prefix' ? 2 : 0) + overlap * 3
      }
      const difference = score(b) - score(a)
      if (difference) return difference
      if (a.name.toLowerCase().includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(a.name.toLowerCase())) return b.name.length - a.name.length
      return a.index - b.index
    })
  if (candidates.length) {
    const first = candidates[0]
    const overlap = (first.name.toLowerCase().match(/[a-z]{5,}/g) || []).some((word) =>
      subjectWords.has(word) && !/^(?:faculty|school|college|department|science|studies|program|division)$/.test(word))
    const direct = /^(?:Department|Division|School|College|Program|Institute|Center)\s+(?:of|for)\b/i.test(first.name)
    return result(first.name, first.evidence, 'description-named-unit', direct && overlap && first.index < 2500 ? 'high' : 'medium')
  }

  // Some portals join an ID directly to "Department:" and the next field
  // directly to its value. A bounded explicit field is still useful when no
  // named unit appeared elsewhere, even if its wording differs from the title.
  const explicitField = structured.find(({ evidence, index }) => /Department\s*:/i.test(evidence) && index < 1200)
  if (explicitField) return result(explicitField.name, explicitField.evidence, 'description-field', 'medium')

  if (raw && !ADMIN_UNIT.test(raw) && !/\b(?:professor|lecturer|instructor|faculty)\b/i.test(raw) && job.departmentInferredFrom !== 'title') {
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const labeled = new RegExp(`\\b(?:Department|Division|Unit|Organization|College/Division)\\s*:?\\s*(?:[A-Z0-9-]+\\s+)?${escaped}(?=\\b|\\s|$)`, 'i')
    const match = labeled.exec(description)
    if (match) return result(raw, match[0], 'description-field', 'medium')
    if (!description && /^(?:Department|School|Division|College|Program|Institute|Center)\b/i.test(raw)) {
      return result(raw, null, 'source-field-unverified', 'low')
    }
  }
  return result(null, null, 'unresolved', 'none')
}
