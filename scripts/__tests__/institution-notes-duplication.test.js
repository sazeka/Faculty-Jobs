import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dedupeNotesText } from "../lib/institution-notes.js";

// Regression coverage for issue #161: data/institutions-master.json's `notes`
// field accumulated 18.2 MB of exact-repeated-sentence bloat across 2,252
// institutions because notes were carried forward and appended to on every
// rebuild without checking whether the text was already present. A one-off
// migration (scripts/fix-institution-notes-duplication.js) cleaned up the
// already-published master, and appendUniqueInstitutionNote()/
// dedupeNotesText() (scripts/lib/institution-notes.js) now guard every append
// site so it can't reaccumulate. These tests assert the real, checked-in
// data file stays clean going forward -- if a future append site bypasses
// the shared helpers and reintroduces duplicate sentences, this fails.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "institutions-master.json"), "utf8"));
const institutions = Array.isArray(master.institutions) ? master.institutions : [];

test("institutions-master.json has institutions to check (sanity)", () => {
  assert.ok(institutions.length > 1000, `expected a substantial institution list, got ${institutions.length}`);
});

test("no institution note contains an exact-duplicate sentence", () => {
  const offenders = institutions
    .filter((inst) => inst.notes && dedupeNotesText(inst.notes) !== inst.notes)
    .map((inst) => inst.name);
  assert.deepEqual(offenders, [], `institutions with duplicate sentences in notes: ${offenders.slice(0, 10).join(", ")}`);
});

test("no institution note is unreasonably large", () => {
  // The worst offenders before the #161 cleanup were 100KB-148KB of repeated
  // prose. Genuinely distinct, non-duplicated note content for a single
  // institution should never approach that -- cap well above the largest
  // deduped record observed post-cleanup, to catch any regression that grows
  // notes unboundedly again without being so tight it flags legitimate
  // detailed audit trails.
  const MAX_NOTE_LENGTH = 10000;
  const offenders = institutions
    .filter((inst) => (inst.notes || "").length > MAX_NOTE_LENGTH)
    .map((inst) => ({ name: inst.name, length: inst.notes.length }));
  assert.deepEqual(offenders, [], `institutions with oversized notes: ${JSON.stringify(offenders.slice(0, 10))}`);
});

test("total notes payload across all institutions stays well under the pre-#161 18.2 MB", () => {
  const totalChars = institutions.reduce((sum, inst) => sum + (inst.notes || "").length, 0);
  // Post-cleanup this measured ~630KB; leave generous headroom for organic
  // growth (new institutions, genuinely distinct audit notes) while still
  // catching a reaccumulation regression well before it reaches the old 18MB.
  assert.ok(
    totalChars < 2_000_000,
    `total notes payload grew to ${totalChars} chars -- check for a reaccumulating append site`
  );
});
