#!/usr/bin/env node
/**
 * inject-og-meta.js
 *
 * Patches docs/index.html and public/index.html with live Open Graph and SEO
 * meta tags derived from public/jobs.json.
 *
 * - Replaces <title>Faculty Atlas Vue</title> with a live job/college count title.
 * - Injects (or replaces) description, og:title, og:description, og:url, og:type,
 *   and a canonical link tag before </head>.
 * - Idempotent: re-running updates existing tags rather than duplicating them.
 *
 * Usage:
 *   node scripts/inject-og-meta.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Read stats from public/jobs.json ─────────────────────────────────────────

const jobsPath = path.join(ROOT, "public", "jobs.json");
const jobsPayload = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
const jobs = jobsPayload.jobs ?? [];

const jobCount = jobs.length;
const collegeCount = new Set(jobs.map((j) => j.college).filter(Boolean)).size;
const sourceCount = new Set(jobs.map((j) => j.source).filter(Boolean)).size;

// ── Meta tag definitions ──────────────────────────────────────────────────────

const TITLE_TEXT =
  `Faculty Atlas \u2014 ${jobCount} Faculty Jobs at ${collegeCount} Institutions`;

// One professional description, reused verbatim for meta/OG/Twitter so search
// engines and social previews show consistent, on-brand copy instead of the
// old data-dump phrasing ("Browse X listings across Y institutions and Z
// state systems") \u2014 which read like an auto-generated stat line and appeared
// to get passed over by Google in favor of its own on-page snippet.
const DESCRIPTION_TEXT =
  `A scholarly directory of open faculty positions across North American higher education. ${jobCount} listings, updated daily \u2014 free to browse, no account required.`;

// Each entry describes one tag to inject/replace.
// `attr`    – the attribute used to identify the tag (name or property)
// `attrVal` – the value of that attribute
// `tag`     – the full replacement HTML string
const META_TAGS = [
  {
    attr: "name",
    attrVal: "description",
    tag: `<meta name="description" content="${DESCRIPTION_TEXT}">`,
  },
  {
    attr: "property",
    attrVal: "og:title",
    tag: `<meta property="og:title" content="Faculty Atlas \u2014 ${jobCount} Faculty Jobs">`,
  },
  {
    attr: "property",
    attrVal: "og:description",
    tag: `<meta property="og:description" content="${DESCRIPTION_TEXT}">`,
  },
  {
    attr: "property",
    attrVal: "og:url",
    tag: `<meta property="og:url" content="https://www.facultyatlas.org/">`,
  },
  {
    attr: "property",
    attrVal: "og:type",
    tag: `<meta property="og:type" content="website">`,
  },
  {
    attr: "property",
    attrVal: "og:site_name",
    tag: `<meta property="og:site_name" content="Faculty Atlas">`,
  },
  {
    attr: "property",
    attrVal: "og:image",
    tag: `<meta property="og:image" content="https://www.facultyatlas.org/og-card.png">`,
  },
  // Twitter/X card — mirror the live count-based OG copy so the two stay in sync.
  {
    attr: "name",
    attrVal: "twitter:card",
    tag: `<meta name="twitter:card" content="summary_large_image">`,
  },
  {
    attr: "name",
    attrVal: "twitter:title",
    tag: `<meta name="twitter:title" content="Faculty Atlas — ${jobCount} Faculty Jobs">`,
  },
  {
    attr: "name",
    attrVal: "twitter:description",
    tag: `<meta name="twitter:description" content="${DESCRIPTION_TEXT}">`,
  },
  {
    attr: "name",
    attrVal: "twitter:image",
    tag: `<meta name="twitter:image" content="https://www.facultyatlas.org/og-card.png">`,
  },
  {
    attr: "canonical",  // special sentinel — matched differently below
    attrVal: "canonical",
    tag: `<link rel="canonical" href="https://www.facultyatlas.org/">`,
  },
];

// ── Patch helper ─────────────────────────────────────────────────────────────

/**
 * Returns a regex that matches an existing tag for the given identifier so we
 * can replace it in-place when it is already present.
 */
function existingTagPattern(attr, attrVal) {
  if (attr === "canonical") {
    // Match any <link rel="canonical" …> tag (self-closing or not)
    return /<link\s[^>]*rel=["']canonical["'][^>]*\/?>/i;
  }
  // Match any <meta name/property="value" …> tag
  const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedVal = attrVal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `<meta\\s[^>]*${escapedAttr}=["']${escapedVal}["'][^>]*>`,
    "i"
  );
}

function patchHtml(html) {
  // 1. Replace <title>
  html = html.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${TITLE_TEXT}</title>`
  );

  // 2. Inject or replace each meta/link tag
  for (const { attr, attrVal, tag } of META_TAGS) {
    const pattern = existingTagPattern(attr, attrVal);
    if (pattern.test(html)) {
      // Replace existing tag in-place
      html = html.replace(pattern, tag);
    } else {
      // Insert before </head>
      html = html.replace("</head>", `  ${tag}\n  </head>`);
    }
  }

  return html;
}

// ── Patch docs/index.html and public/index.html ───────────────────────────────

const targets = [
  path.join(ROOT, "docs", "index.html"),
  path.join(ROOT, "public", "index.html"),
];

for (const filePath of targets) {
  const original = fs.readFileSync(filePath, "utf8");
  const patched = patchHtml(original);
  fs.writeFileSync(filePath, patched, "utf8");
}

console.log(
  `inject-og-meta: patched ${targets.length} files — ` +
  `${jobCount} jobs, ${collegeCount} colleges, ${sourceCount} sources`
);
