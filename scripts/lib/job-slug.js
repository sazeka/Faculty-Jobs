// Stable, URL-safe slug for a job's detail page. Shared by the page generator
// and the sitemap so both produce identical URLs. Form:
//   <kebab-title>-<kebab-college>-<6char-hash>
// The hash (derived from canonicalJobId) guarantees uniqueness even when two
// postings share a title+college, and keeps the URL stable across rebuilds.
import crypto from "crypto";

export function kebab(str, max) {
  const s = String(str || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return max ? s.slice(0, max).replace(/-+$/g, "") : s;
}

export function jobSlug(job) {
  const key = String(job.canonicalJobId || job.url || `${job.title}|${job.college}`);
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 6);
  const title = kebab(job.title, 60);
  const college = kebab(job.college, 40);
  return [title, college, hash].filter(Boolean).join("-");
}

export function jobPath(job) {
  return `/jobs/${jobSlug(job)}/`;
}
