import { normalizeSearchText } from "./jobs-search-index.js";
import { deriveCandidateFields } from "./job-candidate-fields.js";

// Fields required to render, filter, sort, group, and save listing cards.
// Full descriptions stay in jobs.json/source chunks and are fetched lazily only
// when a visitor performs a full-text search.
export const LISTING_INDEX_FIELDS = [
  "title",
  "titleClean",
  "url",
  "source",
  "college",
  "location",
  "department",
  "specialization",
  "rank",
  "tenureTrack",
  "canonicalGroupId",
  "canonicalJobId",
  "openUntilFilled",
  "closeDateRaw",
  "closeDate",
  "startDate",
  "datePosted",
  "firstSeen",
];

export function compactListingJob(job = {}) {
  const compact = {};
  for (const field of LISTING_INDEX_FIELDS) {
    if (job[field] !== undefined && job[field] !== null && job[field] !== "") {
      compact[field] = job[field];
    }
  }
  compact.hasDescription = Boolean(String(job.description || job.summary || "").trim());
  Object.assign(compact, Object.fromEntries(
    Object.entries(deriveCandidateFields(job)).filter(([, value]) => value !== null && value !== "")
  ));
  compact.searchText = normalizeSearchText([
    job.titleClean || job.title,
    job.source,
    job.college,
    job.location,
    job.department,
    job.specialization,
    job.state,
  ].filter(Boolean).join(" "));
  return compact;
}

export function buildListingIndex(payload = {}, jobs = payload.jobs || []) {
  const rows = Array.isArray(jobs) ? jobs.map(compactListingJob) : [];
  return {
    generatedAt: payload.scrapedAt || null,
    scrapedAt: payload.scrapedAt || null,
    count: rows.length,
    jobs: rows,
  };
}
