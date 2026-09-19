import test from "node:test";
import assert from "node:assert/strict";
import { findDisciplineContradiction, auditDisciplineConsistency } from "../lib/discipline-consistency-audit.js";

// Regression fixtures: the confirmed contradictory-discipline examples from
// issue #151. Each of these was found in the live dataset with a stored
// discipline that flatly contradicts an unambiguous single-subject title.

test("Biology -> Business contradiction is detected", () => {
  const found = findDisciplineContradiction({
    title: "Adjunct Biology Instructor",
    department: "Academic Affairs",
    discipline: "Business",
  });
  assert.ok(found);
  assert.deepEqual(found.suggestedDisciplines, ["Biology"]);
});

test("Economics -> Earth Science contradiction is detected", () => {
  const found = findDisciplineContradiction({
    title: "Adjunct Faculty - Economics",
    department: "Economics",
    discipline: "Earth Science",
  });
  assert.ok(found);
  assert.deepEqual(found.suggestedDisciplines, ["Economics"]);
});

test("Sociology -> Spanish contradiction is detected", () => {
  const found = findDisciplineContradiction({
    title: "Adjunct Faculty – Sociology",
    discipline: "Spanish",
  });
  assert.ok(found);
  assert.deepEqual(found.suggestedDisciplines, ["Sociology"]);
});

test("Art Education/Art History -> Computer Science contradiction is detected", () => {
  const found = findDisciplineContradiction({
    title: "Adjunct Faculty in Art Education/Art History",
    discipline: "Computer Science",
  });
  assert.ok(found);
  assert.deepEqual(found.suggestedDisciplines.sort(), ["Art Education", "Art History"]);
});

test("Chemistry -> Computer Information Systems contradiction is detected", () => {
  const found = findDisciplineContradiction({
    title: "Adjunct Faculty: Chemistry",
    discipline: "Computer Information Systems",
  });
  assert.ok(found);
  assert.deepEqual(found.suggestedDisciplines, ["Chemistry"]);
});

test("Economics -> Computer Science contradiction is detected", () => {
  const found = findDisciplineContradiction({
    title: "Adjunct Faculty: Economics",
    discipline: "Computer Science",
  });
  assert.ok(found);
  assert.deepEqual(found.suggestedDisciplines, ["Economics"]);
});

test("Quantum Physics -> Psychology contradiction is detected", () => {
  const found = findDisciplineContradiction({
    title: "Postdoctoral Fellow in Quantum Physics",
    department: "Quantum Physics",
    discipline: "Psychology",
  });
  assert.ok(found);
  assert.deepEqual(found.suggestedDisciplines, ["Physics"]);
});

test("a matching single-subject discipline is not flagged", () => {
  assert.equal(
    findDisciplineContradiction({ title: "Adjunct Faculty - Accounting", discipline: "Accounting" }),
    null
  );
  assert.equal(
    findDisciplineContradiction({ title: "Adjunct Faculty: Chemistry", discipline: "Chemistry" }),
    null
  );
});

test("a genuinely compound/interdisciplinary stored discipline is not flagged", () => {
  assert.equal(
    findDisciplineContradiction({
      title: "Adjunct Faculty - Accounting, Finance, and Economics",
      discipline: "Accounting, Finance, and Economics",
    }),
    null
  );
  assert.equal(
    findDisciplineContradiction({ title: "Adjunct Faculty - Accounting and Law", discipline: "Accounting and Law" }),
    null
  );
});

test("a missing discipline is never flagged as a contradiction", () => {
  assert.equal(findDisciplineContradiction({ title: "Adjunct Faculty - Economics", discipline: null }), null);
  assert.equal(findDisciplineContradiction({ title: "Adjunct Faculty - Economics", discipline: "null" }), null);
});

test("a title with no recognized single-subject structure is never flagged", () => {
  assert.equal(
    findDisciplineContradiction({ title: "Assistant Professor of Practice", discipline: "Anything Else" }),
    null
  );
});

test("auditDisciplineConsistency scans a job list and reports every contradiction", () => {
  const jobs = [
    { url: "u1", title: "Adjunct Biology Instructor", discipline: "Business" },
    { url: "u2", title: "Adjunct Faculty - Accounting", discipline: "Accounting" },
    { url: "u3", title: "Adjunct Faculty: Chemistry", discipline: "Computer Information Systems" },
  ];
  const findings = auditDisciplineConsistency(jobs);
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((f) => f.url).sort(), ["u1", "u3"]);
});
