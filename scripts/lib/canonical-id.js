// Shared canonical-ID logic for jobs.json records (issue #135).
//
// Previously this hash lived twice -- scripts/scrape-to-json.js's
// addCanonicalIds() and scripts/sync-web-data-files.js's attachCanonicalIds()
// -- both hashing only `title|college|department|state`. That key has no
// stable per-posting identity: any two records that happen to share a title,
// college, department, and state collapse into a single canonical group, so
// genuinely different requisitions (different Workday/PeopleAdmin/PageUp
// posting IDs, different campuses/cities, different descriptions and dates)
// were silently merged into one and the frontend rendered only one card for
// several unrelated openings (confirmed at Texas A&M, Ivy Tech, and Michigan
// State).
//
// Fix: prefer a stable ATS requisition/posting ID extracted from the job's
// own URL as the primary identity when one is available (this is exactly the
// signal a "different requisition" implies -- two postings sharing a title,
// college, and department but a different requisition ID are NOT the same
// posting). When no such ID can be extracted, fall back to the historical key
// plus `location`, which still closes most of the same gap (many of the
// over-collapsed groups differed only by city, not by department or state --
// e.g. Ivy Tech's per-campus Workday requisitions all share the same state).
import { createHash } from "node:crypto";

export function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeKeyPart(value) {
  return clean(value).toLowerCase();
}

export function sha1Hex(value) {
  return createHash("sha1").update(String(value || "")).digest("hex");
}

// Query-parameter names, across the ATS platforms in this dataset, that carry
// a stable per-posting identifier. Compared case-insensitively against every
// query key (not just an exact key lookup) so "JobId", "jobId", and "jobid"
// are all recognized without listing every case variant.
const ID_QUERY_KEYS = [
  "posting_id",
  "postingid",
  "jobid",
  "job_id",
  "jobopeningid",
  "requisitionid",
  "req_id",
  "reqid",
  "positionid",
  "opportunityid",
];

