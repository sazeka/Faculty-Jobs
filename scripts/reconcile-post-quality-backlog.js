import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reviewedWeakEvidenceFalsePositiveReason, scorePost } from './lib/post-quality.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REVIEWED_AT = '2026-08-31'

const key = (college, title) => `${college}|${title}`
const linkActions = new Map([
  [key('Bethel University (IN)', 'Adjunct Faculty'), { url: 'https://betheluniversity.applicantpro.com/jobsearch/?keywords=adjunct', evidence: 'verified-filtered-board' }],
  [key('Lac Courte Oreilles Ojibwe University', 'Adjunct Faculty (Open Applicant Pool for All Disciplines for In-person Instruction)'), { evidence: 'verified-inline-posting' }],
  [key('Mercyhurst University', 'Adjunct Instructor'), { url: 'https://www.mercyhurst.edu/sites/default/files/adjunctinstructor.pdf' }],
  [key('Maria College of Albany', 'Adjunct Instructor - Arts & Sciences'), { evidence: 'verified-inline-posting' }],
  [key('Culver-Stockton College', 'Adjunct Instructor of Physics'), { evidence: 'verified-inline-posting' }],
  [key('Catawba College', 'Adjunct Teaching Instructors – Chemistry (Job 26008)'), { evidence: 'verified-inline-posting' }],
  [key('DeSales University', 'Adjunct: Adult Studies — Multiple Disciplines Needed'), { evidence: 'verified-inline-posting' }],
  [key('Hollins University', 'CHEMISTRY: Assistant Teaching Professor of Chemistry – NEW!'), { url: 'https://www.hollins.edu/about-hollins/jobs/faculty-positions/' }],
  [key('Minnesota North College', 'Class A Behind-The-Wheel CDL Instructors'), { evidence: 'verified-inline-posting' }],
  [key('Trocaire College', 'Clinical Instructor Inquiry and Referral Form'), { url: 'https://trocaire.applicantpro.com/jobs/1076436.html', title: 'Clinical Instructor' }],
  [key('Waynesburg University', 'Computer Science/Information Science Faculty Position'), { evidence: 'verified-inline-posting' }],
  [key('Fort Scott Community College', 'DEAN OF ENROLLMENT AND STUDENT SERVICES (pending Board approval)'), { remove: 'not_a_faculty_appointment' }],
  [key('SUNY Polytechnic Institute', 'Full Time Faculty for Nursing and Health Professions'), { remove: 'no_current_posting_evidence' }],
  [key('Southern Virginia University', 'Open-Rank Professor of Biology'), { url: 'https://svu.edu/about/careers/open-rank-professor-of-biology/' }],
  [key('College of the Atlantic', 'Faculty Member in Agroecology+'), { url: 'https://airtable.com/appbaVoP29B9SKG5U/paggta659ftp5L7n0/form', evidence: 'verified-application-form' }],
])

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function sha1(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex')
}

function assignIds(job) {
  const normalize = (value) => clean(value).toLowerCase()
  const groupParts = [job.titleClean || job.title, job.college, job.department, job.state || job.source].map(normalize)
  const canonicalGroupId = `grp_${sha1(groupParts.join('|')).slice(0, 16)}`
  const canonicalJobId = `job_${sha1([canonicalGroupId, normalize(job.source), normalize(job.url)].join('|')).slice(0, 16)}`
  return { ...job, canonicalGroupId, canonicalJobId }
}

