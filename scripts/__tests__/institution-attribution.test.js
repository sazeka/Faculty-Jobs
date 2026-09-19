import assert from 'node:assert/strict'
import test from 'node:test'
import { repairKnownInstitutionAttribution, repairKnownSourceOwnership } from '../lib/institution-attribution.js'

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

// Issue #143: institution-specific hosts/tenants absorbed by a neighboring
// college's broader discovery pass, or misattributed by a broad city-token
// text hint. The host/path match is authoritative, so it applies even when
// the record already carries a different, wrong `college` value.
test('repairs jobs.geneseo.edu postings misattributed to Finger Lakes Community College (issue #143)', () => {
  const repaired = repairKnownSourceOwnership({
    title: 'Assistant Professor of Mathematics',
    college: 'Finger Lakes Community College',
    location: 'Finger Lakes Community College, NY',
    url: 'https://jobs.geneseo.edu/postings/5637',
  })
  assert.equal(repaired.college, 'SUNY College at Geneseo')
  assert.equal(repaired.location, 'Geneseo, NY')
})

test('repairs schooljobs.com/careers/brockport postings misattributed to Finger Lakes Community College (issue #143)', () => {
  const repaired = repairKnownSourceOwnership({
    title: 'Assistant Professor',
    college: 'Finger Lakes Community College',
    location: 'Finger Lakes Community College, NY',
    url: 'https://www.schooljobs.com/careers/brockport/jobs/5468533',
  })
  assert.equal(repaired.college, 'SUNY Brockport')
  assert.equal(repaired.location, 'Brockport, NY')
})

test('repairs monroecc.interviewexchange.com postings misattributed to Finger Lakes Community College (issue #143)', () => {
  const repaired = repairKnownSourceOwnership({
    title: 'Adjunct Instructor',
    college: 'Finger Lakes Community College',
    location: 'Finger Lakes Community College, NY',
    url: 'https://monroecc.interviewexchange.com/jobofferdetails.jsp?JOBID=196601',
  })
  assert.equal(repaired.college, 'Monroe Community College')
  assert.equal(repaired.location, 'Rochester, NY')
})

test('repairs ecc.wd5.myworkdayjobs.com postings misattributed to University at Buffalo by a "Buffalo" location token (issue #143)', () => {
  const repaired = repairKnownSourceOwnership({
    title: 'Adjunct Professor - Biology',
    college: 'University at Buffalo',
    location: 'Buffalo, NY',
    url: 'https://ecc.wd5.myworkdayjobs.com/AdjunctFacultyExternal/job/City-Campus---Downtown-Buffalo/Adjunct-Professor---Biology_J0002273',
  })
  assert.equal(repaired.college, 'Erie Community College')
  assert.equal(repaired.location, 'Buffalo, NY')
})

test('repairKnownSourceOwnership leaves unrelated hosts and already-correct records untouched', () => {
  const unrelated = {
    title: 'Assistant Professor',
    college: 'Some Other College',
    location: 'Somewhere, NY',
    url: 'https://example.edu/postings/1',
  }
  assert.equal(repairKnownSourceOwnership(unrelated), unrelated)
  assert.equal(repairKnownSourceOwnership(null), null)
  const noUrl = {}
  assert.equal(repairKnownSourceOwnership(noUrl), noUrl)

  const alreadyCorrect = {
    title: 'Assistant Professor of Mathematics',
    college: 'SUNY College at Geneseo',
    location: 'Geneseo, NY',
    url: 'https://jobs.geneseo.edu/postings/5637',
  }
  assert.equal(repairKnownSourceOwnership(alreadyCorrect), alreadyCorrect)
})
