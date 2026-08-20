#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditInstitutions } from "./lib/institution-audit.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const audit = auditInstitutions(Array.isArray(input?.institutions) ? input.institutions : []);
const report = { generatedAt: new Date().toISOString(), ...audit };
const out = path.join(ROOT, "generated/institution-data-audit.json");
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Institutions: ${audit.institutions}`);
console.log(`Duplicate names: ${audit.duplicateNames.length}`);
console.log(`Duplicate UNITIDs: ${audit.duplicateUnitids.length}`);
console.log(`Alias collisions: ${audit.aliasCollisions.length}`);
console.log(`Unknown metadata: ${audit.unknownMetadata.length}`);
console.log(`Synthetic /faculty/jobs URLs: ${audit.suspiciousSyntheticCareerUrls.length}`);
console.log("Wrote generated/institution-data-audit.json");

// A duplicated normalized name makes rows ambiguous and is always invalid.
// Shared UNITIDs are reported for review but are not automatically fatal:
// branch campuses can legitimately share an institutional identifier.
if (process.argv.includes("--fail-on-duplicates") && audit.duplicateNames.length) {
  process.exitCode = 1;
}
