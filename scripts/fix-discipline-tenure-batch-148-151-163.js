#!/usr/bin/env node
// One-off migration for issues #148, #151, and #163.
//
//  - #148: 1,136 records stored a truthy placeholder string ("null",
//    "Unknown"/"unknown") instead of a real null for a missing discipline,
//    permanently blocking reclassification wherever enrichment code only
//    checked `=== undefined`. This pass normalizes every placeholder string
//    to real `null`, then runs the existing zero-cost deterministic
//    department-vocabulary backfill (scripts/lib/discipline-from-department.js
//    -- the same logic agent-job-enrichment.js already applies on every
//    scheduled run) against the now-genuinely-missing records, so records
//    with an exact, already-vetted department match get a real discipline
//    immediately instead of waiting for the next AI enrichment pass.
//  - #151: corrects the seven confirmed contradictory-discipline records
//    (stored discipline names a field flatly unrelated to the title/
//    department/description) by re-deriving each one from its title, the
//    same way the (already-fixed, PR #142) title-based classifier would.
//  - #163: converts any remaining legacy "tenure-track"/"non-tenure-track"
//    string values in public/jobs.json / docs/jobs.json to the canonical
//    boolean. (The periodic agent-job-presence.js normalization pass had
//    already cleaned these out of the two jobs.json files themselves by the
//    time this migration ran -- see the report's issue163.jobsJsonStrings*
//    fields -- but the derived public/data/jobs-index.json, its per-state
//    chunks, and the web-vue mirror were stale and still carried 636 legacy
//    string values between them. This script fixes the write-boundary code
//    -- see scripts/lib/jobs-listing-index.js's compactListingJob() -- and
//    then scripts/rebuild-data-chunks-all.js must be run afterward to
//    actually regenerate those derived files from the now-clean
//    public/jobs.json.)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMissingDiscipline } from './lib/discipline-normalize.js'
import { buildKnownDisciplineVocabulary, deriveDisciplineFromDepartment } from './lib/discipline-from-department.js'
import { auditDisciplineConsistency } from './lib/discipline-consistency-audit.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const TARGETS = ['public/jobs.json', 'docs/jobs.json']
const REPORT_PATH = path.join(ROOT, 'generated', 'fix-discipline-tenure-batch-148-151-163-report.json')

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))
const jobs = source.jobs

// ── Issue #163: convert any remaining legacy string tenureTrack values ──────
let tenureStringsConvertedInJobsJson = 0
const tenureConversions = []
for (const job of jobs) {
  if (job.tenureTrack === 'tenure-track' || job.tenureTrack === 'non-tenure-track') {
    const before = job.tenureTrack
    job.tenureTrack = before === 'tenure-track'
    tenureStringsConvertedInJobsJson++
    tenureConversions.push({ url: clean(job.url), title: clean(job.title), before, after: job.tenureTrack })
  }
}

// ── Issue #148: normalize placeholder strings to real null ──────────────────
let placeholdersNormalized = 0
const placeholderBreakdown = {}
for (const job of jobs) {
  if (typeof job.discipline === 'string' && isMissingDiscipline(job.discipline)) {
    const before = job.discipline
    placeholderBreakdown[before] = (placeholderBreakdown[before] || 0) + 1
    job.discipline = null
    placeholdersNormalized++
  }
}

// ── Issue #148: zero-cost deterministic backfill for the now-genuinely-missing records ──
const disciplineVocabulary = buildKnownDisciplineVocabulary(jobs)
let deterministicBackfilled = 0
const backfillSamples = []
for (const job of jobs) {
  if (!isMissingDiscipline(job.discipline)) continue
  const derived = deriveDisciplineFromDepartment(job.department, disciplineVocabulary)
  if (!derived) continue
  job.discipline = derived
  deterministicBackfilled++
  if (backfillSamples.length < 25) {
    backfillSamples.push({ url: clean(job.url), title: clean(job.title), department: clean(job.department), discipline: derived })
  }
}
const disciplineMissingAfterBackfill = jobs.filter((j) => isMissingDiscipline(j.discipline)).length

// ── Issue #151: correct the seven confirmed contradictory records ───────────
// Each entry's `expectedBefore` is the exact stored value confirmed in the
// issue -- if a record's stored value no longer matches (e.g. a later scrape
// already changed it, or the record was removed), this migration refuses to
// guess and fails loudly instead of silently overwriting something else.
const CONFIRMED_151_FIXES = [
  {
    url: 'https://www.schooljobs.com/careers/fdtc/jobs/4989325/adjunct-biology-instructor-25-26',
    expectedBefore: 'Business',
    after: 'Biology',
    evidence: 'Title is Biology; description says "Department Biology" and requires graduate Biology coursework.',
  },
  {
    url: 'https://ivytech.wd1.myworkdayjobs.com/Ivy_Tech_Careers/job/Indianapolis-IN/Adjunct-Faculty---Economics_JR0000108099',
    expectedBefore: 'Earth Science',
    after: 'Economics',
    evidence: 'Title, department, specialization, and description all say Economics.',
  },
  {
    url: 'https://cdn.wou.edu/hr/files/2025/12/PF2513-Job-Announcment.pdf',
    expectedBefore: 'Spanish',
    after: 'Sociology',
    evidence: 'Title and stored department both say Sociology.',
  },
  {
    url: 'https://uscjobs.sc.edu/postings/161443',
    expectedBefore: 'Computer Science',
    // Title/description name a joint "Art Education/Art History" posting --
    // Art History and Art Education are both correct, equally-supported
    // readings (no further evidence disambiguates which is primary). Art
    // History is chosen as the single stored value since it is the more
    // traditional academic-discipline framing of the two; this is a judgment
    // call, called out explicitly in the migration report.
    after: 'Art History',
    evidence: 'Title, department, and source page say Art Education/Art History.',
  },
  {
    url: 'https://aims.wd1.myworkdayjobs.com/Jobs/job/Greeley-CO/Adjunct-Faculty--Chemistry_R1606-2',
    expectedBefore: 'Computer Information Systems',
    after: 'Chemistry',
    evidence: 'The single-subject title and Workday requisition path both say Chemistry.',
  },
  {
    url: 'https://aims.wd1.myworkdayjobs.com/Jobs/job/Greeley-CO/Adjunct-Faculty--Economics_R1670-2',
    expectedBefore: 'Computer Science',
    after: 'Economics',
    evidence: 'The single-subject title and Workday requisition path both say Economics.',
  },
  {
    url: 'https://indiana.peopleadmin.com/postings/32497',
    expectedBefore: 'Psychology',
    // Department also says "Quantum Physics" verbatim; "Physics" is used as
    // the stored value to match this dataset's existing convention of
    // top-level-field granularity (e.g. "Physics" already covers 173 other
    // records) rather than introducing a brand-new single-record value.
    after: 'Physics',
    evidence: 'Title, department, and description all say Quantum Physics.',
  },
]

