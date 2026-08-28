function dateOnly(value) {
  const match = String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})/)
  if (!match) return null
  const parsed = new Date(`${match[1]}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== match[1]) return null
  return match[1]
}

export function expirationCutoff(today = new Date(), graceDays = 7) {
  const current = dateOnly(today instanceof Date ? today.toISOString() : today)
  if (!current) throw new TypeError('today must be a valid date')
  const cutoff = new Date(`${current}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(0, Number(graceDays) || 0))
  return cutoff.toISOString().slice(0, 10)
}

export function isExpiredPastGrace(job, { today = new Date(), graceDays = 7 } = {}) {
  if (job?.openUntilFilled) return false
  const closeDate = dateOnly(job?.closeDate)
  if (!closeDate) return false
  return closeDate < expirationCutoff(today, graceDays)
}

export function partitionExpiredJobs(jobs, options = {}) {
  const kept = []
  const expired = []
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (isExpiredPastGrace(job, options)) expired.push(job)
    else kept.push(job)
  }
  return { kept, expired }
}

export function filterExpiredDeadlineCache(jobs, cache, options = {}) {
  const kept = []
  const expired = []
  const entries = cache && typeof cache === 'object' ? cache : {}
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const cached = entries[String(job?.url || '')]
    if (!cached) {
      kept.push(job)
      continue
    }

    // Fresh, explicit source evidence always wins over the tombstone.
    if (job?.openUntilFilled || (job?.closeDate && !isExpiredPastGrace(job, options))) {
      kept.push(job)
      continue
    }

    if (isExpiredPastGrace({ closeDate: cached.closeDate }, options)) expired.push(job)
    else kept.push(job)
  }
  return { kept, expired }
}
