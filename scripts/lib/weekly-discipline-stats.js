// The scraped `discipline` field is either a specific value (e.g. "Nursing",
// "Computer Science") or absent/placeholder for the ~80% of listings no
// enrichment pass has classified yet. Treat both `null` and the literal
// string "null" (seen from a handful of sources that serialize it that way)
// as unclassified rather than as a discipline called "null".
export function normalizeDiscipline(raw) {
  const value = String(raw ?? "").trim();
  if (!value || value.toLowerCase() === "null") return null;
  return value;
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
