#!/usr/bin/env node
/**
 * generate-rss.js
 *
 * Static-site-generates RSS 2.0 feeds under docs/rss/state/<slug>.xml,
 * docs/rss/discipline/<slug>.xml, and docs/rss/all.xml — one feed per
 * browsable category, plus a global feed of every open posting.
 *
 * Discipline/state grouping reuses the same classification logic the Vue
 * frontend uses for filtering (useJobFilters.js) and the same thresholds
 * (hub-thresholds.js) generate-hub-pages.js uses, so a feed only exists where
 * a corresponding hub page also exists — a subscriber's feed always matches
 * something browsable on the site.
 *
 * Institution-level feeds are intentionally out of scope for v1 (state +
 * discipline cover the filters people actually browse/search by).
 *
 * Runs after generate-hub-pages.js (needs job slugs, same as hub pages) and
 * before generate-sitemap.js (which lists these feed URLs). Writes a
 * manifest (generated/rss-feeds.json) that generate-sitemap.js reads.
 *
 * Usage: node scripts/generate-rss.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jobSlug, jobPath, kebab } from "./lib/job-slug.js";
import { MIN_STATE_JOBS, DISCIPLINE_SKIP } from "./lib/hub-thresholds.js";
import { getDiscipline, inferState } from "../web-vue/src/composables/useJobFilters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = "https://www.facultyatlas.org";
const MAX_ITEMS = 50;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Same thin-content / non-job filter as generate-hub-pages.js — a feed should
// only ever include a job that actually has its own indexable page.
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

// RFC 822 date, as required by the RSS 2.0 spec for pubDate/lastBuildDate.
function rfc822(isoOrDateLike) {
  const d = isoOrDateLike ? new Date(isoOrDateLike) : new Date(NaN);
  if (Number.isNaN(d.getTime())) return null;
  return d.toUTCString().replace(/GMT$/, "GMT");
}

function renderFeed({ title, description, link, selfUrl, entries }) {
  const sorted = entries
    .slice()
    .sort((a, b) =>
      (b.job.firstSeen || b.job.datePosted || "").localeCompare(a.job.firstSeen || a.job.datePosted || "")
    )
    .slice(0, MAX_ITEMS);

  const lastBuildDate = rfc822(new Date()) ;

  const items = sorted
    .map(({ job, path: jpath }) => {
      const itemUrl = `${BASE_URL}${jpath}`;
      const pubDate = rfc822(job.firstSeen || job.datePosted);
      const descParts = [job.college, job.location].filter(Boolean).join(" · ");
      return [
        "    <item>",
        `      <title>${esc(job.title)}</title>`,
        `      <link>${esc(itemUrl)}</link>`,
        `      <guid isPermaLink="true">${esc(itemUrl)}</guid>`,
        pubDate ? `      <pubDate>${pubDate}</pubDate>` : null,
        `      <description>${esc(descParts)}</description>`,
        "    </item>",
      ].filter(Boolean).join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${esc(title)}</title>`,
    `    <link>${esc(link)}</link>`,
    `    <description>${esc(description)}</description>`,
    "    <language>en-us</language>",
    lastBuildDate ? `    <lastBuildDate>${lastBuildDate}</lastBuildDate>` : null,
    `    <atom:link href="${esc(selfUrl)}" rel="self" type="application/rss+xml" />`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].filter(Boolean).join("\n");
}

function writeFeed(relPath, feedXml) {
  for (const dir of ["docs", "public"]) {
    const full = path.join(ROOT, dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, feedXml, "utf8");
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const payload = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "jobs.json"), "utf8"));
const allJobs = payload.jobs || [];
const jobs = allJobs.filter((j) => isRealPosting(j) && isOpen(j));

const lastmod = payload.generatedAt
  ? new Date(payload.generatedAt).toISOString().slice(0, 10)
  : new Date().toISOString().slice(0, 10);

// Same slug-dedup guard as generate-hub-pages.js/generate-job-pages.js.
const seenSlugs = new Set();
const enriched = [];
for (const job of jobs) {
  const slug = jobSlug(job);
  if (seenSlugs.has(slug)) continue;
  seenSlugs.add(slug);
  enriched.push({
    job,
    path: jobPath(job),
    discipline: getDiscipline(job),
    state: inferState(job),
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

const SECTIONS = {
  discipline: { dir: "discipline", typeLabel: "Discipline", buildEntries: () => buildEntries("discipline", (e) => e.discipline, 1) },
  state: { dir: "state", typeLabel: "State", buildEntries: () => buildEntries("state", (e) => e.state, MIN_STATE_JOBS) },
};

const manifest = [];

// Global feed — every open posting.
{
  const relPath = path.join("rss", "all.xml");
  const selfUrl = `${BASE_URL}/rss/all.xml`;
  const feedXml = renderFeed({
    title: "Faculty Atlas — All Open Faculty Positions",
    description: "Every open faculty posting on Faculty Atlas, most recent first.",
    link: `${BASE_URL}/`,
    selfUrl,
    entries: enriched,
  });
  writeFeed(relPath, feedXml);
  manifest.push({ loc: selfUrl, lastmod });
}

// Per-category feeds.
for (const [section, cfg] of Object.entries(SECTIONS)) {
  const entries = cfg.buildEntries();
  for (const entry of entries) {
    const relPath = path.join("rss", cfg.dir, `${entry.slug}.xml`);
    const selfUrl = `${BASE_URL}/rss/${cfg.dir}/${entry.slug}.xml`;
    const hubUrl = `${BASE_URL}/${cfg.dir === "state" ? "states" : "disciplines"}/${entry.slug}/`;
    const feedXml = renderFeed({
      title: `Faculty Atlas — ${entry.name} Faculty Jobs`,
      description: `Open faculty positions in ${cfg.typeLabel === "State" ? entry.name : `the ${entry.name}`} on Faculty Atlas, most recent first.`,
      link: hubUrl,
      selfUrl,
      entries: entry.jobs,
    });
    writeFeed(relPath, feedXml);
    manifest.push({ loc: selfUrl, lastmod });
  }
}

fs.mkdirSync(path.join(ROOT, "generated"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "generated", "rss-feeds.json"), JSON.stringify(manifest, null, 0) + "\n", "utf8");

console.log(`generate-rss: ${manifest.length} feeds written (1 global + per state/discipline)`);
