// Institution labels that are scraper catch-all artifacts, not real,
// independently browsable campuses -- see issue #119.
//
// Some sources are scraped under BOTH a specific-campus configuration (which
// correctly attributes each posting to the campus that's actually hiring)
// AND a system-wide/umbrella configuration that has no way to tell which
// campus within the system a given posting belongs to, so it labels every
// posting with the system's own name. When the same requisition is picked up
// by both configurations, it ends up in the dataset twice under the exact
// same source URL and title, differing only in `college` -- once correctly
// attributed, once under the generic umbrella label.
//
// This is a narrower, more conservative fix than adding a blanket name alias
// to institution-aliases.js: an alias permanently renames *every* posting
// under the alias to the canonical name, which is wrong here because the
// umbrella label also carries postings for OTHER campuses in the system that
// were never separately scraped (e.g. University of Hawaii System carries
// postings for Manoa, Hilo, Maui College, and several community colleges,
// not just West Oahu) -- renaming all of them to one specific campus would
// misattribute those. Instead, `duplicate-url-consolidation.js` only acts
// when a *specific* posting collides by exact URL with a specific-campus
// copy, leaving the umbrella label's other, non-duplicated postings alone.
//
// Verified (2026-09-17) against data/institutions-master.json and
// public/jobs.json:
//  - "University of Hawaii System": unitid is null (not a real IPEDS
//    institution); homepage_url is a schooljobs.com job-search link, not a
//    campus site. Its duplicate-URL postings show a generic "Honolulu, HI"
//    location and a department string that just echoes the title, while the
//    specific-campus copy (e.g. West Oahu) carries the real campus location
//    and department.
//  - "UW System Comprehensives": unitid is null; homepage_url is the shared
//    Workday board (wisconsin.wd1.myworkdayjobs.com/UW_Comprehensives), and
//    its duplicate-URL postings show "Madison, WI" (the system HQ, not the
//    hiring campus) against the specific campus's real city.
//  - "University of Alaska System": unitid is null; homepage_url is a
//    careers.alaska.edu job-search link.
//  - "Indiana University" (the bare label, distinct from
//    "Indiana University-Bloomington" etc.): homepage_url is a
//    peopleadmin.com postings-search link, not a campus site. Its
//    duplicate-URL postings are byte-for-byte identical (same location,
//    same department) to the specific-campus copy.
//  - "University of Connecticut" (the bare label, distinct from
//    "University of Connecticut-Avery Point"): homepage_url is a
//    pageuppeople.com job-listing link, not uconn.edu.
//  - "University of Arkansas System Office" (issue #159): homepage_url is a
//    uasys.edu/system-office/jobs/ page whose ATS hand-off lands on the
//    unscoped "/UASYS" Workday tenant that Fayetteville ("University of
//    Arkansas") and UAMS ("University of Arkansas for Medical Sciences")
//    also each have their own hiringCompany-scoped source on. Verified live
//    against that tenant's own hiringCompany facet: the genuine "University
//    of Arkansas System" hiringCompany has exactly 1 non-faculty posting of
//    its own, while every "System Office"-labeled FACULTY posting duplicates
//    a requisition ID already correctly attributed to Fayetteville or UAMS
//    (see consolidateWorkdayRequisitionDuplicates() in
//    duplicate-url-consolidation.js, needed here because the duplicate and
//    the original are exposed at different Workday site paths with a
//    terminal "-1"/"-2" copy suffix, not an identical URL).
//
// Deliberately EXCLUDED, and must stay excluded:
//  - "Crafton Hills College" / "San Bernardino Valley College": both are
//    real, independently accredited colleges with their own .edu homepages
//    that share one district job board. Issue #133 / PR #134 investigated
//    this pair specifically and confirmed with the maintainer that genuine
//    either-campus ("and/or") postings should keep matching both campuses
//    rather than being collapsed into one record -- do not add either name
//    here.
//  - "Miami University-Hamilton" / "Miami University-Middletown": both are
//    real regional campuses with their own homepages that share a job
//    board; only ~70% of their postings overlap by URL (see issue #119
//    investigation notes), consistent with genuinely distinct campus-scoped
//    hiring that happens to share some pooled/either-campus postings, the
//    same shape as Crafton Hills/San Bernardino Valley. Do not add either
//    name here without the same kind of per-pair verification #134 did.
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();

const SYSTEM_UMBRELLA_COLLEGES = new Set(
  [
    "University of Hawaii System",
    "UW System Comprehensives",
    "University of Alaska System",
    "Indiana University",
    "University of Connecticut",
    "University of Arkansas System Office",
  ].map(key)
);

export function isSystemUmbrellaCollege(collegeName) {
  return SYSTEM_UMBRELLA_COLLEGES.has(key(collegeName));
}
