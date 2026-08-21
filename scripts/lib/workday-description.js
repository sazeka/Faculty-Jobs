const WORKDAY_JOBS_HOST = /^([^.]+)\.wd\d+\.myworkdayjobs\.com$/i;
const WORKDAY_SITE_HOST = /^wd\d+\.myworkdaysite\.com$/i;

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

export function workdayHtmlToText(html, maxLen = 6000) {
  const text = String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|tr)>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export function buildWorkdayCxsUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const jobsHost = WORKDAY_JOBS_HOST.exec(hostname);
  const siteHost = WORKDAY_SITE_HOST.test(hostname);
  if (!jobsHost && !siteHost) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  let tenant;
  let site;
  let jobIndex = -1;

  // Use the final /job/ segment. A small set of legacy Colorado Mountain
  // College links accidentally contains one complete job URL followed by the
  // real /job/... suffix; the final segment identifies the intended posting.
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].toLowerCase() === "job") {
      jobIndex = i;
      break;
    }
  }
  // Most links have /job/{location}/{posting}, but several tenants (including
  // Columbus State and Abilene Christian) publish /job/{posting} directly.
  if (jobIndex < 0 || jobIndex + 1 >= segments.length) return null;

  if (jobsHost) {
    tenant = jobsHost[1];
    const prefix = segments.slice(0, jobIndex);
    if (/^[a-z]{2}-[a-z]{2}$/i.test(prefix[0] || "")) prefix.shift();
    // Barry uses /BarryU/jobs/job/... while other tenants legitimately name
    // their career site "Jobs". Only discard the extra segment when a real
    // site identifier precedes it.
    if (prefix.length > 1 && prefix.at(-1).toLowerCase() === "jobs") prefix.pop();
    site = prefix.at(-1);
  } else {
    const recruitingIndex = segments.findIndex((segment) => segment.toLowerCase() === "recruiting");
    if (recruitingIndex < 0 || recruitingIndex + 2 >= segments.length) return null;
    tenant = segments[recruitingIndex + 1];
    site = segments[recruitingIndex + 2];
  }

  if (!tenant || !site) return null;
  const jobPath = segments.slice(jobIndex + 1);
  return `${url.origin}/wday/cxs/${tenant}/${site}/job/${jobPath.join("/")}`;
}

export function extractWorkdayPosting(payload, { minLen = 200, maxLen = 6000 } = {}) {
  const info = payload?.jobPostingInfo;
  if (!info || typeof info !== "object") {
    return { desc: "", datePosted: "", validThrough: "" };
  }
  const text = workdayHtmlToText(info.jobDescription, maxLen);
  return {
    desc: text.length >= minLen ? text : "",
    // Workday calls the public posting window startDate/endDate. These are the
    // posting date and application deadline, not the appointment start date.
    datePosted: String(info.startDate || ""),
    validThrough: String(info.endDate || ""),
  };
}

export async function fetchWorkdayPosting(
  input,
  { fetchImpl = globalThis.fetch, timeoutMs = 30000, minLen = 200, maxLen = 6000 } = {},
) {
  const endpoint = buildWorkdayCxsUrl(input);
  if (!endpoint) throw new Error(`Unsupported Workday job URL: ${input}`);
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation available");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Workday detail endpoint returned HTTP ${response.status}`);
    const payload = await response.json();
    return { endpoint, ...extractWorkdayPosting(payload, { minLen, maxLen }) };
  } finally {
    clearTimeout(timer);
  }
}
