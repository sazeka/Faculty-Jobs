import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");

test("final exception pass promotes Grand View without misattributing hospital jobs", () => {
  assert.match(source, /^\s*\{ campus: "Grand View University", type: "paycom"/m);
  assert.doesNotMatch(source, /^\s*\{ campus: "Jefferson Regional School of Nursing"/m);
  const ia = source.match(/async function scrapeIaAll[\s\S]*?async function scrapeWyAll/);
  assert.ok(ia);
  assert.match(ia[0], /type === "paycom"/);
});
