// Carry derived enrichment and description-backfill progress across scrapes.
// Pure functions, unit-tested in scripts/__tests__/enrichment-merge.test.js.
//
// The daily scrape re-fetches raw listings and produces jobs with NO enrichment
// fields, which used to wipe classifications and accumulated descriptions from
// the live site every day. preserveEnrichment()
// copies those fields from the previous snapshot onto the fresh one, matching by
// canonicalJobId first then URL. It ONLY fills fields that are missing/empty on
// the fresh job — it never overwrites data the fresh scrape actually produced —
// so a still-posted job keeps its enrichment and only genuinely-new jobs need
// the (local/periodic) enricher.

import { isMissingDiscipline } from "./discipline-normalize.js";

// A legacy "tenure-track"/"non-tenure-track" string sitting in a previous
// snapshot must not be carried forward verbatim (issue #163) -- otherwise a
// bad representation from before the write-path fix could persist across
// scrapes indefinitely even after every code path that originally wrote it
// has been fixed. Booleans and null pass through unchanged.
function normalizeCarriedTenureTrack(value) {
  if (value === "tenure-track") return true;
  if (value === "non-tenure-track") return false;
  return value;
}

// Per-field adjustment applied to the PREVIOUS snapshot's value before it is
// considered for carry-forward. discipline: a "null"/"Unknown"/"unknown"
// placeholder string (issue #148) is treated as if it were empty, so it is
// never restored onto a fresh job -- that job stays genuinely missing a
// discipline and remains eligible for the next enrichment pass, instead of
// being stuck with the placeholder forever. tenureTrack: see above.
const CARRY_TRANSFORMS = {
  discipline: (value) => (isMissingDiscipline(value) ? undefined : value),
  tenureTrack: normalizeCarriedTenureTrack,
};

export const ENRICHMENT_FIELDS = ["discipline", "tenureTrack", "positionType"];
export const ENRICHMENT_METADATA_FIELDS = ["tenureEvidence"];
export const DESCRIPTION_FIELDS = [
  "description",
  "descriptionFetchedAt",
  "descriptionFetchAttempts",
  "descriptionFetchStatus",
  "descriptionFetchVersion",
];
// Also carry recency dates across scrapes: a scrape that skips the job-presence
// step (firstSeen) or description backfill (datePosted) — e.g. a bare local
// scrape — would otherwise wipe them and break the "Most recent" sort. Only
// fills when the fresh job lacks the field, so Oracle's freshly-scraped
// datePosted and job-presence's firstSeen still win when present.
export const CARRIED_FIELDS = [
  ...ENRICHMENT_FIELDS,
  ...ENRICHMENT_METADATA_FIELDS,
  ...DESCRIPTION_FIELDS,
  "datePosted",
  "firstSeen",
  "closeDate",
  "openUntilFilled",
  "startDate",
  "qualityEvidence",
  "qualityReviewedAt",
  "qualityLinkEvidence",
  "qualityLinkReviewedAt",
  "departmentEvidence",
  "locationEvidence",
];

function isEmpty(v) {
  return v === undefined || v === null || v === "";
}

export function preserveEnrichment(newData, prevData, fields = CARRIED_FIELDS) {
  const empty = { data: newData, restoredFields: 0, jobsTouched: 0, matched: 0 };
  if (!newData || !Array.isArray(newData.jobs)) return empty;
  if (!prevData || !Array.isArray(prevData.jobs) || prevData.jobs.length === 0) return empty;

  const byId = new Map();
  const byUrl = new Map();
  for (const j of prevData.jobs) {
    if (!j) continue;
    if (j.canonicalJobId && !byId.has(j.canonicalJobId)) byId.set(j.canonicalJobId, j);
    const u = j.url ? String(j.url).trim() : "";
    if (u && !byUrl.has(u)) byUrl.set(u, j);
  }

  let restoredFields = 0;
  let jobsTouched = 0;
  let matched = 0;

  const jobs = newData.jobs.map((job) => {
    if (!job) return job;
    const prev =
      (job.canonicalJobId && byId.get(job.canonicalJobId)) ||
      (job.url && byUrl.get(String(job.url).trim())) ||
      null;
    if (!prev) return job;
    matched += 1;
    let next = job;
    for (const f of fields) {
      const transform = CARRY_TRANSFORMS[f];
      const carriedValue = transform ? transform(prev[f]) : prev[f];
      if (isEmpty(job[f]) && !isEmpty(carriedValue)) {
        if (next === job) next = { ...job }; // copy-on-write so unmatched jobs stay ===
        next[f] = carriedValue;
        restoredFields += 1;
      }
    }
    if (next !== job) jobsTouched += 1;
    return next;
  });

  return { data: { ...newData, jobs }, restoredFields, jobsTouched, matched };
}