// Extracts a stable requisition/posting identifier from a job's URL, or null
// if none of the known shapes match. The identifier is namespaced by which
// pattern produced it so two different platforms' numeric IDs (e.g. a
// PeopleAdmin posting id and a Workday requisition number) can never collide
// just because the raw digits happen to match.
export function extractRequisitionId(url) {
  const raw = clean(url);
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();

  // Query-parameter based IDs (PeopleAdmin bookmarks/postings, TAMU
  // JobDetail.aspx?JobId=..., generic ATS "requisition" params). Namespaced
  // by hostname so the same posting_id on two different tenants (a very real
  // possibility -- PeopleAdmin issues small sequential IDs per tenant) never
  // collides into one canonical group.
  // OneUSG links moved from "#jobId=N" to "?JobOpeningId=N"; keep the id in the
  // original fragment namespace so existing postings keep their canonical ids.
  if (/(^|\.)onehcm\.usg\.edu$/.test(host)) {
    const opening = parsed.searchParams.get("JobOpeningId");
    if (clean(opening)) return `h:${host}:jobid:${normalizeKeyPart(opening)}`;
  }

  for (const [key, value] of parsed.searchParams.entries()) {
    const normalizedKey = key.toLowerCase();
    if (ID_QUERY_KEYS.includes(normalizedKey) && clean(value)) {
      return `q:${host}:${normalizedKey}:${normalizeKeyPart(value)}`;
    }
  }

  // Some Oracle PeopleSoft/Fusion campus-solutions sites (e.g.
  // careers.hprod.onehcm.usg.edu) are single-page apps that encode the
  // posting id in the URL *fragment* rather than the query string, e.g.
  // "...HRS_CG_SEARCH_FL.GBL?FOCUS=Applicant&SiteId=03000#jobId=296346".
  if (parsed.hash) {
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    for (const [key, value] of hashParams.entries()) {
      const normalizedKey = key.toLowerCase();
      if (ID_QUERY_KEYS.includes(normalizedKey) && clean(value)) {
        return `h:${host}:${normalizedKey}:${normalizeKeyPart(value)}`;
      }
    }
  }

  const path = parsed.pathname;

  // PeopleAdmin-style stable posting path: /postings/12345
  const postings = path.match(/\/postings\/(\d+)/i);
  if (postings) return `postings:${host}:${postings[1]}`;

  // PageUp-hosted career sites (careers.pageuppeople.com/{tenant}/cw/en-us/
  // job/{id}, and PageUp white-label domains like jobs.du.edu, careers.scsu.edu)
  // use a purely numeric path segment right after "/job/" as the stable
  // posting id -- confirmed live at SUNY Downstate (issue #135's named
  // example): distinct requisitions such as "Adjunct Assistant Professor,
  // Epidemiology & Biostatistics" posted three separate times share an
  // identical title/college/department and only differ by this id
  // (".../job/497215" vs ".../job/497216" vs ".../job/497217"). The id can be
  // followed by an optional human-readable slug segment
  // (".../job/499139/clinical-preclinical-instructor") -- without allowing
  // that trailing segment, tenants that include it (e.g. UF Health's PageUp
  // instance at careers.pageuppeople.com/876) never matched at all and fell
  // through to the title/college/department fallback, which collapsed
  // several distinct clinical-instructor requisitions into one group. Workday's
  // "/job/{location-slug}/{Title}_R12345" never has a bare numeric segment
  // immediately after "/job/", so this cannot misfire on the Workday pattern
  // below.
  const pageUpJobId = path.match(/\/job\/(\d+)(?:\/[^/]*)?$/i);
  if (pageUpJobId) return `pageup:${host}:${pageUpJobId[1]}`;

  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "";

  // Workday requisition suffix on the final path segment, e.g.
  // ".../Adjunct-Faculty---Biology_JR0000108187" or a reopened/reprinted
  // requisition's "..._JR101035-1" (the "-1" reprint suffix is the same
  // requisition, not a different one, so it is intentionally not captured).
  // Workday tenants vary the prefix and separator: some separate the "R"
  // prefix from the digits with an underscore or hyphen instead of
  // concatenating them directly ("..._R_00048760", "..._R-9828"), and some
  // use "REQ" or "RQ" instead of a bare "R" (Penn State's
  // "..._REQ_0000079176-2", Mass General Brigham's "..._RQ4078908-2"). Two
  // of UT Austin's distinct postings (different requisition numbers,
  // confirmed live: "Postdoctoral-Fellow_R_00048760-1" vs
  // "Postdoctoral-Fellow_R_00046894-1") fell through to the
  // title/college/department fallback below and, sharing an identical
  // generic "Postdoctoral Fellow" title/department, collapsed into one
  // canonical group before the underscore separator was recognized here.
  const workday = last.match(/_(?:JR|REQ|RQ|R)[-_]?(\d{3,})(?:-\d+)?$/i);
  if (workday) return `workday:${host}:JR${workday[1]}`;

  // A handful of Workday tenants (e.g. cmu.wd5.myworkdayjobs.com) omit any
  // letter prefix and use a bare numeric requisition id ("..._2023679"). A
  // reprint "-N" suffix is intentionally not stripped here -- unlike the
  // prefixed case above, where the digit run is unambiguous -- because a
  // bare "_2023679-1" can't be told apart from a tenant that instead uses a
  // "{year}-{sequence}" id shape (handled separately below); either way,
  // missing this rare case just falls through to the safe fallback key.
  const workdayBareNumeric = last.match(/_(\d{6,})$/);
  if (workdayBareNumeric) return `workday:${host}:JR${workdayBareNumeric[1]}`;

  // Other Workday tenants (e.g. slu.wd5.myworkdayjobs.com) use a
  // "{4-digit year}-{sequence}" requisition id ("..._2026-09955", or with a
  // reprint suffix, "..._2021-02690-1"). The hyphen here is part of the id
  // itself, not a reprint marker, so -- unlike the letter-prefixed case
  // above -- only a *further* trailing "-N" is treated as a reprint suffix.
  const workdayYearSequence = last.match(/_(\d{4}-\d{4,})(?:-\d+)?$/);
  if (workdayYearSequence) return `workday:${host}:JR${workdayYearSequence[1]}`;

  // PageUp and several other vendor-hosted career sites (careers.msu.edu,
  // jobs.tcu.edu, jobs.okstate.edu, explore.msujobs.msstate.edu, ...) append a
  // random per-posting UUID as the final URL path segment, after the
  // human-readable slug -- e.g. "...tenure-system-flint-michigan-united-
  // states-895e1923-fc94-4c55-ab79-49f75277e805". Two openings can reuse the
  // exact same title/department/city (Michigan State genuinely posts the
  // identical "Associate/Full Professor of Human Medicine - Tenure System"
  // title at Flint for multiple, materially different searches -- issue
  // #135's confirmed example) yet always get distinct UUIDs, so this closes
  // the same over-collapse gap for this platform that the checks above close
  // for PeopleAdmin/Workday/TAMU.
  const trailingUuid = last.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (trailingUuid) return `uuid:${trailingUuid[1].toLowerCase()}`;

  // Generic "{keyword}/{id}" shapes shared by many otherwise-unrelated ATS
  // vendors (Cornerstone OnDemand's "/requisition/{id}", ApplicantPro's and
  // isolved's and Paycom's and Mount Sinai's Dayforce-hosted "/jobs/{id}",
  // Oracle Fusion Cloud's "/jobs/preview/{id}"). Checked before the bare
  // 32-hex-char id below so a Paycom tenant-portal GUID that happens to
  // precede the real numeric job id in the path (".../portal/{GUID}/jobs/
  // {id}") is never mistaken for the id -- that GUID is the *tenant's*
  // identifier, shared by every job on that portal, not a per-posting one.
  const genericKeywordId = path.match(/\/(?:jobs|careers|requisition|preview)\/(\d+)(?:\/|$)/i);
  if (genericKeywordId) return `kw:${host}:${genericKeywordId[1]}`;

  // A bare 32-hex-char id as its own path segment (e.g. cuny.jobs's
  // "/{slug}/{32-hex}/job").
  const hex32 = segments.find((segment) => /^[0-9a-f]{32}$/i.test(segment));
  if (hex32) return `hex32:${hex32.toLowerCase()}`;

  // BambooHR: <tenant>.bamboohr.com/careers/{id}.
  if (host.endsWith(".bamboohr.com")) {
    const bamboo = path.match(/\/careers\/(\d+)(?:\/|$)/i);
    if (bamboo) return `bamboohr:${host}:${bamboo[1]}`;
  }

  // Interfolio: apply.interfolio.com/{id} -- the id is the entire path.
  if (host === "apply.interfolio.com") {
    const interfolio = path.match(/^\/(\d+)\/?$/);
    if (interfolio) return `interfolio:${interfolio[1]}`;
  }

  // ApplicantStack: <tenant>.applicantstack.com/x/detail/{id}.
  if (host.endsWith(".applicantstack.com")) {
    const stack = path.match(/\/x\/detail\/([a-z0-9]+)$/i);
    if (stack) return `applicantstack:${host}:${stack[1].toLowerCase()}`;
  }

  // NOTE: ApplyToJob (<tenant>.applytojob.com/apply/{id}) was deliberately
  // *not* added here. At ctstatecommunitycollege.applytojob.com, the same
  // "Assistant Professor/Program Coordinator of Radiography" posting shows
  // up under two different /apply/{id} tokens with near-identical (but not
  // byte-identical, so the attachCanonicalIds duplicate-content check below
  // can't catch it) descriptions -- evidence that this platform's id isn't
  // stable enough to trust as a requisition identifier.

  // A trailing hyphen-numeric suffix on an otherwise non-numeric slug
  // segment (SelectMinds' "...jobs/adjunct-assistant-professor-9937", UTMB's
  // "...jobs/assistant-professor-otolaryngology-35602"). Requires at least 2
  // digits so a stray single digit (which, on at least one site in this
  // dataset, turned out to just be an unstable per-scrape ordinal rather
  // than a real id -- see the "no id" test below) doesn't get treated as one.
  const hyphenSuffix = last.match(/[a-z]-(\d{2,})$/i);
  if (hyphenSuffix) return `slug-suffix:${host}:${hyphenSuffix[1]}`;

  // Fallback: a bare, purely-numeric final path segment of reasonable
  // length, when the path also contains a "job" segment (Taleo-style, e.g.
  // careers.duke.edu/job/{slug}/{id}). Requiring the "job" segment keeps this
  // from misfiring on an institution's own CMS pages that happen to end in a
  // content id (e.g. a Drupal "/node/{id}" page) -- those can coexist with a
  // pretty-URL alias for the *same* posting with no id in it at all, so
  // treating the bare content id as a stable requisition id would split that
  // single posting's two URL forms apart instead of keeping them together.
  if (/^\d{5,}$/.test(last) && segments.some((segment) => /^job$/i.test(segment))) {
    return `numeric-tail:${host}:${last}`;
  }

  return null;
}

