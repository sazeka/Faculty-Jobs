import { classifyTenureTrack } from "./weekly-tenure-stats.js";

export const DESCRIPTION_RETRY_DAYS = 14;
export const DESCRIPTION_MAX_ATTEMPTS = 2;
export const DESCRIPTION_FETCH_VERSION = 2;

function hasHttpUrl(job) {
  return /^https?:\/\//i.test(job?.url || "");
}

// OneUSG/PeopleSoft listing rows do not expose public detail URLs. The scraper
// stores a #jobId fragment to keep rows unique, but fragments never reach the
// server and anonymous visits currently redirect to a PeopleSoft sign-in error.
// Do not spend the limited daily detail-page quota retrying these virtual links.
export function isUnsupportedDescriptionUrl(url) {
  return /careers\.hprod\.onehcm\.usg\.edu/i.test(String(url || "")) && /#jobId=\d+/i.test(String(url || ""));
}

function inferredAttempts(job) {
  const stored = Number(job?.descriptionFetchAttempts);
  if (Number.isFinite(stored) && stored >= 0) return stored;
  return job?.descriptionFetchedAt ? 1 : 0;
}

export function needsDescriptionFetch(
  job,
  nowMs = Date.now(),
  retryDays = DESCRIPTION_RETRY_DAYS,
  maxAttempts = DESCRIPTION_MAX_ATTEMPTS
) {
  if (!hasHttpUrl(job) || isUnsupportedDescriptionUrl(job?.url) || String(job?.description || "").trim()) return false;
  // Version 2 removed a custom bot user agent that prevented many Workday SPAs
  // from rendering. Give every empty Workday result captured by the old fetcher
  // one immediate migration retry, regardless of its age/attempt count.
  if (
    /myworkdayjobs\.com|myworkdaysite\.com/i.test(String(job?.url || "")) &&
    Number(job?.descriptionFetchVersion || 0) < DESCRIPTION_FETCH_VERSION
  ) return true;
  const attempts = inferredAttempts(job);
  if (!job.descriptionFetchedAt) return attempts < maxAttempts;
  if (attempts >= maxAttempts) return false;

  const fetchedMs = Date.parse(job.descriptionFetchedAt);
  if (!Number.isFinite(fetchedMs)) return true;
  return nowMs - fetchedMs >= retryDays * 24 * 60 * 60 * 1000;
}

export function prioritizeDescriptionCandidates(jobs = [], nowMs = Date.now()) {
  return jobs
    .map((job, index) => ({ job, index }))
    .filter(({ job }) => needsDescriptionFetch(job, nowMs))
    .sort((a, b) => {
      const unknownA = classifyTenureTrack(a.job) === null ? 0 : 1;
      const unknownB = classifyTenureTrack(b.job) === null ? 0 : 1;
      if (unknownA !== unknownB) return unknownA - unknownB;
      const dateA = Date.parse(a.job.datePosted || a.job.firstSeen || "") || 0;
      const dateB = Date.parse(b.job.datePosted || b.job.firstSeen || "") || 0;
      return dateB - dateA || a.index - b.index;
    })
    .map(({ job }) => job);
}

export function descriptionAttemptCount(job) {
  return inferredAttempts(job);
}
