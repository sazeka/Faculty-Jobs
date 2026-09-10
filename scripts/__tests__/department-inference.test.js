import assert from "node:assert/strict";
import test from "node:test";

import {
  inferDepartmentFromTitle,
  inferDepartmentFromDescription,
  inferDepartment,
} from "../lib/department-inference.js";

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

test("infers department from a labeled 'Department:' field in the description", () => {
  assert.equal(
    inferDepartmentFromDescription("Job Title: Adjunct Faculty Department: Nursing Location: Joplin, MO"),
    "Nursing"
  );
  assert.equal(
    inferDepartmentFromDescription("Department: Business, Legal Professions & Hospitality Campus: Metro"),
    "Business, Legal Professions & Hospitality"
  );
});

test("does not match loose prose mentions of 'department' (precision over coverage)", () => {
  // Deliberately not supported: catching this pattern in the live dataset also
  // pulled in garbage (a person's name, a stray UI label) -- only the
  // colon-labeled field form is trusted.
  assert.equal(
    inferDepartmentFromDescription("She is a senior researcher in the Department of Toxicology."),
    null
  );
});

test("rejects candidate values that don't look like a real department name", () => {
  assert.equal(inferDepartmentFromDescription("Department: 12345"), null);
  assert.equal(inferDepartmentFromDescription("Department: contact hr@example.edu"), null);
  assert.equal(inferDepartmentFromDescription("Department: Click here to apply"), null);
});

test("inferDepartment prefers the title match over the description match", () => {
  assert.equal(
    inferDepartment({
      title: "Assistant Professor of Physics",
      description: "Department: Chemistry",
    }),
    "Physics"
  );
  assert.equal(
    inferDepartment({
      title: "Assistant Professor",
      description: "Department: Chemistry",
    }),
    "Chemistry"
  );
  assert.equal(inferDepartment({ title: "Assistant Professor", description: "" }), null);
});
