import assert from "node:assert/strict";
import test from "node:test";
import { appendUniqueInstitutionNote } from "../lib/institution-notes.js";

test("appends a new institution note once", () => {
  assert.equal(appendUniqueInstitutionNote("Existing note.", "New note."), "Existing note. New note.");
});

test("does not duplicate an institution note already present", () => {
  assert.equal(appendUniqueInstitutionNote("Existing note. New note.", "New note."), "Existing note. New note.");
});

test("preserves an existing note when the addition is empty", () => {
  assert.equal(appendUniqueInstitutionNote("Existing note.", null), "Existing note.");
});
