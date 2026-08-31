import fs from 'node:fs'

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function normalizeReviewedUrl(value) {
  const raw = clean(value)
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    parsed.hostname = parsed.hostname.toLowerCase()
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return raw
  }
}

export function buildReviewedExclusionMap(entries = []) {
  const map = new Map()
  for (const entry of entries) {
    const url = normalizeReviewedUrl(entry?.url)
    if (url) map.set(url, entry)
  }
  return map
}

export function reviewedExclusionReason(job, exclusions) {
  const map = exclusions instanceof Map ? exclusions : buildReviewedExclusionMap(exclusions)
  return map.get(normalizeReviewedUrl(job?.url))?.reason || null
}

export function loadReviewedExclusions(filePath) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return buildReviewedExclusionMap(Array.isArray(payload?.exclusions) ? payload.exclusions : [])
  } catch {
    return new Map()
  }
}
