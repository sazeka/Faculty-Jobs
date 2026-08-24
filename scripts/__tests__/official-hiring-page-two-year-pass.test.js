import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isGenericFacultyPageChromeTitle } from "../../server.js";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");

test("remaining two-year pass uses employee hiring pages instead of student career services", () => {
  assert.match(source, /Pima Community College.*schooljobs\.com\/careers\/pimacc/);
  assert.match(source, /Western Technical College.*work-at-western/);
  assert.match(source, /North Central Michigan College.*join-our-team\.html/);
  assert.doesNotMatch(source, /Western Technical College.*become-career-ready/);
});

test("institution-specific hiring boards remain scoped to their college", () => {
  assert.match(source, /Illinois Valley Community College.*type: "applitrack".*applitrack\.com\/ivcc/);
  assert.match(source, /Lakeshore Technical College.*careers\.lakeshore\.edu\/jobs/);
  assert.match(source, /Mississippi Delta Community College.*msdelta\.edu\/human-resources\/employment-opportunities/);
});

test("employee hiring hubs do not emit faculty resource links as jobs", () => {
  for (const title of [
    "Adjunct Faculty Application Process",
    "Adjunct Faculty Resources",
    "Faculty Credentialing Manual",
    "Faculty Documents and Forms",
  ]) {
    assert.equal(isGenericFacultyPageChromeTitle(title), true, title);
  }
  assert.equal(isGenericFacultyPageChromeTitle("Assistant Professor of Nursing"), false);
});
