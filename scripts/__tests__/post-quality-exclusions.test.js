import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReviewedExclusionMap, normalizeReviewedUrl, reviewedExclusionReason } from '../lib/post-quality-exclusions.js'

test('reviewed URL exclusions are exact and survive harmless URL normalization', () => {
  const exclusions = buildReviewedExclusionMap([
    { url: 'https://Example.edu/faculty-handbook/', reason: 'faculty_handbook' },
  ])
  assert.equal(reviewedExclusionReason({ url: 'https://example.edu/faculty-handbook' }, exclusions), 'faculty_handbook')
  assert.equal(reviewedExclusionReason({ url: 'https://example.edu/faculty-job' }, exclusions), null)
  assert.equal(normalizeReviewedUrl('not a url'), 'not a url')
})

test('reviewed Soka staff and catalog pages are excluded without broad title matching', () => {
  const exclusions = buildReviewedExclusionMap([
    { url: 'https://soka.wd5.myworkdayjobs.com/sokacareersite/job/SUA-Main-Campus/Faculty-Assistant-and-Assistant-to-the-Office-of-the-Dean_JR-416', reason: 'staff_role' },
    { url: 'https://catalog.soka.edu/core/core-100', reason: 'course_catalog_page' },
  ])
  assert.equal(reviewedExclusionReason({ url: 'https://catalog.soka.edu/core/core-100/' }, exclusions), 'course_catalog_page')
  assert.equal(reviewedExclusionReason({ url: 'https://apply.interfolio.com/186050' }, exclusions), null)
})

test('reviewed false listings are excluded only by their exact URLs', () => {
  const exclusions = buildReviewedExclusionMap([
    { url: 'https://www.albanylaw.edu/faculty-community', reason: 'news_or_profile_page' },
    { url: 'https://www.greaterdubuque.org/live-here', reason: 'community_information_page' },
    { url: 'https://www.callutheran.edu/academics/faculty-mentorship.html', reason: 'student_program_information_page' },
    { url: 'https://careers.usi.edu/jobs/search?page=1&employment_type_uids%5B%5D=2870671dfb7b1b2953f9187844ba74a2&query=', reason: 'generic_job_search_page' },
    { url: 'https://www.uhsp.edu/academics/st-louis-college-of-pharmacy/dean-of-pharmacy', reason: 'faculty_profile_or_leadership_page' },
    { url: 'https://today.oregonstate.edu/all-stories/10-questions-diana-rohlman-associate-professor-and-senior-researcher-department', reason: 'news_or_profile_page' },
    { url: 'https://www.uvmhealth.org/medical-education-training/champlain-valley-physicians-hospital-residency-education/school-of-radiologic-technology/faculty-board-members', reason: 'faculty_staff_page' },
    { url: 'https://saltlakecommunitycollege.blogspot.com/2022/03/meet-our-faculty-dr-emmanuel-santa.html', reason: 'news_or_profile_page' },
    { url: 'https://www.fhnw.edu/staff/department/gove-county-faculty', reason: 'faculty_staff_page' },
    { url: 'https://www.asl.edu/faculty-2/faculty-assistant', reason: 'administrative_staff_profile' },
  ])
  assert.equal(reviewedExclusionReason({ url: 'https://www.albanylaw.edu/faculty-community/' }, exclusions), 'news_or_profile_page')
  assert.equal(reviewedExclusionReason({ url: 'https://www.albanylaw.edu/about/employment' }, exclusions), null)
  assert.equal(reviewedExclusionReason({ url: 'https://www.greaterdubuque.org/live-here' }, exclusions), 'community_information_page')
  assert.equal(reviewedExclusionReason({ url: 'https://www.callutheran.edu/academics/faculty-mentorship.html' }, exclusions), 'student_program_information_page')
  assert.equal(reviewedExclusionReason({ url: 'https://careers.usi.edu/jobs/search?page=1&employment_type_uids%5B%5D=2870671dfb7b1b2953f9187844ba74a2&query=' }, exclusions), 'generic_job_search_page')
  assert.equal(reviewedExclusionReason({ url: 'https://www.uhsp.edu/academics/st-louis-college-of-pharmacy/dean-of-pharmacy/' }, exclusions), 'faculty_profile_or_leadership_page')
  assert.equal(reviewedExclusionReason({ url: 'https://today.oregonstate.edu/all-stories/10-questions-diana-rohlman-associate-professor-and-senior-researcher-department/' }, exclusions), 'news_or_profile_page')
  assert.equal(reviewedExclusionReason({ url: 'https://www.uvmhealth.org/medical-education-training/champlain-valley-physicians-hospital-residency-education/school-of-radiologic-technology/faculty-board-members' }, exclusions), 'faculty_staff_page')
  assert.equal(reviewedExclusionReason({ url: 'https://saltlakecommunitycollege.blogspot.com/2022/03/meet-our-faculty-dr-emmanuel-santa.html' }, exclusions), 'news_or_profile_page')
  assert.equal(reviewedExclusionReason({ url: 'https://www.fhnw.edu/staff/department/gove-county-faculty' }, exclusions), 'faculty_staff_page')
  assert.equal(reviewedExclusionReason({ url: 'https://www.asl.edu/faculty-2/faculty-assistant/' }, exclusions), 'administrative_staff_profile')
  assert.equal(reviewedExclusionReason({ url: 'https://www.asl.edu/about/employment' }, exclusions), null)
})
