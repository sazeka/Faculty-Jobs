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