function repairReviewedTitle(job) {
  if (job.college === 'Harvard University' && /^View Details — Faculty of Arts and Sciences$/i.test(clean(job.title))) {
    const match = clean(job.description).match(/Position Details Title (.*?) School Faculty of Arts and Sciences/i)
    if (match?.[1]) return clean(match[1])
  }
  if (job.college === 'Claremont McKenna College') return clean(job.title).replace(/ProfessorView$/i, 'Professor')
  if (job.college === 'University of Houston' && /^Let's confirm you are human/i.test(clean(job.title))) return 'Adjunct, Part-of-Term - English'
  return clean(job.title)
}

const sourcePath = path.join(ROOT, 'public/jobs.json')
const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
const before = {
  count: payload.jobs.length,
  statuses: payload.jobs.reduce((acc, job) => {
    const status = scorePost(job).status
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {}),
  weakAcademicEvidence: payload.jobs.filter((job) => scorePost(job).reasons.some((reason) => reason.code === 'weak_academic_evidence')).length,
  searchPageUrls: payload.jobs.filter((job) => scorePost(job).reasons.some((reason) => reason.code === 'search_page_url')).length,
}

if (before.weakAcademicEvidence !== 377 || before.searchPageUrls !== 15) {
  throw new Error(`Expected the reviewed backlog to be 377 weak-evidence and 15 landing-link records; found ${before.weakAcademicEvidence} and ${before.searchPageUrls}.`)
}

const report = {
  reviewedAt: REVIEWED_AT,
  before,
  linkActions: [],
  weakEvidence: { reviewed: 0, kept: 0, removed: 0, removalReasons: {}, titleRepairs: [] },
  removals: [],
}
const matchedLinkActionKeys = new Set()

const jobs = []
for (const original of payload.jobs) {
  const wasWeak = scorePost(original).reasons.some((reason) => reason.code === 'weak_academic_evidence')
  const linkAction = linkActions.get(key(original.college, original.title))
  if (linkAction) {
    matchedLinkActionKeys.add(key(original.college, original.title))
    report.linkActions.push({ college: original.college, title: original.title, oldUrl: original.url, ...linkAction })
    if (linkAction.remove) {
      report.removals.push({ college: original.college, title: original.title, reason: linkAction.remove })
      if (wasWeak) {
        report.weakEvidence.reviewed += 1
        report.weakEvidence.removed += 1
        report.weakEvidence.removalReasons[linkAction.remove] = (report.weakEvidence.removalReasons[linkAction.remove] || 0) + 1
      }
      continue
    }
  }

  let job = { ...original }
  if (linkAction?.url) job.url = linkAction.url
  if (linkAction?.title) job.title = linkAction.title
  if (linkAction?.evidence) job.qualityLinkEvidence = linkAction.evidence
  if (linkAction) job.qualityLinkReviewedAt = REVIEWED_AT

  if (wasWeak) {
    report.weakEvidence.reviewed += 1
    const reason = reviewedWeakEvidenceFalsePositiveReason(original)
    if (reason) {
      report.weakEvidence.removed += 1
      report.weakEvidence.removalReasons[reason] = (report.weakEvidence.removalReasons[reason] || 0) + 1
      report.removals.push({ college: original.college, title: original.title, url: original.url, reason })
      continue
    }
    report.weakEvidence.kept += 1
    job.qualityEvidence = 'reviewed-academic-appointment'
    job.qualityReviewedAt = REVIEWED_AT
    const repairedTitle = repairReviewedTitle(job)
    if (repairedTitle && repairedTitle !== job.title) {
      report.weakEvidence.titleRepairs.push({ college: job.college, oldTitle: job.title, newTitle: repairedTitle })
      job.title = repairedTitle
    }
  }

  jobs.push(assignIds(job))
}

if (matchedLinkActionKeys.size !== linkActions.size || report.weakEvidence.reviewed !== before.weakAcademicEvidence) {
  throw new Error(`Incomplete reconciliation: matched ${matchedLinkActionKeys.size}/${linkActions.size} link decisions and reviewed ${report.weakEvidence.reviewed}/${before.weakAcademicEvidence} weak-evidence records.`)
}

const output = { ...payload, count: jobs.length, jobs }
report.after = {
  count: jobs.length,
  statuses: jobs.reduce((acc, job) => {
    const status = scorePost(job).status
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {}),
  weakAcademicEvidence: jobs.filter((job) => scorePost(job).reasons.some((reason) => reason.code === 'weak_academic_evidence')).length,
  searchPageUrls: jobs.filter((job) => scorePost(job).reasons.some((reason) => reason.code === 'search_page_url')).length,
}

for (const relative of ['public/jobs.json', 'docs/jobs.json', 'web-vue/public/jobs.json']) {
  fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`)
}
fs.writeFileSync(path.join(ROOT, 'generated/post-quality-backlog-reconciliation.json'), `${JSON.stringify(report, null, 2)}\n`)

console.log(JSON.stringify(report, null, 2))
