#!/usr/bin/env node
// One-off migration for issues #156, #157, #162, and #165.
//
//  - #156: 18 available listings had a structured `startDate` more than 90
//    days before their own `datePosted` (gaps of 93-688 days) -- a recycled/
//    stale source posting whose "Desired Start Date" text was accurate but
//    whose relationship to the posting date is impossible. The extraction/
//    display code is fixed in scripts/lib/start-date.js
//    (isImplausibleStartDate(), wired into scripts/agent-job-descriptions.js,
//    scripts/backfill-start-dates.js, and web-vue's useJobFilters.js); this
//    pass nulls out startDate on the 18 confirmed already-committed records
//    (no way to recover the TRUE intended start date, so it's suppressed
//    rather than guessed at).
//  - #157: one Clark Atlanta University record ("Instructor - Cyber Physical
//    Systems(095-26)") had `https://https/jobdescription-...pdf` -- a
//    protocol-relative href whose garbled authority segment resolved to the
//    literal hostname "https" (see scripts/lib/url-normalization.js's new
//    hostname-plausibility check, which now rejects this shape at the
//    canonicalization choke point for all future scrapes). This pass repairs
//    the one already-committed record, using the institution's official
//    open-positions page as the fallback URL per the issue's own
//    recommendation (no other working per-posting link is known).
//  - #162: the New England Law-Boston "Visiting Assistant Professor of
//    Academic Excellence, Bar Examination Preparation Program" record linked
//    to an unrelated "Digital Marketing Manager" PDF -- scrapeFacultyHeadingPageAs's
//    fallback "any link in the same parent element" picked up an adjacent,
//    unrelated posting's link (server.js; now gated by
//    linkPlausiblyMatchesHeading()). This pass repairs the one record with
//    the confirmed correct PDF from the issue.
//  - #165: 13 out-of-state jobs (9 Rust College, Paul Quinn College, North
//    Carolina Wesleyan University, Southern Virginia University, New England
//    Law-Boston) were stored with `source: "NJ"` and the real state
//    stashed in `category` -- toNjJob() in server.js hardcoded `source: "NJ"`
//    regardless of caller, while scrapeFacultyHeadingPageAs/
//    scrapeFacultyTablePageAs (reused for many states, not just NJ) passed
//    the real state into what toNjJob treated as `category` (now fixed:
//    toNjJob takes an explicit `source` parameter). Of the 13 records named
//    in the issue, only 4 are still present in the current dataset (Rust
//    College's 9 records and the rest have since rolled off via the
//    ordinary scrape/purge cycle) -- this pass restores `source`/`category`
//    on those 4 using each record's own `category` value as the confirmed
//    correct state, per the issue's own instruction.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isImplausibleStartDate } from './lib/start-date.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const TARGETS = ['public/jobs.json', 'docs/jobs.json']
const REPORT_PATH = path.join(ROOT, 'generated', 'fix-startdate-clarkatlanta-nelaw-nj-156-157-162-165-report.json')

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))
const jobs = source.jobs

