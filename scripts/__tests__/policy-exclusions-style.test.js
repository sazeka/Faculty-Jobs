import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exclusionsPage = fs.readFileSync(path.join(ROOT, "web-vue/public/policy-exclusions.html"), "utf8");

test("policy exclusions page uses the Faculty Atlas visual system", () => {
  assert.match(exclusionsPage, /--paper:\s*#fff/);
  assert.match(exclusionsPage, /--accent:\s*#c2410c/);
  assert.match(exclusionsPage, /Instrument Serif/);
  assert.match(exclusionsPage, /Newsreader/);
  assert.match(exclusionsPage, /JetBrains Mono/);
  assert.match(exclusionsPage, /Faculty <i>Atlas<\/i>/);
  assert.doesNotMatch(exclusionsPage, /#f8f4ec|linear-gradient\(180deg, #fbf8f2/);
});
