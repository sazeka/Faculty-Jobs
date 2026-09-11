import assert from "node:assert/strict";
import test from "node:test";

import { inferDepartmentFromTitle, validateAiDepartmentEvidence } from "../lib/department-inference.js";

test("infers department from explicit 'Professor of/in X' title patterns", () => {
  assert.equal(inferDepartmentFromTitle("Assistant Professor of Chemistry"), "Chemistry");
  assert.equal(inferDepartmentFromTitle("Lecturer in Applied Mathematics"), "Applied Mathematics");
  assert.equal(
    inferDepartmentFromTitle("Postdoctoral Fellow in Computational Biology"),
    "Computational Biology"
  );
  assert.equal(
    inferDepartmentFromTitle("Assistant Professor, Political Science"),
    "Political Science"
  );
});

test("returns null from a title with no department signal", () => {
  assert.equal(inferDepartmentFromTitle("Assistant Professor"), null);
  assert.equal(inferDepartmentFromTitle("Lecturer"), null);
  assert.equal(inferDepartmentFromTitle(""), null);
  assert.equal(inferDepartmentFromTitle(null), null);
});

test("strips a leaked academic-year prefix from the captured value", () => {
  assert.equal(
    inferDepartmentFromTitle("Assistant Professor of 2026/2027: Biology"),
    "Biology"
  );
});

test("rejects candidate values that don't look like a real department name", () => {
  assert.equal(inferDepartmentFromTitle("Professor of https://example.edu"), null);
  assert.equal(inferDepartmentFromTitle("Professor of Click Here To Apply"), null);
});

test("validateAiDepartmentEvidence accepts a department backed by a verbatim, on-topic quote", () => {
  const job = {
    title: "Assistant Professor",
    description: "Join our growing Department of Biochemistry as we expand our research mission.",
  };
  assert.equal(
    validateAiDepartmentEvidence("Department of Biochemistry", "growing Department of Biochemistry as we", job),
    "Department of Biochemistry"
  );
});

test("validateAiDepartmentEvidence rejects a quote that isn't actually in the source (hallucination guard)", () => {
  const job = { title: "Assistant Professor", description: "A generic posting with no department mentioned." };
  assert.equal(
    validateAiDepartmentEvidence("Department of Biochemistry", "Department of Biochemistry seeks applicants", job),
    null
  );
});

test("validateAiDepartmentEvidence rejects a quote present in the source but unrelated to the claimed department", () => {
  const job = {
    title: "Assistant Professor",
    description: "This position is housed within the College of Arts and Sciences.",
  };
  // The quote is real, but it doesn't actually mention "Biochemistry" at all --
  // the model appears to have invented the department despite quoting real text.
  assert.equal(
    validateAiDepartmentEvidence("Department of Biochemistry", "housed within the College of Arts and Sciences", job),
    null
  );
});

test("validateAiDepartmentEvidence rejects a bare generic noun with no qualifying name, even when grounded", () => {
  // Real-world case: Ivy Tech postings contain "...within the framework of
  // common syllabi provided by the school." -- the word "school" is real and
  // grounded, but it isn't naming any specific department.
  const job = {
    title: "Adjunct Faculty- Nursing",
    description: "Faculty must follow the framework of common syllabi provided by the school.",
  };
  assert.equal(validateAiDepartmentEvidence("School", "provided by the school", job), null);
  assert.equal(validateAiDepartmentEvidence("Department", "our department welcomes you", {
    title: "x",
    description: "our department welcomes you to the team",
  }), null);
  // A qualified form is still accepted.
  const qualified = {
    title: "x",
    description: "Join the School of Nursing faculty today.",
  };
  assert.equal(
    validateAiDepartmentEvidence("School of Nursing", "Join the School of Nursing faculty", qualified),
    "School of Nursing"
  );
});

test("validateAiDepartmentEvidence rejects a null/empty department or too-short quote", () => {
  const job = { title: "Assistant Professor", description: "Department of Biochemistry seeks applicants." };
  assert.equal(validateAiDepartmentEvidence(null, "Department of Biochemistry", job), null);
  assert.equal(validateAiDepartmentEvidence("Department of Biochemistry", "Bio", job), null);
});
