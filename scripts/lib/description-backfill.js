import { classifyTenureTrack } from "./weekly-tenure-stats.js";

export const DESCRIPTION_RETRY_DAYS = 14;
export const DESCRIPTION_MAX_ATTEMPTS = 2;
export const DESCRIPTION_FETCH_VERSION = 4;

function hasHttpUrl(job) {
  return /^https?:\/\//i.test(job?.url || "");
}

// Some URLs cannot yield a description to an unattended fetcher even though
// they remain useful links for a human job seeker. Keep the job records, but do
// not spend the limited description quota retrying known-impossible targets.
export function isUnsupportedDescriptionUrl(url) {
  const value = String(url || "");

  // OneUSG/PeopleSoft listing rows use a virtual #jobId fragment. Fragments
  // never reach the server and anonymous visits redirect to a sign-in error.
  if (/careers\.hprod\.onehcm\.usg\.edu/i.test(value) && /#jobId=\d+/i.test(value)) return true;

  // InterviewExchange/Hirezon returns its explicit "resource not authorized"
  // WAF response to direct pages and public RSS feeds from GitHub-hosted,
  // residential, Google translation, and public archive fetchers. Repeated
  // browser attempts cannot recover content and previously consumed hundreds
  // of slots per backfill. Preserve these links for users while excluding them
  // from automated description attempts until the vendor exposes a usable feed.
  if (/^https?:\/\/([a-z0-9-]+\.)?interviewexchange\.com\//i.test(value)) return true;

  return false;
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
  // New direct API fetchers can recover records that browser rendering could
  // not. Give empty results from the affected older fetcher one immediate
  // migration retry, without re-queuing platforms fixed in prior versions.
  const url = String(job?.url || "");
  const fetchVersion = Number(job?.descriptionFetchVersion || 0);
  if (/myworkdayjobs\.com|myworkdaysite\.com/i.test(url) && fetchVersion < 3) return true;
  if (/paycomonline\.net/i.test(url) && fetchVersion < DESCRIPTION_FETCH_VERSION) return true;
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
