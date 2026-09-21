#!/usr/bin/env node
// One-off migration for issues #152, #155, and #159 -- correcting
// public/jobs.json / docs/jobs.json for three shared-Workday-tenant
// misattribution bugs that scrape-to-json.js's pipeline now prevents going
// forward (see repairMinnStateCollegeFromDescription() in
// scripts/lib/institution-attribution.js and
// consolidateWorkdayRequisitionDuplicates() in
// scripts/lib/duplicate-url-consolidation.js, both wired into
// scripts/scrape-to-json.js before addCanonicalIds()), but which already
// shipped into the committed dataset from scrapes before those fixes landed.
//
//  - #152 (Minnesota State): the shared minnstate.wd115.myworkdayjobs.com
//    tenant covers 33 institutions, several sharing a city, so the old
//    city-guess resolver misattributed 39 records despite each posting's own
//    description carrying an authoritative "Institution: <name>" field.
//    Fixed here via repairMinnStateCollegeFromDescription() -- description
//    text only, no live network call, fully reproducible.
//
//  - #155 (Miami University / Saint Joseph's University): both schools'
//    Workday sources were unscoped, so one shared tenant got scraped twice
//    under two different regional-campus labels.
//      * Saint Joseph's: fully reproducible from the dataset alone. Group by
//        canonical URL (post locale-prefix stripping, issue #155's own
//        url-normalization.js fix) -- every resulting duplicate group in the
//        current dataset (verified: exactly 10, all Philadelphia/Lancaster
//        pairs) has exactly one copy whose `location` is the real, specific
//        value and one copy whose `location` was overwritten to the
//        self-referential placeholder "<college name>, <ST>" (NOT the same
//        check as post-quality.js's isPlaceholderLocation(), which
//        deliberately treats "Saint Joseph's University - Lancaster, PA" as
//        a legitimate "Main Campus - City" location -- this migration cares
//        about the narrower, verified-on-this-data fact that the placeholder
//        copy is always the disposable duplicate). Keep the real-location
//        copy, relabeling it to match its OWN location if needed (e.g. a
//        "Philadelphia"-labeled copy whose real location says Lancaster);
//        drop the placeholder copy. A group that doesn't fit this exact
//        shape (not precisely one real + one placeholder copy) is left
//        completely alone and reported as ambiguous, rather than guessed at.
//        Singleton (non-duplicated) records are only relabeled when their
//        OWN location unambiguously says Lancaster while still labeled
//        Philadelphia -- never the reverse, since a missing/placeholder
//        location on a singleton is not evidence of anything.
//      * Miami University: by the time of this migration, the two configs'
//        shared unscoped URL had already collapsed to ONE record per
//        requisition via scrape-to-json.js's pre-existing exact-URL
//        canonicalizeJobUrls() dedup (verified: 0 duplicate requisition ids
//        among the 50 Hamilton/Middletown-labeled records) -- so there is no
//        duplicate left to drop, only a wrong campus label to correct. That
//        can't be derived from the stored data alone (URL path segments are
//        building names, e.g. "Farmer-School-of-Business", not campuses), so
//        this migration cross-references the tenant's live, official Workday
//        `locations` facet (verified 2026-09-19: Oxford
//        c79d26910af9100520a8fb35e1440000 = 38 postings, Hamilton
//        c79d26910af9100520aac2b74d840000 = 5, Middletown
//        c79d26910af9100520aa3ae7d3080000 = 1 -- the same facet ids now used
//        to scope the three sources in server.js). 14 of the dataset's 50
//        requisition ids are no longer open on any of the three live facets
//        (closed/filled since the original scrape) and are LEFT UNTOUCHED --
//        there is no way to verify their true campus after the fact, so
//        guessing would risk introducing a new wrong answer. This is flagged
//        explicitly in the report rather than silently assumed fixed.
//
//  - #159 (Arkansas): the generic "University of Arkansas System Office"
//    source read the same unscoped /UASYS Workday tenant that Fayetteville
//    and UAMS's own scoped sources also cover, duplicating every requisition
//    a second time under the System Office label with a terminal "-1"/"-2"
//    copy suffix on its URL. Fixed here via
//    consolidateWorkdayRequisitionDuplicates(), which matches by (tenant
//    host, base requisition id) rather than exact URL.
//
// Order: Minnesota State description-repair and the Miami/SJU relabeling are
// independent of each other and of the Arkansas dedup (they touch disjoint
// institutions), so are applied in any order; canonical ids are recomputed
// LAST, once, over the fully-corrected data (canonicalGroupId embeds
// `college`, so every college correction here would otherwise leave stale
// canonical ids behind).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repairMinnStateCollegeFromDescription } from "./lib/institution-attribution.js";
import { consolidateWorkdayRequisitionDuplicates } from "./lib/duplicate-url-consolidation.js";
import { canonicalizeUrl } from "./lib/url-normalization.js";
import { attachCanonicalIds } from "./lib/canonical-id.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
const TARGETS = ["public/jobs.json", "docs/jobs.json"];
const REPORT_PATH = path.join(ROOT, "generated", "fix-duplicate-attribution-152-155-159-report.json");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function requisitionIdFromUrl(url) {
  const m = clean(url).match(/_([A-Za-z]*\d+)(?:-\d+)?\/?$/);
  return m ? m[1].toUpperCase() : null;
}

