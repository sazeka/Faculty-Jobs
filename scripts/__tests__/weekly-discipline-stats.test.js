import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDiscipline,
  computeDisciplineBreakdown,
} from "../lib/weekly-discipline-stats.js";

test("normalizeDiscipline treats blank and the literal string null as unclassified", () => {
  assert.equal(normalizeDiscipline("Nursing"), "Nursing");
  assert.equal(normalizeDiscipline("  Computer Science  "), "Computer Science");
  assert.equal(normalizeDiscipline(null), null);
  assert.equal(normalizeDiscipline(undefined), null);
  assert.equal(normalizeDiscipline(""), null);
  assert.equal(normalizeDiscipline("null"), null);
  assert.equal(normalizeDiscipline("Null"), null);
});

test("discipline breakdown counts postings and keeps unclassified jobs unknown", () => {
  const jobs = [
    { discipline: "Nursing" },
    { discipline: "Nursing" },
    { discipline: "Computer Science" },
    { discipline: "null" },
    { discipline: null },
  ];

  assert.deepEqual(computeDisciplineBreakdown(jobs), {
    classified: 3,
    unknown: 2,
    distinctDisciplines: 2,
    classifiedPct: 60,
    topDisciplines: [
      { discipline: "Nursing", count: 2 },
      { discipline: "Computer Science", count: 1 },
    ],
  });
});

test("discipline breakdown ranks ties alphabetically and caps the top list at 10", () => {
  const jobs = Array.from({ length: 12 }, (_, i) => ({ discipline: `Discipline ${String(i).padStart(2, "0")}` }));

  const breakdown = computeDisciplineBreakdown(jobs);
  assert.equal(breakdown.distinctDisciplines, 12);
  assert.equal(breakdown.topDisciplines.length, 10);
  assert.equal(breakdown.topDisciplines[0].discipline, "Discipline 00");
  assert.equal(breakdown.topDisciplines[9].discipline, "Discipline 09");
});
