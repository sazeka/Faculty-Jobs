import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeUrl,
  inferPlatformFromUrl,
  normalizeNameKey,
  clean,
  isPeopleAdminBookmarkUrl,
  hasDuplicateWorkdayJobSegments,
} from "../lib/url-normalization.js";

test("canonicalizeUrl upgrades to https and strips hash", () => {
  assert.equal(canonicalizeUrl("http://example.com/jobs#top"), "https://example.com/jobs");
});

test("canonicalizeUrl preserves a job-identifying hash fragment", () => {
  // PeopleSoft/HRS scrapers (e.g. UMN) fabricate per-job URLs by appending
  // "#<jobId>" to a shared search-page URL, since the ATS exposes no real
  // per-job link. Stripping the hash collapses every posting from that
  // school onto one URL, so the dedup pass in scrape-to-json.js silently
  // discards all but one — only common navigation anchors get stripped.
  const base = "https://hr.myu.umn.edu/psc/hrprd/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL";
  assert.equal(canonicalizeUrl(`${base}#374515`), `${base}#374515`);
  assert.equal(canonicalizeUrl(`${base}#375089`), `${base}#375089`);
  assert.notEqual(canonicalizeUrl(`${base}#374515`), canonicalizeUrl(`${base}#375089`));
  assert.equal(
    canonicalizeUrl("https://example.com/search#Associate%20Professor%20of%20Biology"),
    "https://example.com/search#Associate%20Professor%20of%20Biology"
  );
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

test("canonicalizeUrl strips a session-scoped jsessionid matrix param", () => {
  // interviewexchange.com (a JSP-based ATS) and similar Java servlet containers
  // can surface a career_url captured mid-session, with a ";jsessionid=..."
  // segment baked into the path. That token expires within minutes, so saving
  // it verbatim caused a real discover -> verify -> quarantine -> rediscover
  // loop for several schools (Bristol CC, Cape Cod CC, Emmanuel College, ...).
  assert.equal(
    canonicalizeUrl("https://bristolcc.interviewexchange.com/static/clients/460BCM1/index.jsp;jsessionid=3C23F471BF242A30472AA845F1FFDA86"),
    "https://bristolcc.interviewexchange.com/static/clients/460BCM1/index.jsp"
  );
  // Cape Cod's real saved override had two stacked jsessionid segments from
  // successive re-discovery attempts -- both must go.
  assert.equal(
    canonicalizeUrl(
      "https://capecod.interviewexchange.com/static/clients/470CCM1/index.jsp;jsessionid=D7B817EED47381B2C5A08E3F538D4EB5;jsessionid=2E2FB86EF203E255B5590EC9F09035DF"
    ),
    "https://capecod.interviewexchange.com/static/clients/470CCM1/index.jsp"
  );
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
  assert.equal(inferPlatformFromUrl("https://workforcenow.adp.com/mascsr/jobs"), "adp");
  assert.equal(inferPlatformFromUrl("https://x.interfolio.com/y"), "interfolio");
  assert.equal(inferPlatformFromUrl(""), null);
});

test("normalizeNameKey and clean normalize whitespace/case", () => {
  assert.equal(normalizeNameKey("  Big   State  University "), "big state university");
  assert.equal(clean("  a\t b\n"), "a b");
});

// Issue #139: PeopleAdmin's "/bookmarks?posting_id=N" is a session-dependent
// account action (renders a "session expired, please log in" page for a
// logged-out visitor), not a stable job-detail page. It must be recognized by
// shape (works across every PeopleAdmin tenant) and rewritten to that
// tenant's stable "/postings/{id}" path.
test("isPeopleAdminBookmarkUrl recognizes the bookmark action shape across tenants", () => {
  assert.equal(isPeopleAdminBookmarkUrl("https://careers.centralstate.edu/bookmarks?posting_id=8417"), true);
  assert.equal(isPeopleAdminBookmarkUrl("https://jobs.wssu.edu/bookmarks?posting_id=33393"), true);
  assert.equal(isPeopleAdminBookmarkUrl("https://careers.centralstate.edu/postings/8417"), false);
  assert.equal(isPeopleAdminBookmarkUrl("https://careers.centralstate.edu/bookmarks"), false);
  assert.equal(isPeopleAdminBookmarkUrl("https://careers.centralstate.edu/bookmarks?posting_id=abc"), false);
  assert.equal(isPeopleAdminBookmarkUrl("not a url"), false);
});

test("canonicalizeUrl rewrites a PeopleAdmin bookmark action to the tenant's stable /postings/{id} path (issue #139)", () => {
  assert.equal(
    canonicalizeUrl("https://careers.centralstate.edu/bookmarks?posting_id=8417"),
    "https://careers.centralstate.edu/postings/8417"
  );
  // A bookmark URL for a posting that was also scraped directly must
  // canonicalize to the exact same URL, so the existing duplicate-URL collapse
  // removes the extra bookmark copy automatically.
  assert.equal(
    canonicalizeUrl("https://jobs.wssu.edu/bookmarks?posting_id=33393"),
    canonicalizeUrl("https://jobs.wssu.edu/postings/33393")
  );
});

// Issue #144: some Workday tenants' search-API responses produced a stored
// URL with two "/job/" path segments -- a stale seed posting immediately
// followed by the real one. Workday 200s on this and renders a "Sign In" /
// "There are 1 error(s)" page instead of the intended posting. The final
// "/job/{...}" segment always identifies the intended posting.
test("hasDuplicateWorkdayJobSegments detects the doubled-segment shape", () => {
  assert.equal(
    hasDuplicateWorkdayJobSegments(
      "https://wd5.myworkdaysite.com/recruiting/coloradomtn/ColoradoMountainCollege/job/Leadville-CO/Adjunct-Faculty--Outdoor-Recreational-Leadership--DMM-Certified-WFR-Instructor-_JR100940/job/Colorado-Mountain-College-Online/Adjunct-Faculty--Accounting_JR101035-1"
    ),
    true
  );
  assert.equal(
    hasDuplicateWorkdayJobSegments("https://wd5.myworkdaysite.com/recruiting/coloradomtn/ColoradoMountainCollege/job/Colorado-Mountain-College-Online/Adjunct-Faculty--Accounting_JR101035-1"),
    false
  );
});

test("canonicalizeUrl collapses doubled Workday /job/ segments to the final job path (issue #144)", () => {
  assert.equal(
    canonicalizeUrl(
      "https://wd5.myworkdaysite.com/recruiting/coloradomtn/ColoradoMountainCollege/job/Leadville-CO/Adjunct-Faculty--Outdoor-Recreational-Leadership--DMM-Certified-WFR-Instructor-_JR100940/job/Colorado-Mountain-College-Online/Adjunct-Faculty--Accounting_JR101035-1"
    ),
    "https://wd5.myworkdaysite.com/recruiting/coloradomtn/ColoradoMountainCollege/job/Colorado-Mountain-College-Online/Adjunct-Faculty--Accounting_JR101035-1"
  );
  assert.equal(
    canonicalizeUrl(
      "https://uni.wd5.myworkdayjobs.com/uni/job/main-campus/assistant-adjunct-professor---counseling--remote-eligible-within-iowa-_jr1311/job/Main-Campus/Assistant-Professor-of-Instruction----Applied-Ethics_JR1260"
    ),
    "https://uni.wd5.myworkdayjobs.com/uni/job/Main-Campus/Assistant-Professor-of-Instruction----Applied-Ethics_JR1260"
  );
});
