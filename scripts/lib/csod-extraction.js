/**
 * Extract CSOD job links from the current document.
 *
 * Optional arguments let tests exercise the same callback that Playwright
 * serializes for page.evaluate(). Keep this function self-contained.
 */
export function extractCsodJobsFromDocument(doc = document, baseHref = doc.baseURI || location.href) {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const abs = (href) => {
    try {
      return new URL(href, baseHref).toString();
    } catch {
      return null;
    }
  };

  const out = [];
  const seen = new Set();

  const extractDept = (container) => {
    const txt = clean(container?.innerText || "");
    const m =
      txt.match(/\b(?:Department|College|School|Division|Program|Unit)\s*:?\s*([^\n•|]{3,90})/i) ||
      txt.match(/\b(?:Academic\s+Unit)\s*:?\s*([^\n•|]{3,90})/i);
    return m ? clean(m[1]) : null;
  };

  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const rawHref = a.getAttribute("href") || "";
    // Classic ASP.NET WebForms CSOD tenants put the real detail path inside a
    // javascript:WebForm_DoPostBackWithOptions(...) href. Resolving that href
    // directly produces an inert javascript: URL, so extract its quoted path.
    const postbackMatch = rawHref.match(/"(JobDetails\.aspx\?[^"]*)"/i);
    const url = postbackMatch ? abs(postbackMatch[1]) : abs(rawHref);
    const title = clean(a.textContent);
    if (!url || !title || title.length < 4) continue;

    const ok =
      /\/job\//i.test(url) ||
      /ats\/job/i.test(url) ||
      (/career/i.test(url) && /job/i.test(url)) ||
      /\/requisition\/\d+/i.test(url) ||
      (/ux\/ats\/careersite/i.test(url) && /requisition/i.test(url)) ||
      /jobdetails\.aspx/i.test(url);
    if (!ok || seen.has(url)) continue;

    seen.add(url);
    const container = a.closest("li, article, tr, div") || a.parentElement;
    out.push({ title, url, dept: extractDept(container) });
  }

  return out;
}
