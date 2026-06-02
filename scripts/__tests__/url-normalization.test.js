import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl, inferPlatformFromUrl, normalizeNameKey, clean } from "../lib/url-normalization.js";

test("canonicalizeUrl upgrades to https and strips hash", () => {
  assert.equal(canonicalizeUrl("http://example.com/jobs#top"), "https://example.com/jobs");
});

test("canonicalizeUrl strips tracking params but keeps real ones", () => {
  assert.equal(
    canonicalizeUrl("https://x.com/j?utm_source=email&id=5&fbclid=abc"),
    "https://x.com/j?id=5"
  );
  assert.equal(canonicalizeUrl("https://x.com/j?utm_campaign=q"), "https://x.com/j");
});

test("canonicalizeUrl collapses slashes and trims trailing slash", () => {
  assert.equal(canonicalizeUrl("https://x.com//a///b/"), "https://x.com/a/b");
});

test("canonicalizeUrl assumes https for bare hosts and rejects junk", () => {
  assert.equal(canonicalizeUrl("example.com/jobs"), "https://example.com/jobs");
  assert.equal(canonicalizeUrl(""), null);
  assert.equal(canonicalizeUrl("mailto:a@b.com"), null);
  assert.equal(canonicalizeUrl("ftp://x.com"), null);
});

test("inferPlatformFromUrl recognizes known ATS platforms", () => {
  assert.equal(inferPlatformFromUrl("https://abc.myworkdayjobs.com/x"), "workday");
  assert.equal(inferPlatformFromUrl("https://jobs.silkroad.com/x"), "generic");
  assert.equal(inferPlatformFromUrl("https://unm.csod.com/x"), "csod");
  assert.equal(inferPlatformFromUrl("https://x.interfolio.com/y"), "interfolio");
  assert.equal(inferPlatformFromUrl(""), null);
});

test("normalizeNameKey and clean normalize whitespace/case", () => {
  assert.equal(normalizeNameKey("  Big   State  University "), "big state university");
  assert.equal(clean("  a\t b\n"), "a b");
});
