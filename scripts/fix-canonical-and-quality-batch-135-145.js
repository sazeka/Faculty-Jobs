#!/usr/bin/env node
// One-off combined migration for issues #135, #137, #138, #139, #140, #143,
// #144, #145 -- all land in one PR because they ultimately rewrite the same
// two ~23k-record files (public/jobs.json, docs/jobs.json), and running them
// as separate passes would produce unmergeable conflicts. Each step below
// reuses the exact same building blocks the live pipeline now uses (so this
// script can never resolve a record differently than a fresh scrape would),
// following the pattern of scripts/fix-system-umbrella-duplicate-urls.js
// (#119/PR #147) and scripts/fix-institution-name-location-placeholders.js
// (#120/PR #154).
//
// Order matters: title/college/URL corrections run BEFORE the final
// canonical-ID recompute, so IDs are derived from the corrected values (see
// the coordination note on issue #135).
//
//   1. #138 -- drop the one Christopher Newport record whose scraped "url" is
//      a bare homepage and whose "title" is an institutional marketing
//      paragraph (no real posting was ever captured for it).
//   2. #137 -- repair the 13 PageUp/"nau-search" records whose location is a
//      credential/rank/instruction fragment instead of a city.
//   3. #143 -- repair NY source-ownership misattribution (Geneseo, Brockport,
//      Monroe CC, Erie CC).
//   4. #138 -- repair the remaining 28 known-bad titles (17 bot-challenge
//      Houston/TCU records via a title derived from their own URL slug; 6
//      records via the college-name-truncation helper; 4 ASU Mid-South
//      records via a hand-reviewed title from their URL slug), then
//      re-normalize every title through the fixed normalizeJobTitle() so any
//      other latent instance of the same ATS-noise patterns self-heals too.
//   5. #144 -- collapse doubled Workday "/job/" URL segments.
//   6. #139 -- rewrite PeopleAdmin bookmark URLs to their tenant's stable
//      "/postings/{id}" path and drop the resulting exact-URL duplicates.
//   7. #140 -- re-audit institution-title-conflict quality flags with the
//      fixed detector.
//   8. #145 -- reclassify tenureTrack for the 11 UW WOT records whose stored
//      value contradicted their own title.
//   9. #135 -- recompute canonicalGroupId/canonicalJobId for every record
//      with the new (requisition-ID-aware) hash, now that every field it's
//      derived from is corrected.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeJobTitle,
  truncateTitleAtEmbeddedCollegeName,
  isPlausibleCityStateLocation,
} from "../server.js";
import { repairKnownSourceOwnership } from "./lib/institution-attribution.js";
import {
  canonicalizeUrl,
  isPeopleAdminBookmarkUrl,
  hasDuplicateWorkdayJobSegments,
} from "./lib/url-normalization.js";
import { attachCanonicalIds } from "./lib/canonical-id.js";
import { institutionTitleConflict } from "../web-vue/src/lib/listingTrust.js";
import { normalizeTenureTrack } from "../web-vue/src/lib/jobClassification.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
const TARGETS = ["public/jobs.json", "docs/jobs.json"];
const REPORT_PATH = path.join(ROOT, "generated", "canonical-and-quality-batch-135-145-fix-report.json");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Step 1 (#138): drop the Christopher Newport marketing-paragraph record.
// ---------------------------------------------------------------------------
const CNU_MARKETING_PARAGRAPH_URL = "https://cofvirginia.peopleadmin.com/";

// ---------------------------------------------------------------------------
// Step 2 (#137): PageUp/"nau-search" credential/rank fragments stored as
// `location`, keyed by the record's own URL (each URL's real source page
// confirms the correct city/state -- see issue #137's table).
// ---------------------------------------------------------------------------
const LOCATION_FIXES_BY_URL = new Map([
  ["https://careers.nmsu.edu/jobs/assistant-or-associate-professor-social-work-las-cruces-new-mexico-united-states", "Las Cruces, NM"],
  ["https://careers.lsuhsc.edu/jobs/assistant-professor-associate-professor-professor-clinical-ob-gyn-new-orleans-louisiana-united-states-2394eb05-9c35-427b-a7e9-f3d5747b568b", "New Orleans, LA"],
  // Found during verification of the issue's 8 illustrative examples: a
  // second LSUHSC record has the same "location is actually a truncated
  // rank/qualifier fragment" bug ("ASSOCIATE PROFESSOR, OR" -- "OR" read as
  // Oregon, not the rest of "Associate Professor or Professor"). This brings
  // the confirmed count to the issue's reported 14 (13 without this one).
  ["https://careers.lsuhsc.edu/jobs/assistant-professor-associate-professor-or-professor-clinical-psychiatry-baton-rouge-louisiana-united-states", "Baton Rouge, LA"],
  ["https://careers.utoledo.edu/jobs/assistant-associate-professor-or-professor-ob-gyn-gyn-subspecialist-health-science-campus-college-toledo-oh-ohio-united-states", "Toledo, OH"],
  ["https://vcujobs.com/jobs/asst-assoc-professor-bs-pharmaceutical-sciences-medicinal-chemistry-mcv-main-campus-virginia-united-states", "Richmond, VA"],
  ["https://vcujobs.com/jobs/asst-assoc-professor-bs-pharmaceutical-sciences-pharmaceutics-mcv-main-campus-virginia-united-states", "Richmond, VA"],
  ["https://jobs.okstate.edu/jobs/clinical-assistant-professor-emergency-medicine-tulsa-oklahoma-united-states", "Tulsa, OK"],
  ["https://jobs.okstate.edu/jobs/clinical-assistant-professor-psychiatry-inpatient-tulsa-oklahoma-united-states", "Tulsa, OK"],
  ["https://jobs.okstate.edu/jobs/clinical-assistant-professor-pediatrics-hospitalist-210922-tulsa-oklahoma-united-states", "Tulsa, OK"],
  ["https://jobs.tcu.edu/jobs/film-tv-digital-media-faculty-adjunct-pool-tcu-main-campus-texas-united-states-434b27d5-f244-42ac-894f-dd12163f22c9", "TCU Main Campus, TX"],
  ["https://explore.msujobs.msstate.edu/jobs/instructor-i-ii-or-iii-main-campus-starkville-ms-mississippi-united-states-49a7227d-892b-44dc-8563-cc3710dba950", "Starkville, MS"],
  ["https://explore.msujobs.msstate.edu/jobs/instructor-i-ii-or-iii-main-campus-starkville-ms-mississippi-united-states-98228e8d-a74c-4619-80fc-8085a9612f25", "Starkville, MS"],
  ["https://explore.msujobs.msstate.edu/jobs/instructor-i-ii-or-iii-main-campus-starkville-ms-mississippi-united-states-8cb7f513-f935-40ba-8f86-2fbf1b034f0c", "Starkville, MS"],
  ["https://careers.uh.edu/jobs/post-doctoral-fellow-concurrency-high-performance-computing-and-quantum-computing-houston-texas-united-states", "Houston, TX"],
]);

// ---------------------------------------------------------------------------
// Step 4 (#138): known-bad titles that the fixed normalizeJobTitle() cannot
// fully repair on its own, keyed by URL. The bot-challenge and ASU Mid-South
// titles are replaced by a title reviewed against the record's own URL slug
// (the real posting name, since the captured title text is bot-challenge
// boilerplate or a truncated description with no real title left in it). The
// college-name-truncation entries recover the real, pre-concatenation title
// exactly (truncateTitleAtEmbeddedCollegeName cuts precisely at the point the
// job's own `college` value was glued onto the end of the real title) and are
// applied by college-name lookup below rather than listed individually here.
// ---------------------------------------------------------------------------
const TITLE_FIXES_BY_URL = new Map([
  ["https://careers.uh.edu/jobs/professor-of-practice-construction-management-program-houston-texas-united-states", "Professor of Practice - Construction Management Program"],
  ["https://careers.uh.edu/jobs/adjunct-urban-education-houston-texas-united-states", "Adjunct - Urban Education"],
  ["https://careers.uh.edu/jobs/post-doctoral-fellow-concurrency-high-performance-computing-and-quantum-computing-houston-texas-united-states", "Post-Doctoral Fellow - Concurrency, High-Performance Computing, and Quantum Computing"],
  ["https://jobs.tcu.edu/jobs/college-of-education-adjunct-pool-educational-leadership-and-or-higher-education-tcu-main-campus-texas-united-states-9fa3c3f2-ff80-4e7a-bb4b-3f558b8faee6", "College of Education Adjunct Pool - Educational Leadership and/or Higher Education"],
  ["https://jobs.tcu.edu/jobs/college-of-education-adjunct-pool-educational-studies-and-or-foundations-tcu-main-campus-texas-united-states-f52f4425-77f0-496c-8da9-ab56b60eea46", "College of Education Adjunct Pool - Educational Studies and/or Foundations"],
  ["https://jobs.tcu.edu/jobs/college-of-education-adjunct-pool-elementary-teacher-education-tcu-main-campus-texas-united-states-5ca65317-a219-4565-9fd0-e098587cde73", "College of Education Adjunct Pool - Elementary Teacher Education"],
  ["https://jobs.tcu.edu/jobs/college-of-education-adjunct-pool-special-education-tcu-main-campus-texas-united-states-eb90b4f2-5852-402c-8b66-1aacda81d837", "College of Education Adjunct Pool - Special Education"],
  ["https://careers.uh.edu/jobs/adjunct-faculty-educational-leadership-and-policy-studies-elps-special-populations-program-houston-texas-united-states", "Adjunct Faculty - Educational Leadership and Policy Studies (ELPS), Special Populations Program"],
  ["https://careers.uh.edu/jobs/lecturer-engineering-data-science-and-ai-houston-texas-united-states", "Lecturer - Engineering Data Science and AI"],
  ["https://careers.uh.edu/jobs/adjunct-english-houston-texas-united-states-2613d1c5-a108-48f9-adfc-5f07545c9c5e", "Adjunct - English"],
  ["https://careers.uh.edu/jobs/adjunct-part-of-term-english-houston-texas-united-states-02947dfd-f40d-43f7-8dec-9d5ff2990d29", "Part-of-Term Adjunct - English"],
  ["https://careers.uh.edu/jobs/adjunct-psychology-houston-texas-united-states", "Adjunct - Psychology"],
  ["https://careers.uh.edu/jobs/adjunct-social-sciences-houston-texas-united-states", "Adjunct - Social Sciences"],
  ["https://careers.uh.edu/jobs/adjunct-business-administration-houston-texas-united-states-5ee018b2-bbcf-4acc-baa2-19b59124921e", "Adjunct - Business Administration"],
  ["https://careers.uh.edu/jobs/adjunct-marketing-houston-texas-united-states-402063d6-e9e4-4231-a358-68b76c1cc1bc", "Adjunct - Marketing"],
  ["https://careers.uh.edu/jobs/adjunct-instructor-field-experience-houston-texas-united-states-f11f1f7c-1bc8-4edb-b279-7b753a1a7d83", "Adjunct Instructor - Field Experience"],
  ["https://careers.uh.edu/jobs/adjunct-social-work-houston-texas-united-states-b60630bc-0674-4966-bd18-c23a94b92360", "Adjunct - Social Work"],
  ["https://asumidsouth.edu/jobs/adjunct-faculty-mechatronics", "Adjunct Faculty - Mechatronics"],
  ["https://asumidsouth.edu/jobs/information-systems-technology-instructor", "Information Systems Technology Instructor"],
  ["https://asumidsouth.edu/jobs/medical-professions-instructor", "Medical Professions Instructor"],
  ["https://asumidsouth.edu/jobs/welding-technology-instructor", "Welding Technology Instructor"],
]);

// Colleges whose concatenated-field titles the truncation helper recovers
// exactly (verified individually below in the audit output).
const COLLEGE_NAME_TRUNCATION_COLLEGES = new Set([
  "Luther College",
  "Oblate School of Theology",
  "Mitchell Hamline School of Law",
]);

function main() {
  const sourcePath = path.join(ROOT, TARGETS[0]);
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  let jobs = source.jobs;
  const before = jobs.length;

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    before,
    issues: {},
  };

  // -- Step 1 (#138): drop the CNU marketing-paragraph non-posting -----------
  const droppedNonPostings = jobs.filter((j) => j.url === CNU_MARKETING_PARAGRAPH_URL);
  jobs = jobs.filter((j) => j.url !== CNU_MARKETING_PARAGRAPH_URL);
  report.issues["138_dropped_non_postings"] = droppedNonPostings.map((j) => ({ url: j.url, title: j.title, college: j.college }));

  // -- Step 2 (#137): PageUp/nau-search bad locations -------------------------
  let locationsFixed = 0;
  const locationFixSamples = [];
  jobs = jobs.map((job) => {
    const fix = LOCATION_FIXES_BY_URL.get(job.url);
    if (!fix || job.location === fix) return job;
    locationsFixed += 1;
    locationFixSamples.push({ url: job.url, before: job.location, after: fix });
    return { ...job, location: fix };
  });
  // Invariant check: no remaining PageUp/nau-search-style bad location should
  // still look implausible after the fix -- surfaces anything the hand list
  // above missed (there should be none).
  const remainingImplausible = jobs.filter((j) => j.location && /^[A-Za-z .'-]{2,60},\s*[A-Z]{2}$/.test(j.location) && !isPlausibleCityStateLocation(j.location));
  report.issues["137_location_fixes"] = { fixedCount: locationsFixed, samples: locationFixSamples, remainingImplausibleCount: remainingImplausible.length };

  // -- Step 3 (#143): NY source-ownership misattribution ----------------------
  let sourceOwnershipFixed = 0;
  const sourceOwnershipSamples = [];
  jobs = jobs.map((job) => {
    const repaired = repairKnownSourceOwnership(job);
    if (repaired !== job) {
      sourceOwnershipFixed += 1;
      if (sourceOwnershipSamples.length < 20) {
        sourceOwnershipSamples.push({ url: job.url, before: { college: job.college, location: job.location }, after: { college: repaired.college, location: repaired.location } });
      }
    }
    return repaired;
  });
  report.issues["143_source_ownership_fixes"] = { fixedCount: sourceOwnershipFixed, samples: sourceOwnershipSamples };

  // -- Step 4 (#138): title repairs, then a full re-normalization pass -------
  let titlesHandFixed = 0;
  let titlesTruncated = 0;
  jobs = jobs.map((job) => {
    let title = job.title;
    const handFix = TITLE_FIXES_BY_URL.get(job.url);
    if (handFix) {
      // Idempotency guard: only count/apply this as a fix when the title
      // doesn't already match (a rerun against a base where this record was
      // already fixed -- e.g. by a prior pass of this same script -- must not
      // re-report it as freshly fixed).
      if (handFix !== title) titlesHandFixed += 1;
      title = handFix;
    } else if (COLLEGE_NAME_TRUNCATION_COLLEGES.has(job.college)) {
      const truncated = truncateTitleAtEmbeddedCollegeName(title, job.college);
      if (truncated !== title) {
        titlesTruncated += 1;
        title = truncated;
      }
    }
    return title === job.title ? job : { ...job, title };
  });

  // Re-normalize every title with the fixed cleaner (strips "Position Type
  // ... Job Details" / "View position and apply" / domain+"ago" / "Posted N
  // ... ago" tails and the bot-challenge prefix) so any other latent instance
  // of the same contamination patterns self-heals the same way a fresh scrape
  // now would, not just the individually reviewed records above.
  let titlesRenormalized = 0;
  const renormalizeSamples = [];
  jobs = jobs.map((job) => {
    if (!job.title) return job;
    let after;
    try { after = normalizeJobTitle(job.title); } catch { after = job.title; }
    if (!after || after === job.title) return job;
    titlesRenormalized += 1;
    if (renormalizeSamples.length < 60) renormalizeSamples.push({ url: job.url, before: job.title, after });
    return { ...job, title: after };
  });
  report.issues["138_title_fixes"] = {
    handFixedCount: titlesHandFixed,
    collegeNameTruncatedCount: titlesTruncated,
    renormalizedCount: titlesRenormalized,
    renormalizeSamples,
  };

  // -- Step 5 (#144) + Step 6 (#139): URL normalization + bookmark dedup -----
  // canonicalizeUrl() now also collapses doubled Workday "/job/" segments and
  // rewrites PeopleAdmin "/bookmarks?posting_id=N" actions to that tenant's
  // stable "/postings/N" path (see scripts/lib/url-normalization.js). Track
  // which records were bookmarks/duplicated-Workday-URLs BEFORE rewriting so
  // the report -- and the dedup preference below -- can attribute the change
  // to the right issue.
  let workdayUrlsFixed = 0;
  let bookmarksRewritten = 0;
  const enriched = jobs.map((job) => {
    const wasBookmark = isPeopleAdminBookmarkUrl(job.url);
    const hadDuplicateWorkdaySegments = hasDuplicateWorkdayJobSegments(job.url);
    const canonicalUrl = canonicalizeUrl(job.url) || job.url;
    if (hadDuplicateWorkdaySegments && canonicalUrl !== job.url) workdayUrlsFixed += 1;
    if (wasBookmark && canonicalUrl !== job.url) bookmarksRewritten += 1;
    return { job: canonicalUrl === job.url ? job : { ...job, url: canonicalUrl }, wasBookmark };
  });

  // Dedupe by the now-canonicalized URL. When a bookmark's rewritten URL
  // collides with an already-real "/postings/{id}" record (issue #139's 204
  // duplicate cases), keep the non-bookmark-origin copy -- it carries the
  // real posting description, not PeopleAdmin's "session expired" boilerplate
  // -- rather than whichever happened to appear first in the array. This pass
  // also incidentally absorbs a handful of pre-existing exact-URL duplicate
  // records that have nothing to do with bookmarks (two identical scrapes of
  // the very same URL, unrelated to #139) -- tracked separately below so the
  // reported #139 count reflects only bookmark-driven duplicates.
  const byUrl = new Map();
  const bookmarkDuplicatesDropped = [];
  const preexistingExactUrlDuplicatesDropped = [];
  for (const { job, wasBookmark } of enriched) {
    const key = String(job.url || "").toLowerCase();
    if (!key || !byUrl.has(key)) {
      byUrl.set(key, { job, wasBookmark });
      continue;
    }
    const existing = byUrl.get(key);
    const involvesBookmark = existing.wasBookmark || wasBookmark;
    if (existing.wasBookmark && !wasBookmark) {
      // Existing entry was itself a rewritten bookmark; prefer this
      // non-bookmark copy instead.
      (involvesBookmark ? bookmarkDuplicatesDropped : preexistingExactUrlDuplicatesDropped).push({ url: job.url, title: existing.job.title });
      byUrl.set(key, { job, wasBookmark });
    } else {
      (involvesBookmark ? bookmarkDuplicatesDropped : preexistingExactUrlDuplicatesDropped).push({ url: job.url, title: job.title });
    }
  }
  jobs = [...byUrl.values()].map((entry) => entry.job);
  report.issues["144_workday_url_fixes"] = { fixedCount: workdayUrlsFixed };
  report.issues["139_bookmark_fixes"] = {
    bookmarksRewrittenCount: bookmarksRewritten,
    duplicatesDroppedCount: bookmarkDuplicatesDropped.length,
    duplicatesDroppedSamples: bookmarkDuplicatesDropped.slice(0, 20),
  };
  report.issues["preexisting_exact_url_duplicates_dropped"] = {
    note: "Not part of issue #139 -- exact-URL duplicate records unrelated to PeopleAdmin bookmarks, incidentally cleaned up by the same URL-based dedup pass.",
    droppedCount: preexistingExactUrlDuplicatesDropped.length,
    samples: preexistingExactUrlDuplicatesDropped.slice(0, 20),
  };

  // -- Step 7 (#140): re-audit institution-title-conflict quality flags ------
  let conflictFlagsCleared = 0;
  const conflictSamples = [];
  jobs = jobs.map((job) => {
    if (!Array.isArray(job.qualityFlags) || !job.qualityFlags.includes("institution-title-conflict")) return job;
    const stillConflicts = institutionTitleConflict(job.titleClean || job.title || "", job.college);
    if (stillConflicts) return job;
    conflictFlagsCleared += 1;
    if (conflictSamples.length < 20) conflictSamples.push({ url: job.url, title: job.title, college: job.college });
    const flags = job.qualityFlags.filter((f) => f !== "institution-title-conflict");
    return flags.length ? { ...job, qualityFlags: flags } : (() => { const { qualityFlags, ...rest } = job; return rest; })();
  });
  report.issues["140_institution_conflict_reaudit"] = { clearedCount: conflictFlagsCleared, samples: conflictSamples };

  // -- Step 8 (#145): reclassify UW WOT tenureTrack ---------------------------
  let tenureFixed = 0;
  const tenureSamples = [];
  jobs = jobs.map((job) => {
    if (job.tenureTrack !== true) return job;
    const reclassified = normalizeTenureTrack(job.tenureTrack, job.titleClean || job.title || "", job.college || "");
    if (reclassified === job.tenureTrack) return job;
    tenureFixed += 1;
    if (tenureSamples.length < 20) tenureSamples.push({ url: job.url, title: job.title, college: job.college });
    return { ...job, tenureTrack: reclassified };
  });
  report.issues["145_tenure_fixes"] = { fixedCount: tenureFixed, samples: tenureSamples };

  // -- Step 9 (#135): recompute canonical IDs with the new formula -----------
  const beforeGroupCount = new Set(jobs.map((j) => j.canonicalGroupId)).size;
  jobs = attachCanonicalIds(jobs);
  const afterGroupCount = new Set(jobs.map((j) => j.canonicalGroupId)).size;
  report.issues["135_canonical_ids"] = {
    recordCount: jobs.length,
    groupCountBefore: beforeGroupCount,
    groupCountAfter: afterGroupCount,
    groupsGained: afterGroupCount - beforeGroupCount,
  };

  report.after = jobs.length;
  report.netRecordChange = jobs.length - before;

  console.log(JSON.stringify(report, null, 2).slice(0, 4000));

  // The report artifact itself is never destructive (it doesn't touch
  // public/jobs.json or docs/jobs.json), so write it even on --dry-run --
  // that's the whole point of a dry run: inspect exactly what the real run
  // would do before committing to it.
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n(Full report written to ${REPORT_PATH}${DRY_RUN ? " -- dry run, jobs.json files NOT modified" : ""})`);

  if (!DRY_RUN) {
    const output = { ...source, count: jobs.length, jobs };
    for (const relative of TARGETS) {
      fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`);
    }
  }
}

main();
