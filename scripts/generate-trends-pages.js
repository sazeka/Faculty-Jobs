#!/usr/bin/env node
/**
 * generate-trends-pages.js
 *
 * Turns the weekly hiring-trends data (generated/weekly-stats-history.json,
 * written by generate-weekly-trends.js) into indexable HTML: one page per
 * week at docs/trends/<weekEnd>/ plus an index at docs/trends/. Google never
 * sees docs/data/weekly-trends.json as content since it's pure JSON — this
 * gives the site a recurring source of fresh, unique, shareable pages instead.
 *
 * Weeks recorded before generate-weekly-trends.js started persisting
 * `aiSummary`/`topSources`/`topInstitutions` in history render with whatever
 * subset of that data they have (graceful degradation, not an error).
 *
 * The output dir is wiped and rebuilt each run. Writes a manifest
 * (generated/trends-pages.json) that generate-sitemap.js reads.
 *
 * Runs after generate-weekly-trends.js and before generate-sitemap.js.
 *
 * Usage: node scripts/generate-trends-pages.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = "https://www.facultyatlas.org";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function fmtWeek(weekEnd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(weekEnd || ""));
  if (!m) return weekEnd;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  if (Number.isNaN(d.getTime())) return weekEnd;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function topSourcesOf(entry) {
  if (Array.isArray(entry.topSources)) return entry.topSources;
  if (entry.bySource) {
    return Object.entries(entry.bySource)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([source, count]) => ({ source, count }));
  }
  return [];
}

function pageStyles() {
  return `
    :root { --bg:#f3f3f1; --paper:#fbfbfa; --ink:#1d2128; --ink2:#454b55; --ink3:#8a8f99; --accent:#2b3442; --rule:#e2e2df; --tag:#eceff4; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:var(--bg); color:var(--ink); font-family:'Newsreader',serif; font-size:17px; line-height:1.6; }
    a { color:inherit; }
    header { display:flex; align-items:center; justify-content:space-between; padding:18px 7vw; border-bottom:1px solid var(--rule); background:var(--paper); }
    .brand { display:flex; align-items:center; gap:12px; text-decoration:none; }
    .brand .wm { font-family:'Instrument Serif',serif; font-size:24px; color:var(--ink); }
    .nav a { font-family:'JetBrains Mono',monospace; font-size:13px; letter-spacing:0.08em; color:var(--ink2); text-transform:uppercase; text-decoration:none; margin-left:24px; }
    .wrap { max-width:820px; margin:0 auto; padding:32px 7vw 64px; }
    .crumbs { font-family:'JetBrains Mono',monospace; font-size:12px; letter-spacing:0.06em; color:var(--ink3); text-transform:uppercase; }
    .crumbs a { text-decoration:none; }
    .crumbs a:hover { color:var(--ink); }
    h1 { font-family:'Instrument Serif',serif; font-weight:400; font-size:clamp(30px,5vw,44px); line-height:1.1; letter-spacing:-0.5px; margin:16px 0 20px; }
    .stat-row { display:flex; gap:28px; flex-wrap:wrap; margin-bottom:28px; }
    .stat { background:var(--paper); border:1px solid var(--rule); border-radius:12px; padding:16px 20px; min-width:140px; }
    .stat .l { font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:var(--ink3); margin-bottom:4px; }
    .stat .v { font-family:'Instrument Serif',serif; font-size:28px; }
    .prose p { margin-bottom:15px; }
    h2 { font-family:'JetBrains Mono',monospace; font-size:12px; letter-spacing:0.16em; text-transform:uppercase; color:var(--ink3); margin:32px 0 12px; }
    table { width:100%; border-collapse:collapse; }
    table td { padding:8px 0; border-bottom:1px solid var(--rule); font-size:15px; }
    table td.n { text-align:right; font-family:'JetBrains Mono',monospace; color:var(--ink2); }
    ul.weeks { list-style:none; }
    ul.weeks li { border-bottom:1px solid var(--rule); padding:14px 0; display:flex; justify-content:space-between; align-items:baseline; }
    ul.weeks a { text-decoration:none; font-size:18px; }
    ul.weeks a:hover { text-decoration:underline; }
    ul.weeks .n { font-family:'JetBrains Mono',monospace; font-size:13px; color:var(--ink3); }
    .pager { display:flex; justify-content:space-between; margin-top:36px; font-family:'JetBrains Mono',monospace; font-size:13px; }
    .pager a { text-decoration:underline; }
    footer { border-top:1px solid var(--rule); padding:28px 7vw; font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--ink3); }
  `;
}

function pageShell({ title, metaDesc, pageUrl, ldBlocks, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/svg+xml" href="/assets/logos/favicon.svg" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(metaDesc)}" />
  <link rel="canonical" href="${pageUrl}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Faculty Atlas" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(metaDesc)}" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:image" content="${BASE_URL}/og-card.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(metaDesc)}" />
  <meta name="twitter:image" content="${BASE_URL}/og-card.png" />
  ${ldBlocks.map((ld) => `<script type="application/ld+json">${ld}</script>`).join("\n  ")}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>${pageStyles()}</style>
</head>
<body>
  <header>
    <a class="brand" href="/">
      <svg width="28" height="28" viewBox="0 0 64 64"><rect x="20" y="18" width="24" height="5" rx="2.5" fill="#1D2A2B"/><rect x="19" y="27" width="26" height="5" rx="2.5" fill="#355659"/><rect x="18" y="36" width="28" height="5" rx="2.5" fill="#0F766E"/><rect x="17" y="45" width="30" height="5" rx="2.5" fill="#C45C38"/><circle cx="32" cy="12" r="5" fill="#C45C38"/></svg>
      <span class="wm">Faculty Atlas</span>
    </a>
    <nav class="nav"><a href="/">All postings</a></nav>
  </header>
  <div class="wrap">
    ${bodyHtml}
  </div>
  <footer>Faculty Atlas · <a href="/" style="color:var(--ink2);">facultyatlas.org</a> — open faculty positions across North America, charted.</footer>
</body>
</html>
`.replace(/[ \t]+$/gm, "");
}

function renderIndexPage(history) {
  const pageUrl = `${BASE_URL}/trends/`;
  const title = "Weekly Faculty Hiring Trends | Faculty Atlas";
  const metaDesc = "Week-by-week faculty hiring trends: listing volume, most active systems and states, and position-type breakdowns.";
  const ordered = history.slice().reverse();
  const items = ordered
    .map((h, i) => {
      const prev = ordered[i + 1];
      const delta = prev ? h.totalJobs - prev.totalJobs : null;
      const deltaLabel = delta == null ? "" : ` (${delta >= 0 ? "+" : ""}${delta})`;
      const aiLabel = h.aiHiringBreakdown?.related == null
        ? ""
        : ` · ${h.aiHiringBreakdown.related.toLocaleString()} AI-related`;
      return `<li><a href="/trends/${esc(h.weekEnd)}/">Week of ${esc(fmtWeek(h.weekEnd))}</a><span class="n">${h.totalJobs.toLocaleString()} listings${deltaLabel}${aiLabel}</span></li>`;
    })
    .join("\n      ");

  const body = `
    <div class="crumbs"><a href="/">Home</a> / Trends</div>
    <h1>Weekly Faculty Hiring Trends</h1>
    <ul class="weeks">
      ${items}
    </ul>
  `;
  return pageShell({ title, metaDesc, pageUrl, ldBlocks: [], bodyHtml: body });
}

function renderWeekPage(entry, prevEntry, nextEntry) {
  const pageUrl = `${BASE_URL}/trends/${entry.weekEnd}/`;
  const weekLabel = fmtWeek(entry.weekEnd);
  const title = `Faculty Hiring Trends — Week of ${weekLabel} | Faculty Atlas`;
  const summary = entry.aiSummary || null;
  const metaDesc = (summary || `${entry.totalJobs.toLocaleString()} open faculty listings tracked for the week of ${weekLabel}.`).slice(0, 155);

  const delta = prevEntry ? entry.totalJobs - prevEntry.totalJobs : null;
  const deltaHtml = delta == null ? "" : `
        <div class="stat">
          <div class="l">Vs prior week</div>
          <div class="v">${delta >= 0 ? "+" : ""}${delta}</div>
        </div>`;

  const topType = entry.byType
    ? Object.entries(entry.byType).sort((a, b) => b[1] - a[1])[0]
    : null;

  const prose = summary
    ? `<div class="prose">${summary.split(/\n{2,}/).map((p) => `<p>${esc(p.trim())}</p>`).join("\n        ")}</div>`
    : "";

  const sources = topSourcesOf(entry);
  const sourcesHtml = sources.length
    ? `<h2>Most active systems</h2>
    <table>
      ${sources.map(({ source, count }) => `<tr><td>${esc(source)}</td><td class="n">${count.toLocaleString()}</td></tr>`).join("\n      ")}
    </table>`
    : "";

  const institutions = Array.isArray(entry.topInstitutions) ? entry.topInstitutions : [];
  const institutionsHtml = institutions.length
    ? `<h2>Most active institutions</h2>
    <table>
      ${institutions.map(({ institution, count }) => `<tr><td>${esc(institution)}</td><td class="n">${count.toLocaleString()}</td></tr>`).join("\n      ")}
    </table>`
    : "";

  const typesHtml = entry.byType
    ? `<h2>Position types</h2>
    <table>
      ${Object.entries(entry.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => `<tr><td>${esc(type)}</td><td class="n">${count.toLocaleString()}</td></tr>`).join("\n      ")}
    </table>`
    : "";

  const tenure = entry.tenureTrackBreakdown;
  const tenureHtml = tenure
    ? `<h2>Appointment track</h2>
    <table>
      <tr><td>Tenure-track</td><td class="n">${tenure.tenureTrack.toLocaleString()} · ${tenure.tenureTrackPct}% of classified</td></tr>
      <tr><td>Non-tenure-track</td><td class="n">${tenure.nonTenureTrack.toLocaleString()} · ${tenure.nonTenureTrackPct}% of classified</td></tr>
      <tr><td>Unclassified</td><td class="n">${tenure.unknown.toLocaleString()}</td></tr>
    </table>`
    : "";

  const ai = entry.aiHiringBreakdown;
  const aiHtml = ai
    ? `<h2>AI hiring pulse</h2>
    <table>
      <tr><td>Explicitly AI-related openings</td><td class="n">${ai.related.toLocaleString()}</td></tr>
      <tr><td>Share of all listings</td><td class="n">${ai.sharePct}%</td></tr>
${ai.delta == null ? "" : `      <tr><td>Vs prior week</td><td class="n">${ai.delta >= 0 ? "+" : ""}${ai.delta.toLocaleString()}</td></tr>\n`}
    </table>
    <p class="small">Strict classifier v${ai.classifierVersion} counts explicit references to artificial intelligence and core methods including machine learning, generative AI, natural language processing, computer vision, and neural networks. Broad data-science and robotics listings are excluded unless an AI signal is present.</p>`
    : "";

  const pagerHtml = `
    <div class="pager">
      <span>${prevEntry ? `<a href="/trends/${prevEntry.weekEnd}/">← Week of ${esc(fmtWeek(prevEntry.weekEnd))}</a>` : ""}</span>
      <a href="/trends/">All weeks</a>
      <span>${nextEntry ? `<a href="/trends/${nextEntry.weekEnd}/">Week of ${esc(fmtWeek(nextEntry.weekEnd))} →</a>` : ""}</span>
    </div>`;

  const body = `
    <div class="crumbs"><a href="/">Home</a> / <a href="/trends/">Trends</a> / Week of ${esc(weekLabel)}</div>
    <h1>Faculty Hiring Trends — Week of ${esc(weekLabel)}</h1>
    <div class="stat-row">
      <div class="stat"><div class="l">Open listings</div><div class="v">${entry.totalJobs.toLocaleString()}</div></div>
${deltaHtml}${topType ? `      <div class="stat"><div class="l">Top position type</div><div class="v" style="font-size:18px;">${esc(topType[0])}</div></div>\n` : ""}${ai ? `      <div class="stat"><div class="l">AI-related openings</div><div class="v">${ai.related.toLocaleString()}</div></div>\n` : ""}
    </div>
    ${prose}
    ${sourcesHtml}
    ${institutionsHtml}${aiHtml ? `\n    ${aiHtml}` : ""}${tenureHtml ? `\n    ${tenureHtml}` : ""}
    ${typesHtml}
    ${pagerHtml}
  `;

  const articleLd = JSON.stringify({
    "@context": "https://schema.org/",
    "@type": "Article",
    headline: title,
    datePublished: `${entry.weekEnd}T00:00:00Z`,
    author: { "@type": "Organization", name: "Faculty Atlas" },
    publisher: { "@type": "Organization", name: "Faculty Atlas" },
    url: pageUrl,
    articleBody: summary || metaDesc,
  });

  return pageShell({ title, metaDesc, pageUrl, ldBlocks: [articleLd], bodyHtml: body });
}

// ── Main ──────────────────────────────────────────────────────────────────────

const history = readJson(path.join(ROOT, "generated", "weekly-stats-history.json")) || [];

const outDir = path.join(ROOT, "docs", "trends");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const manifest = [];
const today = new Date().toISOString().slice(0, 10);

if (history.length) {
  fs.writeFileSync(path.join(outDir, "index.html"), renderIndexPage(history), "utf8");
  manifest.push({ loc: `${BASE_URL}/trends/`, lastmod: history[history.length - 1].weekEnd || today });

  history.forEach((entry, i) => {
    const weekDir = path.join(outDir, entry.weekEnd);
    fs.mkdirSync(weekDir, { recursive: true });
    fs.writeFileSync(
      path.join(weekDir, "index.html"),
      renderWeekPage(entry, history[i - 1], history[i + 1]),
      "utf8"
    );
    manifest.push({ loc: `${BASE_URL}/trends/${entry.weekEnd}/`, lastmod: entry.weekEnd });
  });
}

fs.mkdirSync(path.join(ROOT, "generated"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "generated", "trends-pages.json"), JSON.stringify(manifest, null, 0) + "\n", "utf8");

console.log(`generate-trends-pages: ${history.length} week pages + index (${manifest.length} URLs total)`);
