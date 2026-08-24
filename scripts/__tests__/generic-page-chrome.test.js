import test from "node:test";
import assert from "node:assert/strict";
import { isGenericFacultyPageChromeTitle } from "../../server.js";

test("generic career scraping rejects faculty-themed page chrome", () => {
  assert.equal(isGenericFacultyPageChromeTitle("Early Alert Form - Faculty/Staff"), true);
  assert.equal(isGenericFacultyPageChromeTitle("Distinguished Faculty"), true);
  assert.equal(isGenericFacultyPageChromeTitle("Faculty and Staff"), true);
  assert.equal(isGenericFacultyPageChromeTitle("New Faculty Experience"), true);
  assert.equal(isGenericFacultyPageChromeTitle("Faculty CV & Syllabi"), true);
  assert.equal(isGenericFacultyPageChromeTitle("Staff/Faculty Member"), true);
  assert.equal(isGenericFacultyPageChromeTitle("Benefits: Adjunct Faculty"), true);
  assert.equal(isGenericFacultyPageChromeTitle("For Faculty & Staff"), true);
  assert.equal(isGenericFacultyPageChromeTitle("LGBTQIA Faculty & Staff Liaison"), true);
  assert.equal(isGenericFacultyPageChromeTitle("Faculty Professional Development"), true);
  assert.equal(isGenericFacultyPageChromeTitle("Faculty Diversity Internship Program"), true);
  assert.equal(isGenericFacultyPageChromeTitle("Northeast Faculty & Administration Application (PDF, 0.2 MB)"), true);
  assert.equal(isGenericFacultyPageChromeTitle("Faculty - Biology"), false);
  assert.equal(isGenericFacultyPageChromeTitle("Distinguished Faculty Fellow"), false);
  assert.equal(isGenericFacultyPageChromeTitle("Adjunct Faculty Position Description (PDF)"), false);
});
