import test from "node:test";
import assert from "node:assert/strict";
import { isMissingDiscipline, normalizeDisciplineValue } from "../lib/discipline-normalize.js";

// Issue #148: 1,136 records stored a truthy placeholder string instead of a
// real null/undefined for a missing discipline, permanently blocking
// reclassification wherever code only checked `=== undefined`.

test("isMissingDiscipline recognizes real null/undefined", () => {
  assert.equal(isMissingDiscipline(undefined), true);
  assert.equal(isMissingDiscipline(null), true);
});

test("isMissingDiscipline recognizes the confirmed placeholder strings, case-insensitively", () => {
  assert.equal(isMissingDiscipline("null"), true);
  assert.equal(isMissingDiscipline("Null"), true);
  assert.equal(isMissingDiscipline("NULL"), true);
  assert.equal(isMissingDiscipline("Unknown"), true);
  assert.equal(isMissingDiscipline("unknown"), true);
  assert.equal(isMissingDiscipline("UNKNOWN"), true);
  assert.equal(isMissingDiscipline("undefined"), true);
});

test("isMissingDiscipline recognizes blank and whitespace-only values", () => {
  assert.equal(isMissingDiscipline(""), true);
  assert.equal(isMissingDiscipline("   "), true);
  assert.equal(isMissingDiscipline("\t\n"), true);
});

test("isMissingDiscipline does not flag a real discipline", () => {
  assert.equal(isMissingDiscipline("Biology"), false);
  assert.equal(isMissingDiscipline("Computer Science"), false);
  // A real discipline that merely contains "unknown"/"null" as a substring
  // must not be treated as missing -- only an exact (trimmed) match counts.
  assert.equal(isMissingDiscipline("Nullification Studies"), false);
});

test("normalizeDisciplineValue collapses every placeholder to real null", () => {
  assert.equal(normalizeDisciplineValue(undefined), null);
  assert.equal(normalizeDisciplineValue(null), null);
  assert.equal(normalizeDisciplineValue("null"), null);
  assert.equal(normalizeDisciplineValue("Unknown"), null);
  assert.equal(normalizeDisciplineValue("unknown"), null);
  assert.equal(normalizeDisciplineValue("undefined"), null);
  assert.equal(normalizeDisciplineValue("   "), null);
});

test("normalizeDisciplineValue trims and passes through a real discipline unchanged", () => {
  assert.equal(normalizeDisciplineValue("Biology"), "Biology");
  assert.equal(normalizeDisciplineValue("  Nursing  "), "Nursing");
});
