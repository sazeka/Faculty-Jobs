// Shared "is this discipline field actually missing?" check (issue #148).
//
// Several enrichment/scrape code paths have historically stored a truthy
// placeholder STRING instead of a real JS `null`/`undefined` when a job's
// discipline couldn't be determined: `"null"` (something serialized an
// actual null as text), `"Unknown"` / `"unknown"` (case variants written by
// manual/AI enrichment), and defensively `"undefined"` plus blank or
// whitespace-only strings. Code that only checked `job.discipline ===
// undefined` (or `== null`) silently treated every one of these as "already
// classified" and skipped reclassification forever -- 1,136 records were
// stuck this way.
//
// This is the one shared place that decides what counts as "missing" for the
// `discipline` field. Every enrichment, generation, and stats path should
// import it rather than keep its own ad hoc check (see the git history of
// weekly-discipline-stats.js's `normalizeDiscipline`, which only ever caught
// the literal string "null").
const MISSING_DISCIPLINE_STRINGS = new Set(["null", "unknown", "undefined"]);

export function isMissingDiscipline(value) {
  if (value === undefined || value === null) return true;
  const trimmed = String(value).trim();
  if (!trimmed) return true;
  return MISSING_DISCIPLINE_STRINGS.has(trimmed.toLowerCase());
}

// Returns the real discipline string (trimmed), or null when the stored
// value is one of the missing-value placeholders above.
export function normalizeDisciplineValue(value) {
  return isMissingDiscipline(value) ? null : String(value).trim();
}
