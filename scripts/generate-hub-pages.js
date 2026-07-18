#!/usr/bin/env node
/**
 * generate-hub-pages.js
 *
 * Static-site-generates category "hub" pages under docs/disciplines/<slug>/,
 * docs/states/<slug>/, and docs/institutions/<slug>/. Each page lists the
 * matching open postings (linking to their existing /jobs/<slug>/ pages),
 * carries ItemList + BreadcrumbList JSON-LD, and gives crawlers long-tail
 * landing pages and internal links that individual job pages can't provide.
 *
 * Discipline/state/institution grouping reuses the same classification logic
 * the Vue frontend uses for filtering (useJobFilters.js), not the raw
 * `discipline` field (which has ~2,000 distinct values and is useless as a
 * category taxonomy).
 *
 * The output dirs are wiped and rebuilt each run. Writes a manifest
 * (generated/hub-pages.json) that generate-sitemap.js reads.
 *
 * Runs after generate-job-pages.js (needs job slugs to link to) and before
 * generate-sitemap.js.
 *
 * Usage: node scripts/generate-hub-pages.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jobSlug, kebab } from "./lib/job-slug.js";
import { buildInstitutionIndex, lookupInstitution } from "./lib/institution-lookup.js";
import { MIN_STATE_JOBS, MIN_INSTITUTION_JOBS, DISCIPLINE_SKIP } from "./lib/hub-thresholds.js";
import { getDiscipline, inferState, normalizeSystemCollege } from "../web-vue/src/composables/useJobFilters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = "https://www.facultyatlas.org";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Same thin-content / non-job filter as generate-job-pages.js — a hub page
// should only ever link to a job that actually has its own indexable page.
const MIN_DESC = 120;
const NON_JOB_TITLE = /\b(named to|named as|appointed|welcome from|in memoriam|obituary|passes away|remembering|announces|announcement|receives|honored|wins|elected|inducted)\b/i;
function isRealPosting(j) {
  if (!j || !j.title || !j.url) return false;
  if (String(j.description || "").length < MIN_DESC) return false;
  if (NON_JOB_TITLE.test(j.title)) return false;
  const unclassified = (j.discipline == null) && (!j.positionType || j.positionType === "Other");
  return !unclassified;
}

const TODAY_ISO = new Date().toISOString().slice(0, 10);
function isOpen(j) {
  if (!j.closeDate || j.openUntilFilled) return true;
  return String(j.closeDate) >= TODAY_ISO;
}

function fmtDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

const SECTIONS = {
  discipline: { dir: "disciplines", typeLabel: "Discipline" },
  state: { dir: "states", typeLabel: "State" },
  institution: { dir: "institutions", typeLabel: "Institution" },
};

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
    .wrap { max-width:900px; margin:0 auto; padding:32px 7vw 64px; }
    .crumbs { font-family:'JetBrains Mono',monospace; font-size:12px; letter-spacing:0.06em; color:var(--ink3); text-transform:uppercase; }
    .crumbs a { text-decoration:none; }
    .crumbs a:hover { color:var(--ink); }
    h1 { font-family:'Instrument Serif',serif; font-weight:400; font-size:clamp(30px,5vw,46px); line-height:1.1; letter-spacing:-0.5px; margin:16px 0 8px; }
    .sub { font-size:16px; color:var(--ink2); margin-bottom:28px; }
    .sub a { color:var(--accent); text-decoration:underline; }
    ul.jobs { list-style:none; }
    ul.jobs li { border-bottom:1px solid var(--rule); padding:16px 0; }
    ul.jobs li:first-child { border-top:1px solid var(--rule); }
    ul.jobs a.title { font-family:'Instrument Serif',serif; font-size:21px; text-decoration:none; }
    ul.jobs a.title:hover { text-decoration:underline; }
    ul.jobs .meta { font-size:13px; color:var(--ink3); margin-top:4px; }
    footer { border-top:1px solid var(--rule); padding:28px 7vw; font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--ink3); }
  `;
}

function renderIndexPage(section, entries) {
  const { typeLabel } = SECTIONS[section];
  const pageUrl = `${BASE_URL}/${SECTIONS[section].dir}/`;
  const title = `Faculty Jobs by ${typeLabel} | Faculty Atlas`;
  const metaDesc = `Browse open faculty positions by ${typeLabel.toLowerCase()} across North American higher education.`;
  const items = entries
    .slice()
    .sort((a, b) => b.jobs.length - a.jobs.length)
    .map((e) => `<li><a class="title" href="${e.path}">${esc(e.name)}</a><div class="meta">${e.jobs.length} open posting${e.jobs.length === 1 ? "" : "s"}</div></li>`)
    .join("\n        ");

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
    <div class="crumbs"><a href="/">Home</a> / ${esc(typeLabel)}s</div>
    <h1>Faculty Jobs by ${esc(typeLabel)}</h1>
    <div class="sub">${entries.length} ${typeLabel.toLowerCase()}${entries.length === 1 ? "" : "s"} with open postings. Browse the full catalog on <a href="/">the homepage</a>.</div>
    <ul class="jobs">
      ${items}
    </ul>
  </div>
  <footer>Faculty Atlas · <a href="/" style="color:var(--ink2);">facultyatlas.org</a> — open faculty positions across North America, charted.</footer>
</body>
</html>
`;
}

function renderHubPage(section, entry, institutionIndex) {
  const { typeLabel, dir } = SECTIONS[section];
  const pageUrl = `${BASE_URL}/${dir}/${entry.slug}/`;
  const count = entry.jobs.length;
  const title = `${entry.name} Faculty Jobs (${count}) | Faculty Atlas`;
  const countLabel = `${count} open faculty position${count === 1 ? "" : "s"}`;
  const metaDesc =
    section === "institution" ? `${countLabel} at ${entry.name}. Updated regularly.`
    : section === "discipline" ? `${countLabel} in ${entry.name} across North American institutions. Updated regularly.`
    : `${countLabel} in ${entry.name}. Updated regularly.`;

  const sortedJobs = entry.jobs
    .slice()
    .sort((a, b) => (b.job.datePosted || "").localeCompare(a.job.datePosted || "") || (a.job.title || "").localeCompare(b.job.title || ""));

  const listItems = sortedJobs
    .map(({ job, path: jpath }) => {
      const posted = fmtDate(job.datePosted);
      const metaParts = [job.college, job.location, posted ? `Posted ${posted}` : null].filter(Boolean);
      return `<li><a class="title" href="${jpath}">${esc(job.title)}</a><div class="meta">${esc(metaParts.join(" · "))}</div></li>`;
    })
    .join("\n        ");

  const itemListLd = JSON.stringify({
    "@context": "https://schema.org/",
    "@type": "ItemList",
    itemListElement: sortedJobs.slice(0, 100).map(({ job, path: jpath }, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${BASE_URL}${jpath}`,
      name: job.title,
    })),
  });

  const breadcrumbLd = JSON.stringify({
    "@context": "https://schema.org/",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/` },
      { "@type": "ListItem", position: 2, name: `${typeLabel}s`, item: `${BASE_URL}/${dir}/` },
      { "@type": "ListItem", position: 3, name: entry.name, item: pageUrl },
    ],
  });

  let officialSite = "";
  if (section === "institution") {
    const inst = lookupInstitution(entry.name, institutionIndex);
    if (inst?.homepage_url) {
      officialSite = ` · <a href="${esc(inst.homepage_url)}" target="_blank" rel="noopener">Official site ↗</a>`;
    }
  }

  // Only state/discipline sections have a matching RSS feed (generate-rss.js
  // uses the same kebab(name) slug, so the URL is predictable without a
  // build-order dependency on that script having already run).
  const rssDir = section === "state" ? "state" : section === "discipline" ? "discipline" : null;
  const rssUrl = rssDir ? `${BASE_URL}/rss/${rssDir}/${entry.slug}.xml` : null;
  const rssLinkTag = rssUrl
    ? `\n  <link rel="alternate" type="application/rss+xml" title="${esc(entry.name)} Faculty Jobs — RSS" href="${rssUrl}" />`
    : "";
  const rssSub = rssUrl ? ` · <a href="${rssUrl}">RSS feed</a>` : "";

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
  <meta name="twitter:image" content="${BASE_URL}/og-card.png" />${rssLinkTag}
  <script type="application/ld+json">${itemListLd}</script>
  <script type="application/ld+json">${breadcrumbLd}</script>
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
    <div class="crumbs"><a href="/">Home</a> / <a href="/${dir}/">${esc(typeLabel)}s</a> / ${esc(entry.name)}</div>
    <h1>${esc(entry.name)} Faculty Jobs</h1>
    <div class="sub">${count} open posting${count === 1 ? "" : "s"}${officialSite}${rssSub}. Browse the full catalog on <a href="/">the homepage</a>.</div>
    <ul class="jobs">
      ${listItems}
    </ul>
  </div>
  <footer>Faculty Atlas · <a href="/" style="color:var(--ink2);">facultyatlas.org</a> — open faculty positions across North America, charted.</footer>
</body>
</html>
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const payload = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "jobs.json"), "utf8"));
const allJobs = payload.jobs || [];
const jobs = allJobs.filter((j) => isRealPosting(j) && isOpen(j));

const lastmod = payload.generatedAt
  ? new Date(payload.generatedAt).toISOString().slice(0, 10)
  : new Date().toISOString().slice(0, 10);

const institutionIndex = buildInstitutionIndex(path.join(ROOT, "data", "institutions-master.json"));

// Same slug-dedup guard as generate-job-pages.js, so links always point at a
// page that actually exists.
const seenSlugs = new Set();
const enriched = [];
for (const job of jobs) {
  const slug = jobSlug(job);
  if (seenSlugs.has(slug)) continue;
  seenSlugs.add(slug);
  enriched.push({
    job,
    path: `/jobs/${slug}/`,
    discipline: getDiscipline(job),
    state: inferState(job),
    college: normalizeSystemCollege(job),
  });
}

function buildEntries(section, keyFn, minJobs) {
  const grouped = groupBy(enriched, keyFn);
  const entries = [];
  for (const [name, items] of grouped) {
    if (section === "discipline" && DISCIPLINE_SKIP.has(name)) continue;
    if (items.length < minJobs) continue;
    entries.push({ name, slug: kebab(name), jobs: items });
  }
  return entries;
}

const groups = {
  discipline: buildEntries("discipline", (e) => e.discipline, 1),
  state: buildEntries("state", (e) => e.state, MIN_STATE_JOBS),
  institution: buildEntries("institution", (e) => e.college, MIN_INSTITUTION_JOBS),
};

const manifest = [];
for (const [section, entries] of Object.entries(groups)) {
  const { dir } = SECTIONS[section];
  const outDir = path.join(ROOT, "docs", dir);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "index.html"), renderIndexPage(section, entries), "utf8");
  manifest.push({ loc: `${BASE_URL}/${dir}/`, lastmod });

  for (const entry of entries) {
    const entryDir = path.join(outDir, entry.slug);
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "index.html"), renderHubPage(section, entry, institutionIndex), "utf8");
    manifest.push({ loc: `${BASE_URL}/${dir}/${entry.slug}/`, lastmod });
  }
}

fs.mkdirSync(path.join(ROOT, "generated"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "generated", "hub-pages.json"), JSON.stringify(manifest, null, 0) + "\n", "utf8");

console.log(
  `generate-hub-pages: ${groups.discipline.length} discipline + ${groups.state.length} state + ${groups.institution.length} institution pages (${manifest.length} URLs total)`
);
