import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanDepartmentText,
  isKnownDisciplineValue,
  buildKnownDisciplineVocabulary,
  deriveDisciplineFromDepartment,
} from "../lib/discipline-from-department.js";

test("cleanDepartmentText strips institutional wrapper text", () => {
  assert.equal(cleanDepartmentText("Department of Nursing"), "Nursing");
  assert.equal(cleanDepartmentText("Division of Nursing"), "Nursing");
  assert.equal(cleanDepartmentText("School of Nursing"), "Nursing");
  assert.equal(cleanDepartmentText("College of Nursing"), "Nursing");
  assert.equal(cleanDepartmentText("Of Human Medicine"), "Human Medicine");
  assert.equal(cleanDepartmentText("Faculty - Business"), "Business");
  assert.equal(cleanDepartmentText("Politics Department"), "Politics");
  assert.equal(cleanDepartmentText("Undergraduate Nursing Dept."), "Undergraduate Nursing");
  assert.equal(cleanDepartmentText("Nursing Programs"), "Nursing");
  assert.equal(
    cleanDepartmentText("Biology Region: Finger Lakes Open until filled"),
    "Biology"
  );
  assert.equal(cleanDepartmentText("Biochemistry)"), "Biochemistry");
  assert.equal(cleanDepartmentText("Art & Art History (Studio Art)"), "Art & Art History (Studio Art)");
  assert.equal(cleanDepartmentText("  Chemistry  "), "Chemistry");
  assert.equal(cleanDepartmentText(""), "");
  assert.equal(cleanDepartmentText(null), "");
});

test("isKnownDisciplineValue rejects generic/administrative noise", () => {
  assert.equal(isKnownDisciplineValue("Nursing"), true);
  assert.equal(isKnownDisciplineValue("unknown"), false);
  assert.equal(isKnownDisciplineValue("Other"), false);
  assert.equal(isKnownDisciplineValue("Instruction"), false);
  assert.equal(isKnownDisciplineValue("Clinical"), false);
  assert.equal(isKnownDisciplineValue("Academic Affairs"), false);
  assert.equal(isKnownDisciplineValue("null"), false);
  assert.equal(isKnownDisciplineValue(""), false);
});

test("buildKnownDisciplineVocabulary picks the most common casing and drops noise", () => {
  const jobs = [
    { discipline: "Computer Science" },
    { discipline: "computer science" },
    { discipline: "Computer Science" },
    { discipline: "Nursing" },
    { discipline: "unknown" },
    { discipline: "Other" },
    { discipline: null },
    { discipline: undefined },
  ];
  const vocab = buildKnownDisciplineVocabulary(jobs);
  assert.equal(vocab.get("computer science"), "Computer Science");
  assert.equal(vocab.get("nursing"), "Nursing");
  assert.equal(vocab.has("unknown"), false);
  assert.equal(vocab.has("other"), false);
  assert.equal(vocab.size, 2);
});

test("deriveDisciplineFromDepartment reuses a vetted discipline for a matching department", () => {
  const vocab = buildKnownDisciplineVocabulary([{ discipline: "Nursing" }, { discipline: "Nursing" }]);
  assert.equal(deriveDisciplineFromDepartment("Department of Nursing", vocab), "Nursing");
  assert.equal(deriveDisciplineFromDepartment("School of Nursing", vocab), "Nursing");
  assert.equal(deriveDisciplineFromDepartment("NURSING", vocab), "Nursing");
});

test("deriveDisciplineFromDepartment refuses to guess at unvetted or institution-like text", () => {
  const vocab = buildKnownDisciplineVocabulary([{ discipline: "Nursing" }, { discipline: "Nursing" }]);
  assert.equal(deriveDisciplineFromDepartment("Pennsylvania", vocab), null);
  assert.equal(deriveDisciplineFromDepartment("Technical College of the Lowcountry", vocab), null);
  assert.equal(deriveDisciplineFromDepartment("Academic Affairs", vocab), null);
  assert.equal(deriveDisciplineFromDepartment("", vocab), null);
  assert.equal(deriveDisciplineFromDepartment(null, vocab), null);
});