// ── Issue #156: the 18 confirmed implausible startDate records ─────────────
// Each entry pins the exact stored startDate/datePosted the issue confirmed
// -- if a record no longer matches (a later scrape already changed it, or it
// was removed), this migration refuses to guess and fails loudly instead of
// silently nulling out the wrong thing.
const CONFIRMED_156_FIXES = [
  { url: 'https://faculty.tamu.edu/JobDetail.aspx?PositionId=188377&JobId=190325', expectedStartDate: '2026-01-12', expectedDatePosted: '2026-08-13' },
  { url: 'https://uscjobs.sc.edu/postings/187850', expectedStartDate: '2024-01-08', expectedDatePosted: '2025-05-22' },
  { url: 'https://www.schooljobs.com/careers/scf/jobs/4651831/adjunct-faculty-filmmaking', expectedStartDate: '2025-01-06', expectedDatePosted: '2026-05-10' },
  { url: 'https://www.schooljobs.com/careers/scf/jobs/4651817/adjunct-faculty-photography', expectedStartDate: '2025-01-06', expectedDatePosted: '2026-05-10' },
  { url: 'https://williammary.wd12.myworkdayjobs.com/WM/job/William--Mary/Adjunct-Professor-of-Religious-Studies_JR101595', expectedStartDate: '2026-04-21', expectedDatePosted: '2026-07-23' },
  { url: 'https://unf.wd5.myworkdayjobs.com/unfjobs/job/Jacksonville-FL/Adjunct-Political-science-and-Public-Administration_JR100502', expectedStartDate: '2024-08-12', expectedDatePosted: '2025-09-24' },
  { url: 'https://loyola.wd5.myworkdayjobs.com/External/job/Loyola-University-Maryland-Main-Campus/Affiliate-Instructor---Mathematics---Statistics_R-0000000119', expectedStartDate: '2024-09-01', expectedDatePosted: '2025-10-03' },
  { url: 'https://loyola.wd5.myworkdayjobs.com/External/job/Loyola-University-Maryland-Main-Campus/Affiliate-Instructor---Political-Science_R-0000000126', expectedStartDate: '2024-09-01', expectedDatePosted: '2025-01-09' },
  { url: 'https://loyola.wd5.myworkdayjobs.com/External/job/Loyola-University-Maryland-Main-Campus/Affiliate-Instructor---Sociology_R-0000000121', expectedStartDate: '2024-09-01', expectedDatePosted: '2025-04-15' },
  { url: 'https://careers.ua.edu/jobs/edu-assistant-professor-of-elementary-mathematics-education-tenure-tenure-track-530441-alabama-united-states', expectedStartDate: '2025-08-16', expectedDatePosted: '2026-08-28' },
  { url: 'https://www.schooljobs.com/careers/coastalcarolina/jobs/5474641/full-time-permanent-instructor-computer-programs', expectedStartDate: '2026-01-05', expectedDatePosted: '2026-09-07' },
  { url: 'https://www.schooljobs.com/careers/coastalcarolina/jobs/5438684/full-time-permanent-instructor-economics', expectedStartDate: '2026-01-05', expectedDatePosted: '2026-08-31' },
  { url: 'https://www.schooljobs.com/careers/scf/jobs/4899406/instructional-faculty-nursing', expectedStartDate: '2025-08-07', expectedDatePosted: '2026-05-10' },
  { url: 'https://massgeneralbrigham.wd1.myworkdayjobs.com/MGBExternal/job/Boston-MA/Post-doctoral-Research-Fellow--Orthopaedic-Implant-Research_RQ4076789', expectedStartDate: '2025-12-01', expectedDatePosted: '2026-09-15' },
  { url: 'https://massgeneralbrigham.wd1.myworkdayjobs.com/MGBExternal/job/Boston-MA/Post-doctoral-Research-Fellow--Orthopaedic-Infection-Research_RQ4076799', expectedStartDate: '2025-12-01', expectedDatePosted: '2026-09-15' },
  { url: 'https://northeastern.wd1.myworkdayjobs.com/careers/job/Boston-MA-Main-Campus/Postdoctoral-Research-Associate--Biology_R133556', expectedStartDate: '2025-09-01', expectedDatePosted: '2026-02-11' },
  { url: 'https://unc.peopleadmin.com/postings/318749', expectedStartDate: '2025-07-01', expectedDatePosted: '2025-11-06' },
  { url: 'https://www.paycomonline.net/v4/ats/web.php/portal/63ECAB478B34C12845EA27D81D92E35F/jobs/366029', expectedStartDate: '2024-08-19', expectedDatePosted: '2026-07-08' },
]

const results156 = CONFIRMED_156_FIXES.map((fix) => {
  const job = jobs.find((j) => clean(j.url) === fix.url)
  if (!job) return { ...fix, found: false, matchedExpected: false }
  const matchedExpected = job.startDate === fix.expectedStartDate && clean(job.datePosted).slice(0, 10) === fix.expectedDatePosted
  return { url: fix.url, title: job ? clean(job.title) : null, found: true, matchedExpected, before: job.startDate, expectedStartDate: fix.expectedStartDate, expectedDatePosted: fix.expectedDatePosted, storedDatePosted: job.datePosted }
})
const failed156 = results156.filter((r) => !r.found || !r.matchedExpected)
if (failed156.length) {
  console.error('Issue #156 confirmed-example guard failed for:', JSON.stringify(failed156, null, 2))
  process.exit(1)
}
// Defensive re-check: only ever null out a startDate here if it's still
// genuinely implausible under the shared helper, so this migration can never
// silently null a value that some other fix already legitimately changed.
for (const fix of CONFIRMED_156_FIXES) {
  const job = jobs.find((j) => clean(j.url) === fix.url)
  if (!isImplausibleStartDate(job.startDate, job.datePosted)) {
    console.error(`Issue #156: ${fix.url} no longer looks implausible (startDate=${job.startDate}, datePosted=${job.datePosted}) -- refusing to touch it.`)
    process.exit(1)
  }
  job.startDate = null
}

