const PAYCOM_HOST = /(^|\.)paycomonline\.net$/i;
const PORTAL_ID = /^[a-f\d]{32}$/i;
const JOB_ID = /^\d+$/;

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return String(value || "")
    .replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

export function paycomHtmlToText(html, maxLen = 6000) {
  const text = String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|tr)>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export function parsePaycomJobUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !PAYCOM_HOST.test(url.hostname)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const portalIndex = segments.findIndex((segment) => segment.toLowerCase() === "portal");
  if (
    portalIndex < 0 ||
    segments[portalIndex + 2]?.toLowerCase() !== "jobs" ||
    !PORTAL_ID.test(segments[portalIndex + 1] || "") ||
    !JOB_ID.test(segments[portalIndex + 3] || "")
  ) return null;

  return {
    jobId: segments[portalIndex + 3],
    portalId: segments[portalIndex + 1],
    referrer: url.href,
  };
}

// configsFromHost is an inline JSON object containing a nested, JSON-encoded
// libConfig string. Parse a balanced object instead of using a regex, which
// would stop at the first brace inside that nested string.
export function extractPaycomHostConfig(html) {
  const source = String(html || "");
  const marker = source.indexOf("configsFromHost");
  if (marker < 0) return null;
  const start = source.indexOf("{", marker);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try {
        return JSON.parse(source.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function getPaycomServiceUrl(config) {
  let libConfig = config?.libConfig;
  if (typeof libConfig === "string") {
    try { libConfig = JSON.parse(libConfig); } catch { return null; }
  }
  let serviceUrl;
  try {
    serviceUrl = new URL(libConfig?.atsPortalMantleServiceUrl);
  } catch {
    return null;
  }
  // The landing page controls this value. Constrain it to Paycom HTTPS hosts
  // before sending the page-provided session token anywhere.
  if (serviceUrl.protocol !== "https:" || !PAYCOM_HOST.test(serviceUrl.hostname)) return null;
  return serviceUrl;
}

export function extractPaycomPosting(payload, { minLen = 200, maxLen = 6000 } = {}) {
  const posting = payload?.jobPosting;
  const text = paycomHtmlToText(posting?.description, maxLen);
  return {
    desc: text.length >= minLen ? text : "",
    datePosted: "",
    validThrough: "",
  };
}

export async function fetchPaycomPosting(
  input,
  { fetchImpl = globalThis.fetch, timeoutMs = 30000, minLen = 200, maxLen = 6000 } = {},
) {
  const parsed = parsePaycomJobUrl(input);
  if (!parsed) throw new Error(`Unsupported Paycom job URL: ${input}`);
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation available");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const landing = await fetchImpl(parsed.referrer, {
      headers: { accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
    if (!landing.ok) throw new Error(`Paycom landing page returned HTTP ${landing.status}`);
    const config = extractPaycomHostConfig(await landing.text());
    const serviceUrl = getPaycomServiceUrl(config);
    if (!config?.sessionJWT || !serviceUrl) throw new Error("Paycom landing page omitted its public API configuration");

    const endpoint = new URL(`api/ats/job-postings/${parsed.jobId}`, serviceUrl).href;
    const response = await fetchImpl(endpoint, {
      headers: {
        accept: "application/json, text/plain, */*",
        authorization: String(config.sessionJWT),
        locale: "en-US",
        "portal-host-referrer": parsed.referrer,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Paycom detail endpoint returned HTTP ${response.status}`);
    return { endpoint, ...extractPaycomPosting(await response.json(), { minLen, maxLen }) };
  } finally {
    clearTimeout(timer);
  }
}