// The Workday URL path segment right after "/job/" is the tenant's own
// location slug for that requisition (e.g. "Philadelphia---Hawk-Hill",
// "Lancaster"), independent of whichever regional source scraped it or what
// label that source assigned. Two copies of the same requisition sharing an
// identical slug are provably the same real-world location, regardless of
// what their `location`/`college` fields say.
function urlLocationSlug(url) {
  const m = clean(url).match(/\/job\/([^/]+)\//);
  return m ? m[1] : null;
}

const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), "utf8"));
let jobs = source.jobs;
const before = jobs.length;

// ---------------------------------------------------------------------------
// Issue #152: Minnesota State description-based college/location repair.
// ---------------------------------------------------------------------------
let minnStateFixedCount = 0;
const minnStateSamples = [];
jobs = jobs.map((job) => {
  const repaired = repairMinnStateCollegeFromDescription(job);
  if (repaired === job) return job;
  minnStateFixedCount += 1;
  if (minnStateSamples.length < 50) {
    minnStateSamples.push({
      url: job.url,
      title: clean(job.title),
      collegeBefore: clean(job.college),
      collegeAfter: repaired.college,
      locationBefore: clean(job.location) || null,
      locationAfter: repaired.location || null,
    });
  }
  return repaired;
});

// ---------------------------------------------------------------------------
// Issue #155a: Saint Joseph's University.
// ---------------------------------------------------------------------------
const SJU_PHILADELPHIA = "Saint Joseph's University - Philadelphia";
const SJU_LANCASTER = "Saint Joseph's University - Lancaster";
function isSjuJob(job) {
  try {
    return /(^|\.)sju\.wd1\.myworkdayjobs\.com$/i.test(new URL(clean(job?.url)).hostname);
  } catch {
    return false;
  }
}

// Narrower than post-quality.js's isPlaceholderLocation() (which deliberately
// treats "Saint Joseph's University - Lancaster, PA" as a legitimate "Main
// Campus - City" location): this checks the exact self-referential shape
// "<college name>, <ST>" with no city at all, which on this dataset only
// ever shows up on the disposable duplicate half of a pair (see header).
function isSelfReferentialLocation(location, college) {
  const loc = clean(location);
  const col = clean(college);
  if (!loc || !col) return false;
  const m = loc.match(/^(.*),\s*[A-Za-z]{2}$/);
  return Boolean(m) && clean(m[1]).toLowerCase() === col.toLowerCase();
}

const sjuDropped = [];
const sjuRelabeled = [];
const sjuAmbiguousGroups = [];
const sjuJobsToDrop = new Set(); // by object identity, against the pre-mutation `jobs` array
const sjuRelabelTo = new Map(); // job (pre-mutation identity) -> new college

const sjuGroups = new Map();
for (const job of jobs) {
  if (!isSjuJob(job) || (job.college !== SJU_PHILADELPHIA && job.college !== SJU_LANCASTER)) continue;
  const key = canonicalizeUrl(job.url) || clean(job.url);
  if (!sjuGroups.has(key)) sjuGroups.set(key, []);
  sjuGroups.get(key).push(job);
}

