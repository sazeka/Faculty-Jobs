export const COVERAGE_QUALITY_LEVELS = Object.freeze({
  direct_job_board: "Institution-specific applicant tracking system, job search, or openings feed.",
  verified_shared_system_board: "Verified shared system board with institution or campus attribution.",
  official_employment_page: "Official institution employment page that is distinct from the homepage.",
  homepage_fallback: "Only the institution homepage is configured; an employee openings page is not identified.",
  no_public_hiring_source: "The institution is active, but review found no durable public employee openings source.",
  unresolved: "Coverage needs review because the source is missing, blocked, broken, or not safely attributable.",
  closed_or_out_of_scope: "The record is closed, merged, duplicated, administrative-only, or otherwise outside coverage scope.",
});

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function key(value) {
  return clean(value).toLowerCase();
}

function comparableUrl(value) {
  try {
    const url = new URL(clean(value));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${pathname}${url.search}`;
  } catch {
    return clean(value).toLowerCase().replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/+$/, "");
  }
}

function exclusionKind(inst, exclusion) {
  const verification = key(inst?.verification_status);
  const reason = clean(exclusion?.reason);
  const context = `${verification} ${reason}`;

  if (
    verification === "verified_inactive" ||
    /\b(closed|closure|ceased|inactive|discontinued|wind-down|winding down|merged|absorbed|consolidat(?:ed|ion)|former-name|not a separate employer|online (?:delivery )?modality|administrative (?:office|unit)|governance office|district office|not (?:an )?independent|outside (?:the )?scope|out[- ]of[- ]scope|duplicate|not degree-granting)\b/i.test(context)
  ) {
    return "closed_or_out_of_scope";
  }

  if (
    verification === "verified_no_public_hiring_source" ||
    /\b(no (?:usable |durable |verified |separate |stable )?(?:institution-run )?(?:public )?(?:employee )?(?:openings|hiring|careers?|employment|jobs?)(?: page| source| board| destination)?|public-source limitation|does not publish current vacancies)\b/i.test(reason)
  ) {
    return "no_public_hiring_source";
  }

  return "unresolved";
}

export function classifyInstitutionCoverage(inst, exclusion = null) {
  const explicitResolution = key(inst?.coverage_resolution);
  if (explicitResolution === "closed_or_out_of_scope") return "closed_or_out_of_scope";
  if (explicitResolution === "active_no_public_hiring_source") return "no_public_hiring_source";

  if (exclusion) return exclusionKind(inst, exclusion);
  if (key(inst?.verification_status) === "verified_inactive") return "closed_or_out_of_scope";
  if (key(inst?.verification_status) === "verified_no_public_hiring_source") return "no_public_hiring_source";

  const status = key(inst?.coverage_status);
  if (status !== "covered") return "unresolved";

  const source = key(inst?.coverage_source);
  if (source && source !== key(inst?.name)) return "verified_shared_system_board";

  const careerUrl = clean(inst?.career_url);
  if (!careerUrl) return "unresolved";
  if (comparableUrl(careerUrl) === comparableUrl(inst?.homepage_url)) return "homepage_fallback";
  if (key(inst?.platform_type) === "generic") return "official_employment_page";
  return "direct_job_board";
}
