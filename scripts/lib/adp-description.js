const ADP_HOST = /^workforcenow(?:\.cloud)?\.adp\.com$/i;
const CID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const CC_ID = /^[a-z\d_]+$/i;
const JOB_ID = /^[a-z\d_]+$/i;

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return String(value || "")
    .replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

export function adpHtmlToText(html, maxLen = 6000) {
  const text = String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<link\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|tr)>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export function parseAdpJobUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !ADP_HOST.test(url.hostname)) return null;

  const cid = url.searchParams.get("cid") || "";
  const ccId = url.searchParams.get("ccId") || "";
  const jobId = url.searchParams.get("jobId") || "";
  const lang = url.searchParams.get("lang") || "en_US";
  if (!CID.test(cid) || !CC_ID.test(ccId) || !JOB_ID.test(jobId) || !/^[a-z_]+$/i.test(lang)) return null;

  const endpoint = new URL(
    `/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions/${encodeURIComponent(jobId)}`,
    url.origin,
  );
  endpoint.searchParams.set("cid", cid);
  endpoint.searchParams.set("ccId", ccId);
  endpoint.searchParams.set("lang", lang);
  endpoint.searchParams.set("locale", lang);
  return { cid, ccId, jobId, lang, endpoint: endpoint.href };
}

export function extractAdpPosting(payload, { minLen = 200, maxLen = 6000 } = {}) {
  const text = adpHtmlToText(payload?.requisitionDescription, maxLen);
  return {
    desc: text.length >= minLen ? text : "",
    datePosted: String(payload?.postDate || ""),
    validThrough: "",
  };
}

export async function fetchAdpPosting(
  input,
  { fetchImpl = globalThis.fetch, timeoutMs = 30000, minLen = 200, maxLen = 6000 } = {},
) {
  const parsed = parseAdpJobUrl(input);
  if (!parsed) throw new Error(`Unsupported ADP job URL: ${input}`);
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation available");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(parsed.endpoint, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ADP detail endpoint returned HTTP ${response.status}`);
    return { endpoint: parsed.endpoint, ...extractAdpPosting(await response.json(), { minLen, maxLen }) };
  } finally {
    clearTimeout(timer);
  }
}