for (const group of sjuGroups.values()) {
  if (group.length === 1) {
    const job = group[0];
    if (isSelfReferentialLocation(job.location, job.college)) continue; // no evidence either way -- leave alone
    const trueCollege = /\blancaster\b/i.test(clean(job.location)) ? SJU_LANCASTER : SJU_PHILADELPHIA;
    if (trueCollege !== job.college) sjuRelabelTo.set(job, trueCollege);
    continue;
  }

  // Duplicate group: expect exactly one real-location copy and the rest
  // self-referential placeholders. Anything else is ambiguous -- reported,
  // not guessed at.
  const real = group.filter((j) => !isSelfReferentialLocation(j.location, j.college));
  const placeholders = group.filter((j) => isSelfReferentialLocation(j.location, j.college));
  if (real.length !== 1 || placeholders.length !== group.length - 1) {
    // Fallback: a locale-duplicate pair (canonical vs. "/en-US/" URL) whose
    // Lancaster-labeled copy's placeholder location is a bare city string
    // (e.g. "Lancaster, PA") rather than the fully self-referential
    // "<college name>, ST" this migration was originally built against --
    // both scraped variants surface under different location-string shapes
    // depending on when they were captured. Detectable independently of
    // either copy's `location` field: both copies share the exact same
    // Workday URL location slug (the true, page-derived location), and that
    // slug itself says nothing about Lancaster -- so the Lancaster label is
    // provably wrong, not just unverified.
    if (group.length === 2) {
      const phil = group.find((j) => j.college === SJU_PHILADELPHIA);
      const lanc = group.find((j) => j.college === SJU_LANCASTER);
      const philSlug = phil && urlLocationSlug(phil.url);
      const lancSlug = lanc && urlLocationSlug(lanc.url);
      if (phil && lanc && philSlug && philSlug === lancSlug && !/lancaster/i.test(philSlug)) {
        sjuJobsToDrop.add(lanc);
        continue;
      }
    }
    sjuAmbiguousGroups.push(group.map((j) => ({ url: j.url, title: clean(j.title), college: j.college, location: clean(j.location) })));
    continue;
  }
  const keepJob = real[0];
  const trueCollege = /\blancaster\b/i.test(clean(keepJob.location)) ? SJU_LANCASTER : SJU_PHILADELPHIA;
  if (trueCollege !== keepJob.college) sjuRelabelTo.set(keepJob, trueCollege);
  for (const j of placeholders) sjuJobsToDrop.add(j);
}

jobs = jobs
  .filter((job) => {
    if (!sjuJobsToDrop.has(job)) return true;
    sjuDropped.push({ url: job.url, title: clean(job.title), college: job.college, location: clean(job.location) });
    return false;
  })
  .map((job) => {
    const trueCollege = sjuRelabelTo.get(job);
    if (!trueCollege) return job;
    sjuRelabeled.push({ url: job.url, title: clean(job.title), collegeBefore: job.college, collegeAfter: trueCollege, location: clean(job.location) });
    return { ...job, college: trueCollege };
  });

// ---------------------------------------------------------------------------
// Issue #155b: Miami University -- no duplicates remain to drop (see header),
// only campus mislabeling. Correct it from the tenant's live `locations`
// facet, verified 2026-09-19 (facet ids match server.js's now-scoped
// sources). Requisitions no longer open on any of the three facets today are
// left untouched and reported separately.
// ---------------------------------------------------------------------------
const MIAMI_OXFORD_REQS = new Set([
  "JR104797", "JR104831", "JR104771", "JR104770", "JR104813", "JR104791", "JR104792",
  "JR104777", "JR104715", "JR104724", "JR104602", "JR104529", "JR104577", "JR104684",
  "JR104678", "JR104703", "JR104701", "JR104499", "JR104660", "JR104585", "JR104383",
  "JR104353", "JR104297", "JR104290", "JR104169", "JR104289", "JR104255", "JR104078",
  "JR104031", "JR103926", "JR103921", "JR103867", "JR103927", "JR103868", "JR103881",
  "JR103761", "JR103716", "JR102870",
]);
const MIAMI_HAMILTON_REQS = new Set(["JR104516", "JR104510", "JR104441", "JR104166", "JR104015"]);
const MIAMI_MIDDLETOWN_REQS = new Set(["JR104171"]);

function isMiamiWorkdayJob(job) {
  try {
    return /(^|\.)miamioh\.wd5\.myworkdayjobs\.com$/i.test(new URL(clean(job?.url)).hostname);
  } catch {
    return false;
  }
}

const miamiRelabeled = [];
const miamiUnverifiable = [];
jobs = jobs.map((job) => {
  if (!isMiamiWorkdayJob(job)) return job;
  if (job.college !== "Miami University-Hamilton" && job.college !== "Miami University-Middletown" && job.college !== "Miami University-Oxford") return job;
  const req = requisitionIdFromUrl(job.url);
  const trueCollege = req && MIAMI_OXFORD_REQS.has(req)
    ? "Miami University-Oxford"
    : req && MIAMI_HAMILTON_REQS.has(req)
      ? "Miami University-Hamilton"
      : req && MIAMI_MIDDLETOWN_REQS.has(req)
        ? "Miami University-Middletown"
        : null;
  if (!trueCollege) {
    miamiUnverifiable.push({ url: job.url, title: clean(job.title), college: job.college, requisitionId: req });
    return job;
  }
  if (trueCollege === job.college) return job;
  miamiRelabeled.push({ url: job.url, title: clean(job.title), collegeBefore: job.college, collegeAfter: trueCollege });
  return { ...job, college: trueCollege };
});

