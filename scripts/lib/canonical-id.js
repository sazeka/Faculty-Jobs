// Shared canonical-ID logic for jobs.json records (issue #135).
//
// Previously this hash lived twice -- scripts/scrape-to-json.js's
// addCanonicalIds() and scripts/sync-web-data-files.js's attachCanonicalIds()
// -- both hashing only `title|college|department|state`. That key has no
// stable per-posting identity: any two records that happen to share a title,
// college, department, and state collapse into a single canonical group, so
// genuinely different requisitions (different Workday/PeopleAdmin/PageUp
// posting IDs, different campuses/cities, different descriptions and dates)
// were silently merged into one and the frontend rendered only one card for
// several unrelated openings (confirmed at Texas A&M, Ivy Tech, and Michigan
// State).
//
// Fix: prefer a stable ATS requisition/posting ID extracted from the job's
// own URL as the primary identity when one is available (this is exactly the
// signal a "different requisition" implies -- two postings sharing a title,
// college, and department but a different requisition ID are NOT the same
// posting). When no such ID can be extracted, fall back to the historical key
// plus `location`, which still closes most of the same gap (many of the
// over-collapsed groups differed only by city, not by department or state --
// e.g. Ivy Tech's per-campus Workday requisitions all share the same state).
import { createHash } from "node:crypto";

export function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeKeyPart(value) {
  return clean(value).toLowerCase();
}

export function sha1Hex(value) {
  return createHash("sha1").update(String(value || "")).digest("hex");
}

// Query-parameter names, across the ATS platforms in this dataset, that carry
// a stable per-posting identifier. Compared case-insensitively against every
// query key (not just an exact key lookup) so "JobId", "jobId", and "jobid"
// are all recognized without listing every case variant.
const ID_QUERY_KEYS = [
  "posting_id",
  "postingid",
  "jobid",
  "jobopeningid",
  "requisitionid",
  "req_id",
  "reqid",
  "positionid",
];

// Extracts a stable requisition/posting identifier from a job's URL, or null
// if none of the known shapes match. The identifier is namespaced by which
// pattern produced it so two different platforms' numeric IDs (e.g. a
// PeopleAdmin posting id and a Workday requisition number) can never collide
// just because the raw digits happen to match.
export function extractRequisitionId(url) {
  const raw = clean(url);
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  // Query-parameter based IDs (PeopleAdmin bookmarks/postings, TAMU
  // JobDetail.aspx?JobId=..., generic ATS "requisition" params). Namespaced
  // by hostname so the same posting_id on two different tenants (a very real
  // possibility -- PeopleAdmin issues small sequential IDs per tenant) never
  // collides into one canonical group.
  for (const [key, value] of parsed.searchParams.entries()) {
    const normalizedKey = key.toLowerCase();
    if (ID_QUERY_KEYS.includes(normalizedKey) && clean(value)) {
      return `q:${parsed.hostname.toLowerCase()}:${normalizedKey}:${normalizeKeyPart(value)}`;
    }
  }

  const path = parsed.pathname;

  // PeopleAdmin-style stable posting path: /postings/12345
  const postings = path.match(/\/postings\/(\d+)/i);
  if (postings) return `postings:${parsed.hostname.toLowerCase()}:${postings[1]}`;

  // PageUp-hosted career sites (careers.pageuppeople.com/{tenant}/cw/en-us/
  // job/{id}) use a purely numeric final path segment as the stable posting
  // id -- confirmed live at SUNY Downstate (issue #135's named example):
  // distinct requisitions such as "Adjunct Assistant Professor, Epidemiology
  // & Biostatistics" posted three separate times share an identical
  // title/college/department and only differ by this id
  // (".../job/497215" vs ".../job/497216" vs ".../job/497217"). Workday's
  // "/job/{location-slug}/{Title}_R12345" never ends in a bare numeric
  // segment, so this cannot misfire on the Workday pattern above.
  const pageUpJobId = path.match(/\/job\/(\d+)$/i);
  if (pageUpJobId) return `pageup:${parsed.hostname.toLowerCase()}:${pageUpJobId[1]}`;

  // Workday requisition suffix on the final path segment, e.g.
  // ".../Adjunct-Faculty---Biology_JR0000108187" or a reopened/reprinted
  // requisition's "..._JR101035-1" (the "-1" reprint suffix is the same
  // requisition, not a different one, so it is intentionally not captured).
  // Some Workday tenants (e.g. utaustin.wd1.myworkdayjobs.com) separate the
  // "R" prefix from the digits with an underscore ("..._R_00048760" instead
  // of "..._R00048760") -- without the optional "_" here, two of that
  // tenant's distinct postings (different requisition numbers, confirmed
  // live: "Postdoctoral-Fellow_R_00048760-1" vs
  // "Postdoctoral-Fellow_R_00046894-1") both fell through to the
  // title/college/department fallback below and, sharing an identical
  // generic "Postdoctoral Fellow" title/department, collapsed into one
  // canonical group.
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "";
  const workday = last.match(/_(?:JR|R)_?(\d{3,})(?:-\d+)?$/i);
  if (workday) return `workday:${parsed.hostname.toLowerCase()}:JR${workday[1]}`;

  // PageUp and several other vendor-hosted career sites (careers.msu.edu,
  // jobs.tcu.edu, jobs.okstate.edu, explore.msujobs.msstate.edu, ...) append a
  // random per-posting UUID as the final URL path segment, after the
  // human-readable slug -- e.g. "...tenure-system-flint-michigan-united-
  // states-895e1923-fc94-4c55-ab79-49f75277e805". Two openings can reuse the
  // exact same title/department/city (Michigan State genuinely posts the
  // identical "Associate/Full Professor of Human Medicine - Tenure System"
  // title at Flint for multiple, materially different searches -- issue
  // #135's confirmed example) yet always get distinct UUIDs, so this closes
  // the same over-collapse gap for this platform that the checks above close
  // for PeopleAdmin/Workday/TAMU.
  const trailingUuid = last.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (trailingUuid) return `uuid:${trailingUuid[1].toLowerCase()}`;

  return null;
}

