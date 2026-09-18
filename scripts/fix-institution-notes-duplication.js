#!/usr/bin/env node
// One-off migration for issue #161: data/institutions-master.json's `notes`
// field accumulated massive exact-sentence repetition because
// build-institutions-master.js (and a handful of one-off apply-*.js scripts)
// carried `prev.notes` forward and appended override/quarantine/discovery
// text on every rebuild without checking whether that text was already
// present. `appendUniqueInstitutionNote()` (scripts/lib/institution-notes.js)
// now guards every append site AND self-heals already-duplicated notes on
// every future `npm run build:institutions`, so this never regresses -- but
// records already committed to data/institutions-master.json from before
// that guard existed still carry the accumulated duplicate text and need a
// one-time cleanup pass.
//
// This reuses the exact same dedupeNotesText() helper the live build
// pipeline now runs on every rebuild (scripts/lib/institution-notes.js), so
// it can never collapse a record's notes any differently than the pipeline
// itself now would. It only collapses sentences that are exact duplicates
// (after whitespace normalization) of an earlier sentence in the same
// record's notes -- genuinely distinct statements, even ones covering
// similar ground in different words, are left untouched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dedupeNotesText } from "./lib/institution-notes.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
const TARGET = path.join(ROOT, "data", "institutions-master.json");
const REPORT_PATH = path.join(ROOT, "generated", "institution-notes-duplication-fix-report.json");

const source = JSON.parse(fs.readFileSync(TARGET, "utf8"));
const institutions = Array.isArray(source.institutions) ? source.institutions : [];

let beforeChars = 0;
let afterChars = 0;
const changes = [];

const updated = institutions.map((institution) => {
  const before = String(institution.notes || "");
  beforeChars += before.length;
  if (!before) {
    return institution;
  }

  const after = dedupeNotesText(before) || "";
  afterChars += after.length;

  if (after !== before) {
    changes.push({
      name: institution.name,
      unitid: institution.unitid || null,
      beforeLength: before.length,
      afterLength: after.length,
      bytesRemoved: before.length - after.length,
    });
    return { ...institution, notes: after || null };
  }

  return institution;
});

changes.sort((a, b) => b.bytesRemoved - a.bytesRemoved);

const report = {
  generatedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  totalInstitutions: institutions.length,
  institutionsChanged: changes.length,
  totalNotesCharsBefore: beforeChars,
  totalNotesCharsAfter: afterChars,
  totalCharsRemoved: beforeChars - afterChars,
  topChanges: changes.slice(0, 25),
  changes,
};

console.log(
  JSON.stringify(
    {
      ...report,
      topChanges: `${report.topChanges.length} entries (see report file)`,
      changes: `${changes.length} entries (see report file)`,
    },
    null,
    2
  )
);

if (!DRY_RUN) {
  const output = { ...source, institutions: updated };
  fs.writeFileSync(TARGET, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