function fallbackKeyParts(job) {
  const title = normalizeKeyPart(job?.titleClean || job?.title || "");
  const college = normalizeKeyPart(job?.college || "");
  const dept = normalizeKeyPart(job?.department || "");
  const state = normalizeKeyPart(job?.state || job?.source || "");
  const location = normalizeKeyPart(job?.location || "");
  return [title, college, dept, state, location];
}

// Primary grouping key: a stable requisition ID (when one exists) plus
// title/college/department, so genuinely distinct requisitions that happen to
// share a title/college/department never collapse. Falls back to
// title|college|department|state|location, which still distinguishes
// per-campus requisitions that lack an extractable ID (e.g. a scraper that
// hasn't captured the source's posting id) as long as their city differs.
//
// `requisitionIdOverride` lets a caller with visibility across the whole
// dataset (attachCanonicalIds, below) substitute a different id (or force
// null, i.e. "don't trust any id") for one specific record without touching
// extractRequisitionId itself. Standalone callers (including every test in
// canonical-id.test.js) omit it and get the plain per-URL id.
export function computeCanonicalGroupId(job, { requisitionIdOverride } = {}) {
  const title = normalizeKeyPart(job?.titleClean || job?.title || "");
  const college = normalizeKeyPart(job?.college || "");
  const dept = normalizeKeyPart(job?.department || "");
  const requisitionId =
    requisitionIdOverride !== undefined ? requisitionIdOverride : extractRequisitionId(job?.url);

  const keyParts = requisitionId
    ? [title, college, dept, requisitionId]
    : fallbackKeyParts(job);

  return `grp_${sha1Hex(keyParts.join("|")).slice(0, 16)}`;
}

