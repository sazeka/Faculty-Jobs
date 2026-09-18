// Static-page classification helpers for generate-job-pages.js (tags +
// JobPosting JSON-LD). Pure functions, unit-tested in
// scripts/__tests__/job-posting-classification.test.js.
//
// Issue #136: generate-job-pages.js used to read job.positionType and
// job.tenureTrack directly. Those are raw scrape/enrichment fields — often
// stale, "Other", missing, or (for tenureTrack) a boolean rather than the
// "tenure-track"/"non-tenure-track" strings the generator checked for. The
// interactive Vue app never trusts those raw fields either: it always runs
// them through the title-aware normalizers in web-vue/src/lib/jobClassification.js
// (getPositionType/getPositionTypes/normalizeTenureTrack). This module calls
// the SAME normalizers so static pages, their JobPosting JSON-LD, and the
// interactive app agree on what a job actually is.
//
// Concretely, this fixed:
//   - ~1,100 titles containing "Adjunct" (e.g. "Adjunct Assistant Professor",
//     "Adjunct Instructor") being published as employmentType: FULL_TIME,
//     because raw positionType for those records is "Assistant Professor",
//     "Instructor", "Other", or missing — never the exact string "Adjunct" —
//     so the old `String(job.positionType).toLowerCase() === "adjunct"` check
//     never matched.
//   - Tenure-status tags disappearing from most static pages, because
//     tagList() only recognized the literal strings "tenure-track" /
//     "non-tenure-track" while ~17,000 records store tenureTrack as a
//     boolean (true/false).
import { getPositionType, getPositionTypes, normalizeTenureTrack } from "../../web-vue/src/lib/jobClassification.js";
import { inferEmploymentType } from "./job-candidate-fields.js";

function titleOf(job) {
  return job?.titleClean || job?.title || "";
}

// Every rank/appointment type represented by the job's title (falls back to
// an explicit job.rank when present), same precedence useJobFilters.js uses
// for the interactive app's positionTypes facet — plus one narrow addition:
// if the title-based classifier didn't already flag the posting as Adjunct,
// but the raw (enrichment-sourced) positionType field explicitly says
// "Adjunct", keep that. That field is unreliable as the *primary* signal
// (see module comment — it's often the rank, "Other", or missing even for
// title-obvious Adjunct postings), but a small number of records (titles
// with no "adjunct" substring at all, e.g. typos like "Adjuct"/"Adjunt", or
// titles that only imply it) rely on it as their only evidence. Dropping it
// entirely would silently regress those from correctly PART_TIME back to
// FULL_TIME.
export function derivePositionTypes(job) {
  const types = job?.rank ? [job.rank] : getPositionTypes(titleOf(job));
  if (!types.includes("Adjunct") && String(job?.positionType || "").trim() === "Adjunct") {
    return [...types, "Adjunct"];
  }
  return types;
}

// The single "primary" position type, same precedence as positionType in
// useJobFilters.js.
export function derivePrimaryPositionType(job) {
  return job?.rank || getPositionType(titleOf(job));
}

// true | false | null — normalizes both the boolean and the
// "tenure-track"/"non-tenure-track" string forms stored in jobs.json, and
// (like the interactive app) lets explicit title language win over a stale
// or contradictory raw tenureTrack value.
export function deriveTenureTrack(job) {
  return normalizeTenureTrack(job?.tenureTrack, titleOf(job));
}

// Position types that Google's JobPosting schema has no dedicated enum for,
// so we express them as FULL_TIME + TEMPORARY instead — unchanged from the
// generator's original mapping (raw positionType values "Visiting",
// "Postdoctoral", "Research"), just keyed off the normalized labels those
// raw values correspond to.
const TEMPORARY_POSITION_TYPES = new Set(["Visiting Faculty", "Postdoctoral", "Research Faculty"]);

// Derives the schema.org/Google-for-Jobs employmentType for a job.
//
// Uses every position type represented by the (possibly multi-rank/adjunct)
// title, not just a single raw field, and treats "Adjunct" appearing
// anywhere in that set as part-time — unless the source text has stronger,
// explicit full-/part-time evidence (e.g. "This is a full-time position"),
// in which case that evidence wins.
export function deriveEmploymentType(job) {
  const positionTypes = derivePositionTypes(job);
  const explicit = inferEmploymentType(job);
  const isTemporary = positionTypes.some((type) => TEMPORARY_POSITION_TYPES.has(type));

  if (explicit === "Part-time") return "PART_TIME";
  if (explicit === "Full-time") return isTemporary ? ["FULL_TIME", "TEMPORARY"] : "FULL_TIME";

  if (positionTypes.includes("Adjunct")) return "PART_TIME";
  if (isTemporary) return ["FULL_TIME", "TEMPORARY"];
  return "FULL_TIME";
}
