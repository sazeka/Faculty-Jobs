// Conservative name comparison for benchmark reporting. Keep the original
// source spelling for display and storage; this only identifies harmless
// formatting and organizational-word variants.
const TYPES = '(department|division|school|college|program|institute|center|centre)'

function words(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\bdept\.?\b/g, 'department')
    .replace(/\bctr\.?\b/g, 'center')
    .replace(/\bcentre\b/g, 'center')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function academicUnitNameParts(value) {
  const name = words(value)
  if (!name) return { type: null, core: '' }
  let type = null
  let core = name
  const leading = new RegExp(`^${TYPES} (?:of |for )?`)
  const trailing = new RegExp(` ${TYPES}$`)
  const first = leading.exec(core)
  const last = trailing.exec(core)
  if (first) {
    type = first[1] === 'centre' ? 'center' : first[1]
    core = core.slice(first[0].length)
  } else if (last) {
    type = last[1] === 'centre' ? 'center' : last[1]
    core = core.slice(0, last.index)
  }
  return { type, core: core.replace(/\s+/g, ' ').trim() }
}

export function compareAcademicUnitNames(actual, expected) {
  const literalA = String(actual || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const literalB = String(expected || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (literalA === literalB) return 'exact'
  const a = words(actual)
  const b = words(expected)
  if (!a || !b) return 'different'
  if (a === b) return 'normalized'
  const left = academicUnitNameParts(actual)
  const right = academicUnitNameParts(expected)
  if (left.core && left.core === right.core && (!left.type || !right.type || left.type === right.type)) return 'normalized'
  return 'different'
}
