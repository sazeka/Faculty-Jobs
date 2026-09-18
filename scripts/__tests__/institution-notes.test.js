import assert from "node:assert/strict";
import test from "node:test";
import { appendUniqueInstitutionNote, dedupeNotesText } from "../lib/institution-notes.js";

test("appends a new institution note once", () => {
  assert.equal(appendUniqueInstitutionNote("Existing note.", "New note."), "Existing note. New note.");
});

test("does not duplicate an institution note already present", () => {
  assert.equal(appendUniqueInstitutionNote("Existing note. New note.", "New note."), "Existing note. New note.");
});

test("preserves an existing note when the addition is empty", () => {
  assert.equal(appendUniqueInstitutionNote("Existing note.", null), "Existing note.");
});

// Regression coverage for issue #161: data/institutions-master.json
// accumulated massive repeated-sentence bloat because notes were carried
// forward and appended to on every rebuild without checking whether the
// text was already present.

test("appendUniqueInstitutionNote dedupes a multi-sentence addition against existing notes", () => {
  const existing = "First fact. Second fact.";
  const addition = "Second fact. Third fact.";
  assert.equal(appendUniqueInstitutionNote(existing, addition), "First fact. Second fact. Third fact.");
});

test("appendUniqueInstitutionNote self-heals sentences already duplicated in existing notes", () => {
  const existing = "Quarantined due to repeated broken career link checks. Quarantined due to repeated broken career link checks. Quarantined due to repeated broken career link checks.";
  assert.equal(
    appendUniqueInstitutionNote(existing, null),
    "Quarantined due to repeated broken career link checks."
  );
});

test("appendUniqueInstitutionNote does not duplicate when called repeatedly with the same fixed text (simulating repeated rebuilds)", () => {
  let notes = null;
  for (let i = 0; i < 10; i += 1) {
    notes = appendUniqueInstitutionNote(notes, "Quarantined due to repeated broken career link checks.");
  }
  assert.equal(notes, "Quarantined due to repeated broken career link checks.");
});

test("dedupeNotesText collapses a repeated sentence, keeping the first occurrence", () => {
  const repeated = "Configured /faculty/jobs 404s; routed to Workday. ".repeat(196).trim();
  assert.equal(dedupeNotesText(repeated), "Configured /faculty/jobs 404s; routed to Workday.");
});

test("dedupeNotesText preserves distinct sentences and their order", () => {
  const text = "First fact. Second fact. First fact. Third fact. Second fact.";
  assert.equal(dedupeNotesText(text), "First fact. Second fact. Third fact.");
});

test("dedupeNotesText returns null for empty/whitespace-only input", () => {
  assert.equal(dedupeNotesText(""), null);
  assert.equal(dedupeNotesText(null), null);
  assert.equal(dedupeNotesText("   "), null);
});

test("dedupeNotesText leaves already-distinct notes unchanged (idempotent)", () => {
  const text = "Alpha statement. Beta statement. Gamma statement.";
  assert.equal(dedupeNotesText(text), text);
  assert.equal(dedupeNotesText(dedupeNotesText(text)), text);
});
