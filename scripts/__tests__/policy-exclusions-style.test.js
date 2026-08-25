import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exclusionsPage = fs.readFileSync(path.join(ROOT, "web-vue/public/policy-exclusions.html"), "utf8");
const publicCopy = fs.readFileSync(path.join(ROOT, "public/policy-exclusions.html"), "utf8");
const docsCopy = fs.readFileSync(path.join(ROOT, "docs/policy-exclusions.html"), "utf8");

test("policy exclusions page uses the Faculty Atlas visual system", () => {
  assert.match(exclusionsPage, /--paper:\s*#FFFFFF/);
  assert.match(exclusionsPage, /--paper-2:\s*#E1E8EB/);
  assert.match(exclusionsPage, /--ink:\s*#0E1B24/);
  assert.match(exclusionsPage, /--accent:\s*#C2410C/);
  assert.match(exclusionsPage, /Instrument Serif/);
  assert.match(exclusionsPage, /Newsreader/);
  assert.match(exclusionsPage, /JetBrains Mono/);
  assert.match(exclusionsPage, /Faculty <i>Atlas<\/i>/);
  assert.match(exclusionsPage, /position:\s*sticky/);
  assert.match(exclusionsPage, /background:\s*var\(--paper\)/);
  assert.match(exclusionsPage, /<nav class="nav" aria-label="Primary navigation">/);
  assert.match(exclusionsPage, /<hr class="masthead-rule" \/>/);
  assert.match(exclusionsPage, /<div class="edition-bar">/);
  assert.match(exclusionsPage, /<text x="32" y="6"[^>]*>N<\/text>/);
  assert.doesNotMatch(exclusionsPage, /#f2ecdf|#e8e0ce|#15110d|#7a1f23|linear-gradient\(180deg, #fbf8f2/i);
});

test("all deployed policy exclusions copies share the same site shell", () => {
  assert.equal(publicCopy, exclusionsPage);
  assert.equal(docsCopy, exclusionsPage);
});
