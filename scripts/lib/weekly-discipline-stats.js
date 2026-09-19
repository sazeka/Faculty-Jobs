import { normalizeDisciplineValue } from "./discipline-normalize.js";

// The scraped `discipline` field is either a specific value (e.g. "Nursing",
// "Computer Science") or absent/placeholder for the ~80% of listings no
// enrichment pass has classified yet. Delegates to the shared missing-value
// check (issue #148) so "null", "Unknown"/"unknown", and blank values are all
// treated as unclassified here too, not just the literal string "null" this
// function used to catch on its own.
export function normalizeDiscipline(raw) {
  return normalizeDisciplineValue(raw);
}

export function computeDisciplineBreakdown(jobs = []) {
  const byDiscipline = new Map();
  let unknown = 0;

  for (const job of jobs) {
    const discipline = normalizeDiscipline(job?.discipline);
    if (!discipline) {
      unknown += 1;
      continue;
    }
    byDiscipline.set(discipline, (byDiscipline.get(discipline) || 0) + 1);
  }

  const total = jobs.length;
  const classified = total - unknown;

  const topDisciplines = [...byDiscipline.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([discipline, count]) => ({ discipline, count }));

  return {
    classified,
    unknown,
    distinctDisciplines: byDiscipline.size,
    classifiedPct: total ? Number(((classified / total) * 100).toFixed(1)) : 0,
    topDisciplines,
  };
}
