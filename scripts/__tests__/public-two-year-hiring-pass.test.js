import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");

test("public two-year pass uses official employee hiring routes", () => {
  assert.match(source, /Garden City Community College.*type: "paycom".*paycomonline\.net/);
  assert.match(source, /Lancaster County Career and Technology Center.*type: "applitrack".*applitrack\.com\/lancasterctc/);
  assert.match(source, /Moraine Valley Community College.*type: "peopleadmin".*jobs\.morainevalley\.edu/);
  assert.match(source, /Passaic County Community College.*type: "adp".*workforcenow\.adp\.com/);
  assert.match(source, /Salina Area Technical College.*salinatech\.edu\/hr\/current-openings/);
});

test("ambiguous district boards are not introduced as campus sources", () => {
  assert.doesNotMatch(source, /Los Angeles City College.*laccd/);
  assert.doesNotMatch(source, /San Bernardino Community College District.*schooljobs\.com\/careers\/sbccd/);
});

test("Paycom employee boards are faculty-filtered before publication", () => {
  assert.match(source, /const filtered = scoped[\s\S]*?looksFacultyish\(j\.title\)[\s\S]*?omitAdjunct\(j\.title\)/);
});