export function computeCanonicalJobId(job, canonicalGroupId) {
  const source = normalizeKeyPart(job?.source || "");
  const url = normalizeKeyPart(job?.url || "");
  const groupId = canonicalGroupId || computeCanonicalGroupId(job);
  return `job_${sha1Hex([groupId, source, url].join("|")).slice(0, 16)}`;
}

// Tiny union-find, used below to merge specific ids within a fallback-key
// cluster (not the whole cluster) when they turn out to share content.
function makeUnionFind() {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  return { find, union };
}

// Extracting a requisition id from only one side of a same-posting mirror
// (a state job board's generic "Application Information" page alongside its
// real governmentjobs.com posting; an institution's own careers page
// alongside its Paycom-hosted listing) would otherwise split that one real
// posting into two canonical groups: the id-bearing URL keys on
// title|college|dept|id while its id-less sibling -- which shares the exact
// same title/college/department/state/location -- keys on the fallback
// tuple instead, and the two never collide again.
//
// This is only detectable with visibility across the whole dataset, which a
// single job record doesn't have. So: group every job by its fallback key
// first, and only trust extracted ids to split a fallback-key group apart
// when at least *two distinct* ids appear within it. A lone id sitting next
// to id-less siblings is exactly the mirror shape above and is more likely a
// scrape artifact than proof that the group holds distinct requisitions;
// real distinct-requisition groups (Texas A&M, Michigan State, SUNY
// Downstate, ...) all show up with as many distinct ids as members, so this
// never weakens the id-preference issue #135 relies on. A fallback group of
// size 1 has no sibling to accidentally split away from, so its own id (if
// any) is always trusted regardless of this count.
//
// A second, independent check: two *different* extracted ids can still be
// the same posting reposted under a new id (confirmed live at West Virginia
// University at Parkersburg's BambooHR tenant -- "/careers/71" and
// "/careers/81" carry byte-identical titles, locations, and full
// descriptions; Austin Community College's Workday tenant shows the exact
// same shape for two different "_R-" requisition numbers). An exact,
// non-empty description match across two ids is strong evidence they're the
// same content, not two different openings, so any such pair of ids is
// unioned into one requisition id -- e.g. Texas A&M has 21 real, distinct
// "Tenure-Track: Assistant Professor" postings that happen to include one
// coincidentally-identical-description pair among them; only that one pair
// merges, the other 19 stay correctly separated. (Merging is scoped to the
// specific ids involved, not the whole fallback-key cluster, precisely so a
// single coincidental match in a large cluster like that one can't revert
// everyone in it back to the pre-issue-#135 over-collapsed behavior.)
function computeRequisitionIdOverrides(jobs) {
  const clustersByFallbackKey = new Map();
  for (const job of jobs) {
    const key = fallbackKeyParts(job).join("|");
    if (!clustersByFallbackKey.has(key)) {
      clustersByFallbackKey.set(key, { members: 0, ids: new Set(), descriptionsById: new Map(), unionFind: makeUnionFind() });
    }
    const cluster = clustersByFallbackKey.get(key);
    cluster.members += 1;

    const id = extractRequisitionId(job?.url);
    if (!id) continue;
    cluster.ids.add(id);

    const description = clean(job?.description);
    if (!description) continue;
    for (const [otherId, otherDescription] of cluster.descriptionsById) {
      if (otherId !== id && otherDescription === description) cluster.unionFind.union(id, otherId);
    }
    cluster.descriptionsById.set(id, description);
  }

  const overrideByJob = new Map();
  for (const job of jobs) {
    const key = fallbackKeyParts(job).join("|");
    const cluster = clustersByFallbackKey.get(key);
    const id = extractRequisitionId(job?.url);

    const trustAnyId = cluster.members === 1 || cluster.ids.size >= 2;
    overrideByJob.set(job, trustAnyId && id ? cluster.unionFind.find(id) : null);
  }
  return overrideByJob;
}

// Assigns canonicalGroupId/canonicalJobId to every job, always recomputing
// from the current field values (title/college/department/state/location/url)
// rather than preserving a previously-stored ID. This is the single choke
// point both the live scrape pipeline (scrape-to-json.js) and the static-site
// sync step (sync-web-data-files.js) now share, instead of each keeping its
// own copy of the hash formula.
export function attachCanonicalIds(jobs) {
  if (!Array.isArray(jobs)) return jobs || [];

  const requisitionIdOverrides = computeRequisitionIdOverrides(jobs);

  return jobs.map((job) => {
    const canonicalGroupId = computeCanonicalGroupId(job, {
      requisitionIdOverride: requisitionIdOverrides.get(job),
    });
    const canonicalJobId = computeCanonicalJobId(job, canonicalGroupId);
    return { ...job, canonicalGroupId, canonicalJobId };
  });
}
