import assert from "node:assert/strict";
import test from "node:test";

import {
  BOT_BLOCKED_STATUS,
  hasMeaningfulTimedOutPage,
  hasBotChallengeUrl,
  isHardVerificationFailure,
  nextConsecutiveFailures,
} from "../lib/link-verdict.js";

test("challenge redirects are recognized even when the HTTP status looks successful", () => {
  assert.equal(hasBotChallengeUrl("https://example.edu/jobs?challenge=abc123"), true);
  assert.equal(hasBotChallengeUrl("https://example.edu/jobs?query=challenge"), false);
  assert.equal(hasBotChallengeUrl("not a URL"), false);
});

test("bot-blocked links do not count as hard failures", () => {
  assert.equal(isHardVerificationFailure(BOT_BLOCKED_STATUS), false);
  assert.equal(nextConsecutiveFailures(12, BOT_BLOCKED_STATUS), 0);
});

test("healthy links reset their failure streak", () => {
  assert.equal(isHardVerificationFailure("healthy"), false);
  assert.equal(nextConsecutiveFailures(3, "healthy"), 0);
});

test("broken and invalid links increment their failure streak", () => {
  assert.equal(isHardVerificationFailure("broken"), true);
  assert.equal(nextConsecutiveFailures(1, "broken"), 2);
  assert.equal(isHardVerificationFailure("invalid"), true);
  assert.equal(nextConsecutiveFailures(0, "invalid"), 1);
});

test("a timed-out navigation can still prove that a real page rendered", () => {
  assert.equal(
    hasMeaningfulTimedOutPage(
      "https://example.edu/careers",
      "Careers",
      "Current faculty opportunities ".repeat(5)
    ),
    true
  );
  assert.equal(hasMeaningfulTimedOutPage("about:blank", "", "Loading..."), false);
  assert.equal(hasMeaningfulTimedOutPage("https://example.edu/careers", "", "Loading..."), false);
});
