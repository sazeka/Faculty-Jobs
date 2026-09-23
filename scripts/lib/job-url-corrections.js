import fs from 'node:fs'
import { normalizeReviewedUrl } from './post-quality-exclusions.js'

// Reviewed per-posting link fixes (data/job-url-corrections.json). Generic
// scrapers sometimes attach the wrong <a> to a real posting (a "Powered by
// Paycor" footer, a sibling page, a form-help page); the scrape re-finds the
// same wrong link every day, so the fix has to be applied on every run.
//
// Matched on URL + college (a vendor URL like paycor.com/recruiting-software
// can be mis-scraped for several schools) and, when given, the title.

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

const key = (url, college) => `${normalizeReviewedUrl(url)}|${clean(college).toLowerCase()}`

export function buildJobUrlCorrectionMap(entries = []) {
  const map = new Map()
  for (const entry of entries) {
    if (entry?.from && entry?.to) map.set(key(entry.from, entry.college), entry)
  }
  return map
}

export function loadJobUrlCorrections(filePath) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return buildJobUrlCorrectionMap(Array.isArray(payload?.corrections) ? payload.corrections : [])
  } catch {
    return new Map()
  }
}

export function applyJobUrlCorrections(jobs, corrections) {
  const map = corrections instanceof Map ? corrections : buildJobUrlCorrectionMap(corrections)
  let changed = 0
  const out = (Array.isArray(jobs) ? jobs : []).map((job) => {
    const entry = map.get(key(job?.url, job?.college))
    if (!entry) return job
    if (entry.title && clean(entry.title).toLowerCase() !== clean(job?.title).toLowerCase()) return job
    changed++
    return { ...job, url: entry.to }
  })
  return { jobs: out, changed }
}
