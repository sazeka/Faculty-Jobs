import { isPlaceholderLocation } from './post-quality.js'

// Issue #120: a job's `location` is often just the institution's own name
// plus a state suffix ("Wilson Community College, NC", "Medical College of
// Wisconsin, WI") rather than a real city. server.js's
// normalizeLocationByCollege() now catches this going forward for newly
// scraped jobs, but records already committed to public/jobs.json /
// docs/jobs.json from before that fix need a one-time backfill pass.
//
// This is intentionally a thin wrapper around the exact same two building
// blocks the live pipeline uses -- isPlaceholderLocation() (post-quality.js)
// to detect the placeholder, and the caller-supplied getCollegeLocationFallback
// (server.js) to resolve it -- so the migration can never diverge from what
// the scraper itself would now produce. It resolves via an exact
// institution-name match only (see server.js's getCollegeLocationFallback for
// why fuzzy/substring matching was removed in #127), so it never guesses: an
// institution with no known campus city is left untouched rather than paired
// with a nearby-sounding but different school.
export function resolvePlaceholderLocation(job, getCollegeLocationFallback) {
  if (!isPlaceholderLocation(job?.location, job?.college)) return null
  const fallback = getCollegeLocationFallback(job?.college)
  if (!fallback || fallback === job?.location) return null
  return fallback
}

// Applies resolvePlaceholderLocation() across a jobs array, returning a new
// array (inputs are not mutated) plus a report of what changed.
export function backfillPlaceholderLocations(jobs, getCollegeLocationFallback) {
  const rows = Array.isArray(jobs) ? jobs : []
  const changes = []
  const updated = rows.map((job) => {
    const resolved = resolvePlaceholderLocation(job, getCollegeLocationFallback)
    if (!resolved) return job
    changes.push({ college: job.college, url: job.url || null, from: job.location, to: resolved })
    return { ...job, location: resolved }
  })
  return { jobs: updated, changes }
}
