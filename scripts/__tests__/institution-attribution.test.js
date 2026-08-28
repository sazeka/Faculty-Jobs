import assert from 'node:assert/strict'
import test from 'node:test'
import { repairKnownInstitutionAttribution } from '../lib/institution-attribution.js'

test('repairs Wake Forest medical faculty pulled through the Atrium board', () => {
  const job = repairKnownInstitutionAttribution({
    title: 'Academic Faculty - Wake Forest University School of Medicine',
    college: 'Queens University of Charlotte',
    location: 'Queens University of Charlotte, NC',
    url: 'https://aah.wd5.myworkdayjobs.com/External/job/Winston-Salem/Faculty_R123',
  })
  assert.equal(job.college, 'Wake Forest University')
  assert.equal(job.location, 'Winston-Salem, NC')
});

test('does not infer attribution without exact institution and platform evidence', () => {
  const original = {
    title: 'Open Rank Faculty',
    college: 'Queens University of Charlotte',
    url: 'https://aah.wd5.myworkdayjobs.com/External/job/Charlotte/Faculty_R123',
  }
  assert.equal(repairKnownInstitutionAttribution(original), original)
  assert.equal(repairKnownInstitutionAttribution({ ...original, url: 'https://example.edu/job/123', description: 'Wake Forest University School of Medicine' }).college, 'Queens University of Charlotte')
  assert.equal(repairKnownInstitutionAttribution({ ...original, description: 'Enterprise boilerplate mentions Wake Forest University School of Medicine.' }).college, 'Queens University of Charlotte')
});

test('repairs a missing CSU institution only from an exact recognized location', () => {
  const repaired = repairKnownInstitutionAttribution({
    title: 'Assistant Professor of Architecture',
    source: 'CSU',
    college: '',
    location: 'Cal Poly - San Luis Obispo Campus, CA',
  })
  assert.equal(repaired.college, 'California Polytechnic State University-San Luis Obispo')

  const repairedFromDescription = repairKnownInstitutionAttribution({
    title: 'Assistant Professor of Engineering Technology',
    source: 'CSU',
    college: '',
    location: 'Campus, CA',
    description: 'Work type: Instructional Faculty Location: Cal Poly - Solano Campus (Vallejo) Categories: Faculty',
  })
  assert.equal(repairedFromDescription.college, 'California Polytechnic State University-San Luis Obispo')

  const ambiguous = { title: 'Assistant Professor', source: 'CSU', college: '', location: 'Campus, CA' }
  assert.equal(repairKnownInstitutionAttribution(ambiguous), ambiguous)
});
