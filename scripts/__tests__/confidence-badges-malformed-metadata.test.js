import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultFilters } from '../../web-vue/src/config/appConfig.js'
import { useJobFilters } from '../../web-vue/src/composables/useJobFilters.js'

// Issue #130: deriveConfidenceBadges() used to check raw `job.department`
// with `clean()` instead of the stricter `cleanDepartment()` the frontend's
// own display path uses to reject malformed values -- so a record whose
// department would render as "Missing Department" could still earn a
// "Department Tagged" confidence badge. It also didn't recognize
// bot-challenge/security-verification text masquerading as a description.

function jobsFilters(jobs) {
  const jobsRef = { value: jobs }
  const filtersRef = { value: createDefaultFilters() }
  return useJobFilters({ jobsRef, filtersRef, isSavedJob: () => false })
}

function badgeLabels(job) {
  return job.confidenceBadges.map((badge) => badge.label)
}

test('a malformed department does not earn a "Department Tagged" badge (issue #130)', () => {
  const { filteredJobs } = jobsFilters([
    {
      title: 'Assistant Professor of Business',
      college: 'University of Houston',
      url: 'https://careers.uh.edu/jobs/1',
      location: 'Houston, TX',
      // Real audited example: a truncated sentence fragment, not a department.
      department: 's. Come work alongside a committed group of faculty and staff to provide transformational',
    },
  ])
  const [job] = filteredJobs.value
  assert.ok(!badgeLabels(job).includes('Department Tagged'), badgeLabels(job).join(', '))
  assert.ok(badgeLabels(job).includes('Missing Department'))
})

test('a scraper-appended region/open-until-filled suffix does not earn a "Department Tagged" badge (issue #130)', () => {
  const { filteredJobs } = jobsFilters([
    {
      title: 'Adjunct Instructor of Biology',
      college: 'Finger Lakes Community College',
      url: 'https://example.edu/jobs/1',
      location: 'Canandaigua, NY',
      department: 'Biology Region: Finger Lakes Open until filled',
    },
  ])
  const [job] = filteredJobs.value
  assert.ok(!badgeLabels(job).includes('Department Tagged'))
})

test('a valid department still earns a "Department Tagged" badge (issue #130 regression guard)', () => {
  const { filteredJobs } = jobsFilters([
    {
      title: 'Assistant Professor of Chemistry',
      college: 'Example University',
      url: 'https://example.edu/jobs/1',
      location: 'Phoenix, AZ',
      department: 'Department of Chemistry',
    },
  ])
  const [job] = filteredJobs.value
  assert.ok(badgeLabels(job).includes('Department Tagged'))
})

test('a bot-challenge description does not suppress the "Missing Metadata" badge (issue #130)', () => {
  const { filteredJobs } = jobsFilters([
    {
      title: 'Assistant Professor of Chemistry',
      college: 'Example University',
      url: 'https://example.edu/jobs/1',
      location: 'Phoenix, AZ',
      department: 'Chemistry',
      description: 'Performing security verification. This may take a few seconds...',
    },
  ])
  const [job] = filteredJobs.value
  assert.ok(badgeLabels(job).includes('Missing Metadata'), badgeLabels(job).join(', '))
})

test('a real description does not trigger the "Missing Metadata" badge (issue #130 regression guard)', () => {
  const { filteredJobs } = jobsFilters([
    {
      title: 'Assistant Professor of Chemistry',
      college: 'Example University',
      url: 'https://example.edu/jobs/1',
      location: 'Phoenix, AZ',
      department: 'Chemistry',
      description: 'Teach undergraduate and graduate chemistry courses and maintain an active research program.',
    },
  ])
  const [job] = filteredJobs.value
  assert.ok(!badgeLabels(job).includes('Missing Metadata'), badgeLabels(job).join(', '))
})
