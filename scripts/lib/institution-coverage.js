const CONFIRMED_BROKEN_STATUSES = new Set(["invalid", "quarantined_broken_link"]);

function clean(value) {
  return String(value || "").trim();
}

export function deriveJobPresenceStatus(jobCount) {
  return Number(jobCount || 0) > 0 ? "jobs_found" : "no_jobs_found";
}

export function deriveCoverageStatus({
  isConfigured = false,
  hasSharedSource = false,
  careerUrl = null,
  verificationStatus = "unchecked",
  jobCount = 0,
} = {}) {
  // Jobs observed in the current scrape are direct evidence that the source is
  // covered, even if a separate link checker could not verify the URL.
  if (Number(jobCount || 0) > 0) return "covered";

  // Some system scrapers attribute jobs to member campuses. Those campuses do
  // not need their own URL or standalone config to remain source-covered.
  if (hasSharedSource) return "covered";

  // Coverage describes whether the scraper has a usable source. A healthy URL
  // that is not wired into the scraper is still part of the coverage backlog.
  if (!isConfigured || !clean(careerUrl)) return "missing";

  const status = clean(verificationStatus).toLowerCase();
  if (CONFIRMED_BROKEN_STATUSES.has(status)) return "missing";

  // Zero matching jobs is job presence, not loss of source coverage. This also
  // keeps bot-blocked, unchecked, and single-failure `broken` sources stable;
  // the verifier promotes sustained failures to quarantined_broken_link.
  return "covered";
}