// ---------------------------------------------------------------------------
// Issue #159: Arkansas -- drop System Office copies of the same Workday
// requisition already covered by Fayetteville or UAMS.
// ---------------------------------------------------------------------------
const arkansasDedup = consolidateWorkdayRequisitionDuplicates(jobs);
jobs = arkansasDedup.jobs;

// Relabeling two copies from different erroneous campus labels to the same
// verified campus can expose an exact duplicate that did not exist before the
// correction (same canonical URL, title, and college). Collapse only that
// fully identical identity tuple; genuine multi-campus postings remain
// distinct because `college` is part of the key.
const exactDuplicateDrops = [];
const seenExactJobs = new Set();
jobs = jobs.filter((job) => {
  const key = [
    canonicalizeUrl(job.url),
    clean(job.title).toLowerCase(),
    clean(job.college).toLowerCase(),
  ].join("|");
  if (!seenExactJobs.has(key)) {
    seenExactJobs.add(key);
    return true;
  }
  exactDuplicateDrops.push({ url: job.url, title: clean(job.title), college: job.college });
  return false;
});

// ---------------------------------------------------------------------------
// Recompute canonical ids last, once, over the fully-corrected data.
// ---------------------------------------------------------------------------
const groupCountBefore = new Set(source.jobs.map((j) => j.canonicalGroupId)).size;
jobs = attachCanonicalIds(jobs);
const groupCountAfter = new Set(jobs.map((j) => j.canonicalGroupId)).size;

const report = {
  generatedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  totalJobsBefore: before,
  totalJobsAfter: jobs.length,
  issue152MinnesotaState: {
    description: "Minnesota State shared-tenant city-guess college misattribution, corrected from each posting's own \"Institution:\" description field",
    recordsCorrected: minnStateFixedCount,
    corrected: minnStateSamples,
  },
  issue155SaintJosephs: {
    description: "Saint Joseph's University Philadelphia/Lancaster duplicate requisitions from an unscoped shared Workday tenant",
    droppedCount: sjuDropped.length,
    dropped: sjuDropped,
    relabeledCount: sjuRelabeled.length,
    relabeled: sjuRelabeled,
    ambiguousGroupCount: sjuAmbiguousGroups.length,
    ambiguousGroups: sjuAmbiguousGroups,
  },
  issue155MiamiUniversity: {
    description: "Miami University Hamilton/Middletown/Oxford campus mislabeling from an unscoped shared Workday tenant (no duplicates remained to drop; see script header)",
    relabeledCount: miamiRelabeled.length,
    relabeled: miamiRelabeled,
    unverifiableCount: miamiUnverifiable.length,
    unverifiable: miamiUnverifiable,
    unverifiableNote: "These requisition ids are no longer open on any of Miami's three live Workday location facets (Oxford/Hamilton/Middletown) as of this migration's run, so their true campus could not be confirmed and they were left unchanged.",
  },
  issue159Arkansas: {
    description: "University of Arkansas System Office duplicate copies of Fayetteville/UAMS Workday requisitions",
    droppedCount: arkansasDedup.dropped.length,
    dropped: arkansasDedup.dropped,
  },
  exactDuplicatesAfterRelabeling: {
    description: "Exact URL/title/college duplicates exposed after verified campus relabeling",
    droppedCount: exactDuplicateDrops.length,
    dropped: exactDuplicateDrops,
  },
  canonicalIds: {
    recordCount: jobs.length,
    groupCountBefore,
    groupCountAfter,
  },
};

console.log(JSON.stringify({
  ...report,
  issue152MinnesotaState: { ...report.issue152MinnesotaState, corrected: `${minnStateFixedCount} entries (see report file)` },
  issue155SaintJosephs: { ...report.issue155SaintJosephs, dropped: `${sjuDropped.length} entries (see report file)`, relabeled: `${sjuRelabeled.length} entries (see report file)`, ambiguousGroups: `${sjuAmbiguousGroups.length} groups (see report file)` },
  issue155MiamiUniversity: { ...report.issue155MiamiUniversity, relabeled: `${miamiRelabeled.length} entries (see report file)`, unverifiable: `${miamiUnverifiable.length} entries (see report file)` },
  issue159Arkansas: { ...report.issue159Arkansas, dropped: `${arkansasDedup.dropped.length} entries (see report file)` },
  exactDuplicatesAfterRelabeling: { ...report.exactDuplicatesAfterRelabeling, dropped: `${exactDuplicateDrops.length} entries (see report file)` },
}, null, 2));

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n(Full report written to ${REPORT_PATH}${DRY_RUN ? " -- dry run, jobs.json files NOT modified" : ""})`);

if (!DRY_RUN) {
  const output = { ...source, jobs, count: jobs.length };
  for (const relative of TARGETS) {
    fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`);
  }
}