const confirmed151Results = []
for (const fix of CONFIRMED_151_FIXES) {
  const job = jobs.find((j) => clean(j.url) === fix.url)
  if (!job) {
    confirmed151Results.push({ ...fix, found: false, matchedExpected: false })
    continue
  }
  const before = job.discipline
  const matchedExpected = before === fix.expectedBefore
  confirmed151Results.push({ found: true, url: fix.url, title: clean(job.title), before, expectedBefore: fix.expectedBefore, matchedExpected, after: fix.after, evidence: fix.evidence })
  if (matchedExpected) job.discipline = fix.after
}

const failed151 = confirmed151Results.filter((r) => !r.found || !r.matchedExpected)
if (failed151.length) {
  console.error('Issue #151 confirmed-example guard failed for:', JSON.stringify(failed151, null, 2))
  process.exit(1)
}

// ── Advisory-only: broader consistency audit (issue #151 acceptance criteria) ──
// NOT auto-applied -- a full-dataset scan with this audit's necessarily
// simple structural title parsing produces real false positives on longer,
// multi-clause titles (e.g. "Adjunct Faculty - Department of Computer
// Science, Engineering, Mathematics, Physics, and Statistics" stored as
// "Engineering" is entirely reasonable, not a contradiction, but the audit's
// substring check can still flag it). These are surfaced in the report for
// manual review only.
const auditFindings = auditDisciplineConsistency(jobs)
const auditFindingsExcludingConfirmed = auditFindings.filter(
  (f) => !CONFIRMED_151_FIXES.some((fix) => fix.url === f.url)
)

// ── Report ────────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  totalJobs: jobs.length,
  issue148: {
    description: 'Literal null/Unknown/unknown discipline strings normalized to real null, then backfilled where a deterministic department-vocabulary match exists.',
    placeholderStringsNormalized: placeholdersNormalized,
    placeholderBreakdown,
    deterministicallyBackfilled: deterministicBackfilled,
    backfillSamples,
    disciplineMissingAfterThisPass: disciplineMissingAfterBackfill,
    note: 'Records without a department-vocabulary match remain null -- still missing a discipline, but now genuinely null (not a placeholder string), so they are correctly picked up by the next AI enrichment run.',
  },
  issue151: {
    description: 'Seven confirmed contradictory-discipline records corrected by re-deriving from title/department evidence.',
    corrected: confirmed151Results,
    advisoryAuditFindings: {
      description: 'Broader scripts/lib/discipline-consistency-audit.js scan of the full dataset, for manual review only -- NOT auto-applied. See module comment for the false-positive risk on longer/compound titles.',
      count: auditFindingsExcludingConfirmed.length,
      findings: auditFindingsExcludingConfirmed,
    },
  },
  issue163: {
    description: 'Legacy "tenure-track"/"non-tenure-track" string values converted to boolean in public/jobs.json + docs/jobs.json.',
    jobsJsonStringsConvertedByThisPass: tenureStringsConvertedInJobsJson,
    jobsJsonConversions: tenureConversions,
    note: 'public/jobs.json and docs/jobs.json already had zero string-valued tenureTrack records by the time this migration ran (the periodic agent-job-presence.js normalization pass -- scripts/agent-job-presence.js:258 -- had already cleaned them up); the 636 records referenced in the issue were found in the derived public/data/jobs-index.json, its per-state chunks, and the web-vue mirror, which were stale relative to public/jobs.json. This migration fixes the code (scripts/lib/jobs-listing-index.js compactListingJob()) that generates those files; run `node scripts/rebuild-data-chunks-all.js` after this script to regenerate them from the now-clean public/jobs.json and eliminate the stale strings.',
  },
}

console.log(JSON.stringify({
  ...report,
  issue151: { ...report.issue151, advisoryAuditFindings: { ...report.issue151.advisoryAuditFindings, findings: `${auditFindingsExcludingConfirmed.length} entries (see report file)` } },
}, null, 2))

if (!DRY_RUN) {
  const output = { ...source, jobs, count: jobs.length }
  for (const relative of TARGETS) fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`)
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}
