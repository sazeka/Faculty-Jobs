import assert from "node:assert/strict";
import test from "node:test";

import { inferDepartmentFromTitle } from "../lib/department-inference.js";

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
