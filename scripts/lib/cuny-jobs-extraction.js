export function extractCunyJobRows(anchors, baseUrl = "https://cuny.jobs/") {
  const seen = new Set();
  const rows = [];

  for (const anchor of Array.isArray(anchors) ? anchors : []) {
    const title = String(anchor?.title || "").replace(/\s+/g, " ").trim();
    let url;
    try {
      url = new URL(String(anchor?.href || ""), baseUrl).toString();
    } catch {
      continue;
    }

    if (
      !title ||
      /^Non-Teaching Adjunct\b/i.test(title) ||
      !/\/job\/?(?:[?#]|$)/i.test(new URL(url).pathname) ||
      seen.has(url)
    ) continue;
    seen.add(url);
    rows.push({
      title,
      url,
      location: String(anchor?.location || "").replace(/\s+/g, " ").trim() || null,
      department: null,
    });
  }

  return rows;
}
