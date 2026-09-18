// Consolidates job records that are the exact same posting scraped twice
// under two different institution labels because one of the labels is a
// system-wide/umbrella scraper catch-all rather than the specific campus
// that's actually hiring. See issue #119.
//
// canonicalGroupId (scripts/scrape-to-json.js) is derived from
// title|college|dept|state, so it always includes the college name -- two
// records that share the identical raw source URL and title, but differ
// only in `college`, get different canonicalGroupIds and are never
// recognized as duplicates by the frontend's grouping (useJobFilters.js) or
// by the static hub/job-page generators' jobSlug-based "seen" dedup guards
// (both keyed on canonicalJobId, which is itself derived from
// canonicalGroupId). Running this pass BEFORE canonical IDs are assigned
// means the surviving record gets a canonical ID as usual and there is
// nothing left downstream to reconcile.
//
// Scope: this only drops a record when (a) it shares an exact, normalized
// URL and normalized title with another record, (b) its own `college` is a
// verified system/umbrella catch-all label (system-umbrella-institutions.js
// -- a short, hand-verified list, deliberately NOT a blanket institution
// alias), and (c) every OTHER record in that URL+title group agrees on a
// single specific-campus college. A URL shared by two or more DIFFERENT
// specific (non-umbrella) campuses -- e.g. Crafton Hills College / San
// Bernardino Valley College's genuine either-campus postings (issue #133 /
// PR #134) -- is left completely untouched, on purpose: that's a real
// multi-campus affiliation, not a scraper artifact, and the maintainer has
// already confirmed those should keep matching both campuses.
import { canonicalizeUrl } from "./url-normalization.js";
import { isSystemUmbrellaCollege } from "./system-umbrella-institutions.js";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKeyPart(value) {
  return clean(value).toLowerCase();
}

function normalizedUrlKey(url) {
  return canonicalizeUrl(url) || normalizeKeyPart(url);
}

// Groups jobs by (normalized url, normalized title) and drops any
// umbrella-labeled copy that collides with exactly one specific-campus
// label. Returns the filtered array plus a report of what was dropped, so
// callers (a one-off migration script, or the scrape pipeline itself) can
// log/audit what happened.
export function consolidateSystemUmbrellaDuplicates(jobs) {
  if (!Array.isArray(jobs)) return { jobs: jobs || [], dropped: [] };

  const groups = new Map();
  jobs.forEach((job, index) => {
    const url = clean(job?.url);
    const title = normalizeKeyPart(job?.titleClean || job?.title || "");
    if (!url || !title) return;
    const sig = `${normalizedUrlKey(url)}|${title}`;
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(index);
  });

  const toDrop = new Set();
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;

    const umbrellaIndices = indices.filter((i) => isSystemUmbrellaCollege(jobs[i]?.college));
    if (umbrellaIndices.length === 0) continue; // no umbrella label in this group -- not this bug

    const specificColleges = new Set(
      indices
        .filter((i) => !isSystemUmbrellaCollege(jobs[i]?.college))
        .map((i) => normalizeKeyPart(jobs[i]?.college))
        .filter(Boolean)
    );
    // Only safe when there's exactly one distinct specific-campus label to
    // consolidate onto. Zero means every copy is umbrella-labeled (nothing
    // to prefer); two or more means the URL is shared by genuinely
    // different specific campuses (a Crafton Hills/San Bernardino Valley
    // style either-campus posting) and must be left alone.
    if (specificColleges.size !== 1) continue;

    for (const i of umbrellaIndices) toDrop.add(i);
  }

  if (toDrop.size === 0) return { jobs, dropped: [] };

  const dropped = [];
  const kept = jobs.filter((job, index) => {
    if (!toDrop.has(index)) return true;
    dropped.push({ url: job?.url || null, title: job?.title || null, college: job?.college || null });
    return false;
  });

  return { jobs: kept, dropped };
}
