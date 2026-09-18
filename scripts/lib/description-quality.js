// Shared bot-challenge / security-verification description detector (issue #130).
//
// Some sources sit behind bot-detection (Cloudflare, Akamai, etc.), and when a
// scrape lands mid-challenge the "description" text captured is the challenge
// page's own boilerplate -- not any real job content. An audit found 52 records
// whose description was exactly "Performing security verification...". That
// text still counted as a present, sometimes even sufficiently long,
// description for completeness scoring and confidence badges, which is
// actively misleading: it looks like real content when it's actually a sign
// the scrape needs to be redone.
//
// This should be treated as equivalent to a missing description everywhere a
// description's presence is checked (scoring, completeness, confidence
// badges), and flagged distinctly so it can be routed for re-scraping instead
// of silently counted as "complete".
const CHALLENGE_TEXT_RE = /\bperforming security verification\b|\baccess (?:is |was )?denied\b|\bchecking your browser\b|\bverify you are (?:a )?human\b|\benable javascript and cookies\b|\bplease enable cookies\b|\bray id\b.{0,20}\bcloudflare\b/i

export function isChallengeDescription(value) {
  return CHALLENGE_TEXT_RE.test(String(value || ''))
}
