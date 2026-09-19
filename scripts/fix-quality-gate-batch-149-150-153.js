#!/usr/bin/env node
// One-off migration for issues #149, #150, and #153, all fixes to
// confirmedNonFacultyReason() / scorePost() in scripts/lib/post-quality.js:
//
//  - #150: seven-plus Department of Labor / OFLC "Notice of Filing"
//    compliance notices for positions that have already been filled were
//    scoring 99-100 and passing as open jobs. confirmedNonFacultyReason()
//    now returns 'filled_compliance_notice' for these (title contains
//    "Notice of Filing", or the description carries the decisive "please do
//    not apply ... it has been filled" + mandatory-DOL-requirement
//    boilerplate together) -- see isFilledComplianceNotice().
//  - #153: 74 "Faculty & Staff" / "Faculty and Staff" / "Faculty + Staff"
//    directory, portal, handbook, benefits, and departmental-roster pages
//    were passing as valid jobs. confirmedNonFacultyReason() now returns
//    'resource_page_title' for these via FACULTY_STAFF_RESOURCE_TITLE_RE,
//    unless the title also carries an explicit appointment/hiring term
//    (professor, lecturer, instructor, position, job, employment, opening,
//    appointment, adjunct, vacancy, hiring, tenure) or an already-recognized
//    strong academic title, in which case it's treated as a real posting
//    that merely uses inclusive audience language.
//  - #149 is a prevention-only fix (the resource-keyword heuristic that
//    would have false-positived on "Adjunct Faculty ... Video/Overview"
//    titles never actually ran a scrape against the current dataset), so
//    there is nothing to restore here -- this script only verifies the six
//    confirmed-genuine postings from that issue still clear the gate, as a
//    regression guard for the migration itself.
//
// Both #150 and #153 are now caught automatically by
// applyPostQualityGates() in scrape-to-json.js on every future scrape (via
// confirmedNonFacultyReason()); this pass removes the records already
// committed to public/jobs.json / docs/jobs.json from before that fix
// landed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { confirmedNonFacultyReason } from './lib/post-quality.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const TARGETS = ['public/jobs.json', 'docs/jobs.json']
const REPORT_PATH = path.join(ROOT, 'generated', 'fix-quality-gate-batch-149-150-153-report.json')

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

// The six confirmed-genuine issue #149 examples -- must still be present and
// must still clear confirmedNonFacultyReason() after this migration.
const GENUINE_149_URLS = [
  'https://nec.peopleadmin.com/postings/7001',
  'https://www.carrollcc.edu/about/jobs/adjunct-faculty-computer-graphics-digital-video',
  'https://mica.wd5.myworkdayjobs.com/Faculty/job/Baltimore-MD/Adjunct-Faculty--Film-and-Video_R3555',
  'https://owens.wd1.myworkdayjobs.com/OCC/job/Owens-Toledo-Campus/Applicant-Pool-for-Adjunct-Faculty--Broadcasting-Video-Production_JR100037-1',
  'https://owens.wd1.myworkdayjobs.com/OCC/job/Owens-Toledo-Campus/Applicant-Pool-for-Adjunct-Faculty--Lab-Assistant--Broadcasting-Video-Production_JR100069-1',
  'https://embryriddle.wd1.myworkdayjobs.com/AdjunctFacultyOpportunities/job/Remote---United-States/Adjunct-Faculty--Online-Course--SPAC-500--Overview-of-the-Space-Ecosystem--College-of-Aviation--Worldwide-Campus-_R310815',
]

// Defensive re-check: only ever remove a 'resource_page_title' record here
// if its title actually contains the #153 "faculty & staff" phrase, so this
// migration can never silently absorb an unrelated resource_page_title
// reason (e.g. a future change to one of the other resource-title rules)
// under the #153 bucket.
const FACULTY_STAFF_RESOURCE_TITLE_RE = /\bfaculty\s*(?:&|and|\+)\s*staff\b/i

const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))

const kept = []
const removed150 = []
const removed153 = []
const unexpectedResourcePageTitle = []

for (const job of source.jobs) {
  const reason = confirmedNonFacultyReason(job)
  if (reason === 'filled_compliance_notice') {
    removed150.push({ title: clean(job.title), url: clean(job.url), college: clean(job.college) })
    continue
  }
  if (reason === 'resource_page_title' && FACULTY_STAFF_RESOURCE_TITLE_RE.test(clean(job.title))) {
    removed153.push({ title: clean(job.title), url: clean(job.url), college: clean(job.college) })
    continue
  }
  if (reason === 'resource_page_title') {
    // Pre-existing resource_page_title matches unrelated to the #153
    // "faculty & staff" pattern (e.g. "Faculty Directory", "Faculty/Staff
    // Resource Overview", "Information for ... Faculty Applicants") --
    // these are already-merged #129 rules that this dataset apparently
    // predates a full re-gate for. They are out of scope for this
    // migration (#149/#150/#153 only): left untouched here and only
    // surfaced informationally in the report, not removed.
    unexpectedResourcePageTitle.push({ title: clean(job.title), url: clean(job.url) })
  }
  kept.push(job)
}

const genuine149Check = GENUINE_149_URLS.map((url) => {
  const job = source.jobs.find((candidate) => clean(candidate.url) === url)
  const stillKept = Boolean(job) && kept.includes(job)
  return {
    url,
    found: Boolean(job),
    title: job ? clean(job.title) : null,
    confirmedNonFacultyReason: job ? confirmedNonFacultyReason(job) : null,
    stillPresentAfterFix: stillKept,
  }
})

const failed149 = genuine149Check.filter((entry) => !entry.found || entry.confirmedNonFacultyReason !== null || !entry.stillPresentAfterFix)
if (failed149.length) {
  console.error('Issue #149 regression guard failed for:', JSON.stringify(failed149, null, 2))
  process.exit(1)
}

const report = {
  generatedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  totalJobsBefore: source.jobs.length,
  totalJobsAfter: kept.length,
  issue150: {
    description: 'Department of Labor / OFLC "Notice of Filing" compliance notices for already-filled positions',
    removedCount: removed150.length,
    removed: removed150,
  },
  issue153: {
    description: '"Faculty & Staff" / "Faculty and Staff" / "Faculty + Staff" resource/roster pages',
    removedCount: removed153.length,
    removed: removed153,
  },
  issue149: {
    description: 'Prevention-only fix; regression guard confirming the six genuine Adjunct Faculty Video/Overview postings still clear the gate',
    genuinePostingsChecked: genuine149Check,
  },
  outOfScopeObservation: {
    description: 'Pre-existing resource_page_title matches (already-merged #129 rules -- faculty directory/biography/overview/video, applicant-information pages, campus-visit marketing copy) that this dataset predates a full re-gate for. Out of scope for #149/#150/#153; left untouched by this migration.',
    count: unexpectedResourcePageTitle.length,
    sample: unexpectedResourcePageTitle,
  },
}

console.log(JSON.stringify({
  ...report,
  issue150: { ...report.issue150, removed: `${removed150.length} entries (see report file)` },
  issue153: { ...report.issue153, removed: `${removed153.length} entries (see report file)` },
}, null, 2))

if (!DRY_RUN) {
  const output = { ...source, jobs: kept, count: kept.length }
  for (const relative of TARGETS) fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`)
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}
