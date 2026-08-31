const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const DATE = `(${MONTH}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+${MONTH},?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})`
const OPEN_LABEL = '(?:open(?:ing)?\\s*date|posting\\s*date|posting\\s*begin(?:[\\s/]*end)?\\s*date|date\\s*posted|posted\\s*date|posted\\s*on|date\\s*opened|initial\\s*posting\\s*date|first\\s*posted|advertised|posted)'
const CLOSE_LABEL = '(?:clos(?:e|ing)\\s*date|applications?\\s*clos(?:e|ing)|application\\s*deadline|deadline(?:\\s*(?:to\\s*apply|for\\s*application?s?))?|apply\\s*by|posting\\s*end\\s*date)'

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function normalizePostingDate(value) {
  const raw = clean(value)
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  const year = parsed.getUTCFullYear()
  if (year < 2000 || year > 2100) return null
  return parsed.toISOString().slice(0, 10)
}

export function extractPostingDatesFromText(value, { today = new Date() } = {}) {
  const text = clean(value)
  const todayIso = today.toISOString().slice(0, 10)
  const openMatch = new RegExp(`\\b${OPEN_LABEL}\\s*[:\\-]?\\s*${DATE}`, 'i').exec(text)
  const closeMatch = new RegExp(`\\b${CLOSE_LABEL}\\s*[:\\-]?\\s*${DATE}`, 'i').exec(text)
  const rolling = new RegExp(`${CLOSE_LABEL}\\s*[:\\-]?\\s*(?:open\\s+)?(?:until\\s+filled|continuous(?:ly)?|ongoing)`, 'i').test(text)
  const datePosted = normalizePostingDate(openMatch?.[1])
  return {
    datePosted: datePosted && datePosted <= todayIso ? datePosted : null,
    closeDate: normalizePostingDate(closeMatch?.[1]),
    openUntilFilled: rolling,
  }
}
