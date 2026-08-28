import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = fs.readFileSync(path.join(ROOT, "web-vue/src/App.vue"), "utf8");

test("homepage footer uses the light paper palette", () => {
  const footerRule = app.match(/\.fa-footer\s*\{[^}]*display:\s*flex[^}]*\}/s)?.[0] ?? "";

  assert.match(footerRule, /background:\s*var\(--paper-2\)/);
  assert.match(footerRule, /color:\s*var\(--ink-3\)/);
  assert.match(footerRule, /border-top:\s*1px solid var\(--rule-2\)/);
  assert.doesNotMatch(footerRule, /background:\s*var\(--ink\)/);
  assert.match(app, /\.fa-footer strong\s*\{\s*color:\s*var\(--accent-2\)/);
  assert.match(app, /\.fa-footer a\s*\{[^}]*color:\s*var\(--ink-2\)/s);
});
