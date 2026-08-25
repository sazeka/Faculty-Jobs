import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const review = JSON.parse(fs.readFileSync(new URL("../../generated/promotion-candidates-four-year-next100-pass10.json", import.meta.url), "utf8"));

test("tenth four-year pass keeps only the employee hiring source", () => {
  assert.equal(review.count, 1);
  assert.equal(review.rejectedCount, 1);
  assert.match(source, /^\s*\{ campus: "Notre Dame of Maryland University", type: "adp"/m);
  // This pass correctly rejected Pitzer's shared staff-only Workday tenant.
  // A later live review found Pitzer's separate faculty-only AJO roster; keep
  // forbidding the unsafe candidate without blocking that exact replacement.
  assert.doesNotMatch(source, /campus: "Pitzer College"[^\n]+theclaremontcolleges\.wd1\.myworkdayjobs\.com/);
  assert.match(source, /campus: "Pitzer College"[^\n]+academicjobsonline\.org\/ajo\/Pitzer/);
});
