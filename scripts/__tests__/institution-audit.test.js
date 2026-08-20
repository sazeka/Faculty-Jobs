import assert from "node:assert/strict";
import test from "node:test";
import { auditInstitutions, strictAuditFailures } from "../lib/institution-audit.js";

test("institution audit identifies duplicate identities and synthetic URLs", () => {
  const report = auditInstitutions([
    { name: "Example College", unitid: "1", state: "CA", control: "public", level: "4-year", aliases: ["EC"] },
    { name: " example college ", unitid: "2", state: null, control: null, level: null, aliases: [] },
    { name: "Another College", unitid: "1", state: "CA", control: "public", level: "4-year", career_url: "https://example.edu/faculty/jobs" },
  ]);
  assert.equal(report.duplicateNames.length, 1);
  assert.equal(report.duplicateUnitids.length, 1);
  assert.deepEqual(report.unknownMetadata, ["example college"]);
  assert.equal(report.suspiciousSyntheticCareerUrls.length, 1);
});

test("strict institution audit reports every prohibited condition", () => {
  const failures = strictAuditFailures({
    duplicateNames: [{}],
    duplicateUnitids: [{}],
    aliasCollisions: [{}],
    unknownMetadata: ["Missing U"],
    suspiciousSyntheticCareerUrls: [{}],
  });
  assert.deepEqual(
    failures.map(({ kind }) => kind),
    [
      "duplicate names",
      "duplicate UNITIDs",
      "alias collisions",
      "unknown metadata",
      "synthetic career URLs",
    ]
  );
});

test("strict institution audit accepts a clean report", () => {
  assert.deepEqual(
    strictAuditFailures({
      duplicateNames: [],
      duplicateUnitids: [],
      aliasCollisions: [],
      unknownMetadata: [],
      suspiciousSyntheticCareerUrls: [],
    }),
    []
  );
});