// ── Issue #157: the one confirmed Clark Atlanta malformed-hostname URL ─────
const CLARK_ATLANTA_BAD_URL = 'https://https/jobdescription-cyber-physical%20systems%20(2)%20(1).pdf'
const CLARK_ATLANTA_FALLBACK_URL = 'https://www.cau.edu/about/offices-resources/human-resources/employment-information/open-positions'
const clarkAtlantaJob = jobs.find((j) => clean(j.url) === CLARK_ATLANTA_BAD_URL && j.college === 'Clark Atlanta University')
if (!clarkAtlantaJob) {
  console.error(`Issue #157: expected record with url ${CLARK_ATLANTA_BAD_URL} not found.`)
  process.exit(1)
}
const clarkAtlantaBefore = clarkAtlantaJob.url
clarkAtlantaJob.url = CLARK_ATLANTA_FALLBACK_URL

// ── Issue #162: the one confirmed New England Law-Boston wrong-PDF URL ─────
const NELAW_BAD_URL = 'https://www.nesl.edu/wp-content/uploads/2026/08/Digital-Marketing-Manager-August-2026-1.pdf'
const NELAW_CORRECT_URL = 'https://www.nesl.edu/wp-content/uploads/2026/06/New-England-Law-Visiting-Asst-Prof-Bar-Prep.pdf'
const nelawJob = jobs.find((j) => j.college === 'New England Law-Boston' && clean(j.url) === NELAW_BAD_URL)
if (!nelawJob) {
  console.error(`Issue #162: expected New England Law-Boston record with url ${NELAW_BAD_URL} not found.`)
  process.exit(1)
}
const nelawUrlBefore = nelawJob.url
nelawJob.url = NELAW_CORRECT_URL

// ── Issue #165: the 4 confirmed out-of-state records still present ─────────
// (Rust College's 9 records and the rest of the original 13 have since
// rolled off the dataset via the ordinary scrape/purge cycle -- see report.)
const CONFIRMED_165_FIXES = [
  { college: 'Paul Quinn College', expectedCategory: 'TX' },
  { college: 'North Carolina Wesleyan University', expectedCategory: 'NC' },
  { college: 'Southern Virginia University', expectedCategory: 'VA' },
  { college: 'New England Law-Boston', expectedCategory: 'MA' },
]
const results165 = CONFIRMED_165_FIXES.map((fix) => {
  const job = jobs.find((j) => j.college === fix.college && j.source === 'NJ')
  if (!job) return { ...fix, found: false, matchedExpected: false }
  const matchedExpected = job.category === fix.expectedCategory
  return { college: fix.college, title: clean(job.title), found: true, matchedExpected, sourceBefore: job.source, categoryBefore: job.category, expectedCategory: fix.expectedCategory }
})
const failed165 = results165.filter((r) => !r.found || !r.matchedExpected)
if (failed165.length) {
  console.error('Issue #165 confirmed-example guard failed for:', JSON.stringify(failed165, null, 2))
  process.exit(1)
}
for (const fix of CONFIRMED_165_FIXES) {
  const job = jobs.find((j) => j.college === fix.college && j.source === 'NJ')
  job.source = job.category // the real state, per the issue's own instruction
  job.category = 'Faculty' // category is a job category, not a hidden state fallback
}

// ── Report ────────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  totalJobs: jobs.length,
  issue156: {
    description: '18 confirmed implausible-startDate records (startDate more than 90 days before datePosted) had startDate suppressed to null.',
    count: results156.length,
    corrected: results156,
  },
  issue157: {
    description: 'Malformed Clark Atlanta University URL (hostname literally "https") repaired to the institution\'s verified open-positions page.',
    college: 'Clark Atlanta University',
    title: clean(clarkAtlantaJob.title),
    before: clarkAtlantaBefore,
    after: clarkAtlantaJob.url,
  },
  issue162: {
    description: 'New England Law-Boston visiting-professor record repaired from an unrelated Digital Marketing Manager PDF to the confirmed correct PDF.',
    college: 'New England Law-Boston',
    title: clean(nelawJob.title),
    before: nelawUrlBefore,
    after: nelawJob.url,
  },
  issue165: {
    description: '13 out-of-state jobs mislabeled source:"NJ" with the real state in category -- 4 of the 13 confirmed examples remain in the current dataset (Rust College\'s 9 records and the rest have since rolled off via the ordinary scrape/purge cycle); those 4 had source/category restored using each record\'s own category as the confirmed correct state.',
    originalConfirmedCount: 13,
    stillPresentCount: results165.length,
    corrected: results165,
    note: 'Rust College (9 records) currently has zero listings in public/jobs.json -- already removed by an unrelated scrape/purge pass, not by this migration.',
  },
}

console.log(JSON.stringify(report, null, 2))

if (!DRY_RUN) {
  const output = { ...source, jobs, count: jobs.length }
  for (const relative of TARGETS) fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`)
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}
