import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");

test("eleventh pass uses Gratz's own employment page", () => {
  assert.match(source, /^\s*\{ campus: "Gratz College", type: "generic", url: "https:\/\/www\.gratz\.edu\/employment" \},$/m);
  assert.doesNotMatch(source, /campus: "Gratz College"[^\n]+workforcenow\.adp\.com/);
});
