import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = fs.readFileSync(path.join(ROOT, "web-vue/src/App.vue"), "utf8");

test("top navigation uses the paper palette instead of a blue banner", () => {
  const redesign = app.slice(app.indexOf("Search-first redesign"));
  const header = redesign.match(/\.fa-header \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(header, /background: color-mix\(in srgb, var\(--paper\)/);
  assert.match(header, /border-bottom: 1px solid var\(--rule-2\)/);
  assert.doesNotMatch(header, /background: var\(--ink\)/);
  assert.match(redesign, /\.fa-header \.fa-wordmark[\s\S]{0,220}color: var\(--ink\)/);
});
