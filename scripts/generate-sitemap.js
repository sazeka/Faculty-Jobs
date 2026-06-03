#!/usr/bin/env node
/**
 * generate-sitemap.js
 *
 * Generates docs/sitemap.xml (and public/sitemap.xml) for GitHub Pages.
 * Also writes docs/robots.txt and public/robots.txt if they don't exist.
 *
 * Uses the jobs.json generatedAt timestamp for <lastmod> on the main app URL.
 *
 * Usage:
 *   node scripts/generate-sitemap.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");

const BASE_URL  = "https://facultyatlas.org";

// Static pages that exist as individual HTML files under docs/
const STATIC_PAGES = [
  { path: "/",                        changefreq: "daily",   priority: "1.0" },
  { path: "/inclusion-criteria.html", changefreq: "monthly", priority: "0.5" },
  { path: "/policy-exclusions.html",  changefreq: "weekly",  priority: "0.5" },
];

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

// ── Determine lastmod from jobs.json generatedAt ──────────────────────────────

const jobsPayload = readJson(path.join(ROOT, "public", "jobs.json"));
const lastmod     = jobsPayload?.generatedAt
  ? new Date(jobsPayload.generatedAt).toISOString().slice(0, 10)
  : new Date().toISOString().slice(0, 10);

// ── Build sitemap XML ─────────────────────────────────────────────────────────

const urlEntries = STATIC_PAGES.map(({ path: p, changefreq, priority }) => {
  const loc = p === "/" ? BASE_URL + "/" : BASE_URL + p;
  return [
    "  <url>",
    `    <loc>${loc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
}).join("\n");

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  urlEntries,
  "</urlset>",
  "",
].join("\n");

// ── Build robots.txt ──────────────────────────────────────────────────────────

const robots = [
  "User-agent: *",
  "Allow: /",
  `Sitemap: ${BASE_URL}/sitemap.xml`,
  "",
].join("\n");

// ── Write to docs/ and public/ ────────────────────────────────────────────────

for (const dir of ["docs", "public"]) {
  writeFile(path.join(ROOT, dir, "sitemap.xml"), sitemap);
  writeFile(path.join(ROOT, dir, "robots.txt"),  robots);
}

console.log(`Sitemap written — lastmod: ${lastmod}, ${STATIC_PAGES.length} URLs`);
console.log("  docs/sitemap.xml  public/sitemap.xml");
console.log("  docs/robots.txt   public/robots.txt");
