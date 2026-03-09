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
  parsed.hash = "";

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