// Primary grouping key: a stable requisition ID (when one exists) plus
// title/college/department, so genuinely distinct requisitions that happen to
// share a title/college/department never collapse. Falls back to
// title|college|department|state|location, which still distinguishes
// per-campus requisitions that lack an extractable ID (e.g. a scraper that
// hasn't captured the source's posting id) as long as their city differs.
export function computeCanonicalGroupId(job) {
  const title = normalizeKeyPart(job?.titleClean || job?.title || "");
  const college = normalizeKeyPart(job?.college || "");
  const dept = normalizeKeyPart(job?.department || "");
  const state = normalizeKeyPart(job?.state || job?.source || "");
  const location = normalizeKeyPart(job?.location || "");
  const requisitionId = extractRequisitionId(job?.url);

  const keyParts = requisitionId
    ? [title, college, dept, requisitionId]
    : [title, college, dept, state, location];

  return `grp_${sha1Hex(keyParts.join("|")).slice(0, 16)}`;
}

export function computeCanonicalJobId(job, canonicalGroupId) {
  const source = normalizeKeyPart(job?.source || "");
  const url = normalizeKeyPart(job?.url || "");
  const groupId = canonicalGroupId || computeCanonicalGroupId(job);
  return `job_${sha1Hex([groupId, source, url].join("|")).slice(0, 16)}`;
}

// Assigns canonicalGroupId/canonicalJobId to every job, always recomputing
// from the current field values (title/college/department/state/location/url)
// rather than preserving a previously-stored ID. This is the single choke
// point both the live scrape pipeline (scrape-to-json.js) and the static-site
// sync step (sync-web-data-files.js) now share, instead of each keeping its
// own copy of the hash formula.
export function attachCanonicalIds(jobs) {
  if (!Array.isArray(jobs)) return jobs || [];
  return jobs.map((job) => {
    const canonicalGroupId = computeCanonicalGroupId(job);
    const canonicalJobId = computeCanonicalJobId(job, canonicalGroupId);
    return { ...job, canonicalGroupId, canonicalJobId };
  });
}
