import { classifyTenureTrack } from "./weekly-tenure-stats.js";

export const DESCRIPTION_RETRY_DAYS = 14;
export const DESCRIPTION_MAX_ATTEMPTS = 2;

function hasHttpUrl(job) {
  return /^https?:\/\//i.test(job?.url || "");
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
  if (!hasHttpUrl(job) || String(job?.description || "").trim()) return false;
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
