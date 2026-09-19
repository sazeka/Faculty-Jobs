export function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const TRACKING_QUERY_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
]);

// Same-page scroll anchors we actually want stripped as noise. Several PeopleSoft/HRS
// scrapers (server.js, e.g. the UMN scraper) fabricate a per-job "virtual URL" by
// appending "#<jobId-or-title>" to a shared search-page URL, because the ATS never
// exposes real per-job links — that fragment is the ONLY thing distinguishing one
// posting from another, so blanket-stripping every hash collapsed all of a school's
// listings onto one canonical URL and silently deduped away every job but one.
const BENIGN_HASH_FRAGMENTS = new Set([
  "top", "main", "content", "main-content", "header", "footer", "nav", "navigation", "skip", "skip-to-content", "body",
]);

// PeopleAdmin's "/bookmarks?posting_id=N" is a session-dependent account
// action (save-this-posting-to-my-account), not a stable job-detail page --
// every one of these renders a "session expired, please log in" page for a
// logged-out visitor. Detect it by shape (path + query param) rather than by
// hostname allowlist, since it's the same PeopleAdmin platform feature across
// every tenant that uses it (see issue #139).
export function isPeopleAdminBookmarkUrl(input) {
  let parsed;
  try {
    parsed = new URL(String(input || ""));
  } catch {
    return false;
  }
  if (!/\/bookmarks\/?$/i.test(parsed.pathname)) return false;
  return /^\d+$/.test(parsed.searchParams.get("posting_id") || "");
}

// Rewrites a PeopleAdmin bookmark action URL to that tenant's stable
// "/postings/{id}" job-detail path (same origin), so it can never be treated
// as a distinct, permanent job page. If a genuine "/postings/{id}" copy of
// the same job was also scraped, they now canonicalize to the identical URL
// and the existing duplicate-URL collapse in canonicalizeJobUrls() (which
// keeps the first-seen record) removes the extra copy automatically. If no
// such copy exists, this still turns a session-dependent action link into the
// tenant's normal, stable posting URL shape instead of a login page.
function resolvePeopleAdminBookmarkUrl(parsed) {
  if (!isPeopleAdminBookmarkUrl(parsed.toString())) return parsed;
  const postingId = parsed.searchParams.get("posting_id");
  const rewritten = new URL(parsed.toString());
  rewritten.pathname = parsed.pathname.replace(/\/bookmarks\/?$/i, `/postings/${postingId}`);
  rewritten.search = "";
  rewritten.hash = "";
  return rewritten;
}

// Some Workday tenants' search-API responses have produced a stored URL with
// two "/job/" path segments -- a stale seed posting's "/job/{location}/{id}"
// immediately followed by the real one, e.g.
// ".../job/Leadville-CO/Adjunct-Faculty..._JR100940/job/Colorado-Mountain-College-Online/Adjunct-Faculty--Accounting_JR101035-1".
// Workday's client-side router 200s on this and renders a "Sign In" / "There
// are 1 error(s)" page instead of the intended posting (issue #144). The
// final "/job/{...}" segment always identifies the intended posting; collapse
// everything between the site root and that final segment.
function collapseDuplicateWorkdayJobSegments(parsed) {
  const host = parsed.hostname.toLowerCase();
  if (!/myworkdayjobs\.com$|myworkdaysite\.com$/i.test(host)) return parsed;
  const path = parsed.pathname;
  const firstJob = path.toLowerCase().indexOf("/job/");
  const lastJob = path.toLowerCase().lastIndexOf("/job/");
  if (firstJob === -1 || firstJob === lastJob) return parsed;
  const rewritten = new URL(parsed.toString());
  rewritten.pathname = `${path.slice(0, firstJob)}${path.slice(lastJob)}`;
  return rewritten;
}

// True when a Workday URL still carries more than one "/job/" path segment
// (see collapseDuplicateWorkdayJobSegments above) -- exported as a standalone
// invariant check for tests and data audits.
export function hasDuplicateWorkdayJobSegments(input) {
  let parsed;
  try {
    parsed = new URL(String(input || ""));
  } catch {
    return false;
  }
  const matches = parsed.pathname.match(/\/job\//gi) || [];
  return matches.length > 1;
}

export function canonicalizeUrl(input, { stripQuery = true } = {}) {
  const raw = clean(input);
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    // Try assuming https for bare host/path values.
    try {
      parsed = new URL(`https://${raw.replace(/^\/+/, "")}`);
    } catch {
      return null;
    }
  }

  if (!/^https?:$/i.test(parsed.protocol)) return null;

  parsed.protocol = "https:";
  parsed = resolvePeopleAdminBookmarkUrl(parsed);
  parsed = collapseDuplicateWorkdayJobSegments(parsed);
  const fragment = parsed.hash.replace(/^#/, "").toLowerCase();
  if (!fragment || BENIGN_HASH_FRAGMENTS.has(fragment)) {
    parsed.hash = "";
  }

  if (stripQuery) {
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    if (![...parsed.searchParams.keys()].length) {
      parsed.search = "";
    }
  }

  // Java servlet containers (interviewexchange.com and other JSP-based ATS pages)
  // sometimes surface a session-scoped ";jsessionid=..." matrix parameter baked
  // into the path -- typically captured verbatim by whatever browsed the page
  // mid-session (a discovery agent, a manual check). That token expires within
  // minutes, so saving it as a career_url guarantees the link goes stale again
  // shortly after -- this was the actual cause of a repeated discover -> verify
  // -> quarantine -> null-out -> rediscover loop seen in institutions-master
  // notes for several interviewexchange.com schools (Bristol Community College,
  // Cape Cod Community College, Emmanuel College, and others). Global flag
  // handles Cape Cod's case, which had two stacked jsessionid segments from
  // successive re-discovery attempts. Strip it so only the stable, session-free
  // path survives.
  parsed.pathname = parsed.pathname.replace(/;jsessionid=[^;/?#]*/gi, "");

  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}

export function inferPlatformFromUrl(url) {
  const u = String(url || "").toLowerCase();
  if (!u) return null;
  if (u.includes("myworkdayjobs.com") || u.includes("myworkdaysite.com")) return "workday";
  if (u.includes("pageuppeople.com")) return "pageup";
  if (u.includes("taleo.net")) return "taleo";
  if (u.includes("peopleadmin.com")) return "peopleadmin";
  if (u.includes("schooljobs.com")) return "schooljobs";
  if (u.includes("csod.com")) return "csod";
  if (u.includes("paycomonline.net")) return "paycom";
  if (u.includes("workforcenow.adp.com") || u.includes("workforcenow.cloud.adp.com")) return "adp";
  if (u.includes("interviewexchange.com")) return "interviewexchange";
  if (u.includes("jobvite.com")) return "jobvite";
  if (u.includes("interfolio.com")) return "interfolio";
  if (u.includes("aprecruit") || u.includes("apol-recruit") || u.includes("recruit.ap.")) return "ap-recruit";
  if (u.includes("/en-us/filter")) return "enusfilter";
  return "generic";
}

export function normalizeNameKey(name) {
  return clean(name).toLowerCase();
}
