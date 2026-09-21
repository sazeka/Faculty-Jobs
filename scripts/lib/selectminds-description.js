const SELECTMINDS_HOST_RE = /(?:^|\.)selectminds\.com$|^applyjobs\.utmb\.edu$/i;

export function isSelectMindsJobUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return SELECTMINDS_HOST_RE.test(url.hostname) && /\/jobs\//.test(url.pathname);
  } catch {
    return false;
  }
}

function decodeHtml(text) {
  const named = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
    ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  };
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => named[name.toLowerCase()] ?? all);
}

export function extractSelectMindsDescription(html, { maxLen = 12000 } = {}) {
  const match = String(html || "").match(/<div\b[^>]*class=["'][^"']*\bjob_description\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!match) return "";
  return decodeHtml(
    match[1]
      .replace(/<(?:br|\/p|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLen);
}

export async function fetchSelectMindsPosting(rawUrl, { timeoutMs = 30000, minLen = 80, maxLen = 12000 } = {}) {
  if (!isSelectMindsJobUrl(rawUrl)) throw new Error("Not a supported SelectMinds job URL");
  const response = await fetch(rawUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) throw new Error(`SelectMinds request failed: ${response.status}`);
  const desc = extractSelectMindsDescription(await response.text(), { maxLen });
  if (desc.length < minLen) throw new Error("SelectMinds posting description was empty or too short");
  return { desc, datePosted: "", validThrough: "" };
}
