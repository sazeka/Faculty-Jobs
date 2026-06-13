#!/usr/bin/env node
/**
 * generate-job-pages.js
 *
 * Static-site-generates one indexable HTML page per job under docs/jobs/<slug>/
 * and public/jobs/<slug>/. Each page carries the job content, per-page Open
 * Graph/Twitter meta, a self-canonical link, and JobPosting JSON-LD (so listings
 * are eligible for Google for Jobs). Crawlers get real content; users get a
 * readable landing page with an outbound "Apply" link.
 *
 * The output dirs are wiped and rebuilt each run, so pages for jobs that have
 * dropped out of the catalog disappear (they then 404). Writes a manifest
 * (generated/job-pages.json) that generate-sitemap.js reads to list every URL.
 *
 * Runs after copy-dist (needs docs/ to exist) and before generate-sitemap.
 *
 * Usage:  node scripts/generate-job-pages.js [--limit N]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jobSlug } from "./lib/job-slug.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = "https://www.facultyatlas.org";

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity;

// Only generate pages for jobs with enough content to be worth indexing.
// Title-only pages are "thin" — Google may not index them and they add churn.
const MIN_DESC = 120;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Light cleanup of raw ATS description text into readable paragraphs.
function cleanDescription(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  // Drop common ATS boilerplate noise.
  t = t.replace(/Show More\s*Show Less/gi, " ").replace(/View favorites/gi, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function fmtDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function tagList(job) {
  const tags = [];
  if (job.positionType && job.positionType !== "Other") tags.push(job.positionType);
  if (job.tenureTrack === "tenure-track") tags.push("Tenure-Track");
  else if (job.tenureTrack === "non-tenure-track") tags.push("Non-Tenure");
  if (job.discipline) tags.push(job.discipline);
  return tags;
}

function jobPostingLd(job, pageUrl, descText) {
  const ld = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: descText || job.title,
    hiringOrganization: { "@type": "Organization", name: job.college || "Unknown" },
    url: pageUrl,
    directApply: false,
  };
  if (job.datePosted) ld.datePosted = job.datePosted;
  if (job.closeDate) ld.validThrough = `${job.closeDate}T23:59:59`;
  if (job.location || job.state) {
    ld.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.city || undefined,
        addressRegion: job.state || undefined,
        addressCountry: "US",
      },
    };
  }
  if (job.url) ld.sameAs = job.url;
  return JSON.stringify(ld);
}

function renderPage(job) {
  const slug = jobSlug(job);
  const pageUrl = `${BASE_URL}/jobs/${slug}/`;
  const descText = cleanDescription(job.description);
  const paras = descText
    ? descText.match(/.{1,420}(?:\s|$)/g).slice(0, 6).map((p) => `<p>${esc(p.trim())}</p>`).join("\n        ")
    : `<p>${esc(job.title)} at ${esc(job.college)}. View the full posting on the institution's career site.</p>`;
  const tags = tagList(job).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  const posted = fmtDate(job.datePosted);
  const deadline = job.openUntilFilled ? "Rolling / open until filled" : fmtDate(job.closeDate);
  const starts = fmtDate(job.startDate);
  const metaDesc = (descText || `${job.title} at ${job.college}.`).slice(0, 155);
  const title = `${job.title} — ${job.college} | Faculty Atlas`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/svg+xml" href="/assets/logos/favicon.svg" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(metaDesc)}" />
  <link rel="canonical" href="${pageUrl}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Faculty Atlas" />
  <meta property="og:title" content="${esc(job.title)} — ${esc(job.college)}" />
  <meta property="og:description" content="${esc(metaDesc)}" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:image" content="${BASE_URL}/og-card.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(job.title)} — ${esc(job.college)}" />
  <meta name="twitter:description" content="${esc(metaDesc)}" />
  <meta name="twitter:image" content="${BASE_URL}/og-card.png" />
  <script type="application/ld+json">${jobPostingLd(job, pageUrl, descText)}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root { --bg:#f3f3f1; --paper:#fbfbfa; --ink:#1d2128; --ink2:#454b55; --ink3:#8a8f99; --accent:#2b3442; --rule:#e2e2df; --tag:#eceff4; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:var(--bg); color:var(--ink); font-family:'Newsreader',serif; font-size:17px; line-height:1.6; }
    a { color:inherit; }
    header { display:flex; align-items:center; justify-content:space-between; padding:18px 7vw; border-bottom:1px solid var(--rule); background:var(--paper); }
    .brand { display:flex; align-items:center; gap:12px; text-decoration:none; }
    .brand .wm { font-family:'Instrument Serif',serif; font-size:24px; color:var(--ink); }
    .nav a { font-family:'JetBrains Mono',monospace; font-size:13px; letter-spacing:0.08em; color:var(--ink2); text-transform:uppercase; text-decoration:none; margin-left:24px; }
    .wrap { max-width:1040px; margin:0 auto; padding:32px 7vw 64px; }
    .back { font-family:'JetBrains Mono',monospace; font-size:12px; letter-spacing:0.08em; color:var(--ink3); text-transform:uppercase; text-decoration:none; }
    h1 { font-family:'Instrument Serif',serif; font-weight:400; font-size:clamp(32px,5vw,50px); line-height:1.05; letter-spacing:-0.5px; margin:18px 0 12px; }
    .inst { font-size:19px; color:var(--ink2); }
    .inst b { color:var(--ink); font-weight:500; }
    .tags { display:flex; gap:9px; flex-wrap:wrap; margin:20px 0 0; }
    .tag { font-family:'JetBrains Mono',monospace; font-size:12px; background:var(--tag); color:var(--accent); padding:6px 12px; border-radius:6px; }
    .cols { display:grid; grid-template-columns:1fr 320px; gap:48px; margin-top:36px; }
    @media (max-width:760px){ .cols{ grid-template-columns:1fr; } }
    .body h2 { font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:var(--ink3); margin-bottom:14px; }
    .body p { margin-bottom:15px; }
    .facts { background:var(--paper); border:1px solid var(--rule); border-radius:14px; padding:22px 22px 8px; }
    .fact { padding:10px 0; border-bottom:1px solid var(--rule); }
    .fact:last-child { border-bottom:none; }
    .fact .l { font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:var(--ink3); margin-bottom:3px; }
    .fact .v { font-family:'Instrument Serif',serif; font-size:20px; }
    .fact .v.sm { font-family:'Newsreader',serif; font-size:16px; }
    .apply { display:block; text-align:center; background:var(--accent); color:#fff; font-family:'JetBrains Mono',monospace; font-size:14px; letter-spacing:0.04em; padding:16px; border-radius:11px; margin-top:16px; text-decoration:none; }
    .applynote { font-size:12px; color:var(--ink3); text-align:center; margin-top:9px; font-style:italic; }
    footer { border-top:1px solid var(--rule); padding:28px 7vw; font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--ink3); }
  </style>
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
    <a class="back" href="/">← All postings</a>
    <h1>${esc(job.title)}</h1>
    <div class="inst"><b>${esc(job.college)}</b>${job.department ? " &nbsp;·&nbsp; " + esc(job.department) : ""}${job.location ? " &nbsp;·&nbsp; " + esc(job.location) : ""}</div>
    <div class="tags">${tags}</div>
    <div class="cols">
      <div class="body">
        <h2>Position summary</h2>
        ${paras}
        <p style="font-size:13px;color:var(--ink3);font-style:italic;margin-top:8px;">Summary from the source posting. Always confirm details on the institution's official career page.</p>
      </div>
      <aside>
        <div class="facts">
          ${posted ? `<div class="fact"><div class="l">Posted</div><div class="v">${posted}</div></div>` : ""}
          ${deadline ? `<div class="fact"><div class="l">Deadline</div><div class="v ${/Rolling/.test(deadline) ? "sm" : ""}">${esc(deadline)}</div></div>` : ""}
          ${starts ? `<div class="fact"><div class="l">Starts</div><div class="v sm">${starts}</div></div>` : ""}
          ${job.location || job.state ? `<div class="fact"><div class="l">Location</div><div class="v sm">${esc(job.location || job.state)}</div></div>` : ""}
        </div>
        ${job.url ? `<a class="apply" href="${esc(job.url)}" target="_blank" rel="noopener nofollow">Apply on ${esc(job.college)}'s site →</a><div class="applynote">Opens the institution's official career page</div>` : ""}
      </aside>
    </div>
  </div>
  <footer>Faculty Atlas · <a href="/" style="color:var(--ink2);">facultyatlas.org</a> — open faculty positions across North America, charted.</footer>
</body>
</html>
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const payload = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "jobs.json"), "utf8"));
const allJobs = payload.jobs || [];
// A page (with JobPosting schema) is only worth emitting for a real, classified
// faculty posting with enough content. Skip when BOTH classifiers failed —
// null discipline AND no/Other positionType — which flags news items and other
// non-job noise (e.g. "Dr. X Named to State Board"); a bad JobPosting hurts SEO.
// Unambiguous non-job titles (news, announcements, obituaries). These phrases
// don't appear in real faculty postings, so a title match is a safe reject.
const NON_JOB_TITLE = /\b(named to|named as|appointed|welcome from|in memoriam|obituary|passes away|remembering|announces|announcement|receives|honored|wins|elected|inducted)\b/i;

function isRealPosting(j) {
  if (!j || !j.title || !j.url) return false;
  if (String(j.description || "").length < MIN_DESC) return false;
  if (NON_JOB_TITLE.test(j.title)) return false;
  const unclassified = (j.discipline == null) && (!j.positionType || j.positionType === "Other");
  return !unclassified;
}
const jobs = allJobs.filter(isRealPosting).slice(0, LIMIT);

const lastmod = payload.generatedAt
  ? new Date(payload.generatedAt).toISOString().slice(0, 10)
  : new Date().toISOString().slice(0, 10);

// docs/ is what GitHub Pages serves; public/ is only a vite source mirror and
// doesn't need (or want) ~40MB of generated pages committed into it.
const targets = [path.join(ROOT, "docs", "jobs")];
for (const dir of targets) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const manifest = [];
const seen = new Set();
for (const job of jobs) {
  const slug = jobSlug(job);
  if (seen.has(slug)) continue; // guard against rare slug collisions
  seen.add(slug);
  const htmlOut = renderPage(job);
  for (const dir of targets) {
    const outDir = path.join(dir, slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "index.html"), htmlOut, "utf8");
  }
  manifest.push({ loc: `${BASE_URL}/jobs/${slug}/`, lastmod });
}

fs.mkdirSync(path.join(ROOT, "generated"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "generated", "job-pages.json"), JSON.stringify(manifest, null, 0) + "\n", "utf8");

console.log(`generate-job-pages: ${manifest.length} pages (of ${allJobs.length} jobs; ${allJobs.length - jobs.length} skipped as thin/no-url)`);
