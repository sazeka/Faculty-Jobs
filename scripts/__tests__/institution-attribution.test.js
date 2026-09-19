import assert from 'node:assert/strict'
import test from 'node:test'
import {
  repairKnownInstitutionAttribution,
  repairKnownSourceOwnership,
  parseMinnStateInstitutionFromDescription,
  repairMinnStateCollegeFromDescription,
  findMinnStateInstitutionConflicts,
} from '../lib/institution-attribution.js'

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

// Issue #152: the shared minnstate.wd115.myworkdayjobs.com tenant covers 33
// Minnesota State institutions, several of which share a city (St. Paul:
// Saint Paul College AND Metropolitan State University; Brainerd: only
// Central Lakes College, but the stored college was a synthetic
// "Minnesota State (Brainerd)" label). The scraped description always
// carries the authoritative "Institution: <name>" field.
const SAINT_PAUL_URL =
  'https://minnstate.wd115.myworkdayjobs.com/Minnesota_State_Careers/job/St-Paul/Community-Faculty---Computer-Science-and-Cybersecurity_JR0000005746'
const SAINT_PAUL_DESCRIPTION =
  'Working Title: Community Faculty - Computer Science and Cybersecurity Institution: Metropolitan State University Classification Title: Community Faculty Bargaining Unit: MSCF City: St. Paul FLSA: Exempt Full Time'

const BRAINERD_URL =
  'https://minnstate.wd115.myworkdayjobs.com/Minnesota_State_Careers/job/Brainerd/Nursing-AD---Faculty_JR0000005722'
const BRAINERD_DESCRIPTION =
  'Working Title: Nursing AD - Faculty Institution: Central Lakes College Classification Title: Community Faculty Bargaining Unit: MSCF City: Brainerd FLSA: Exempt'

test('parseMinnStateInstitutionFromDescription extracts the structured Institution field', () => {
  assert.equal(parseMinnStateInstitutionFromDescription(SAINT_PAUL_DESCRIPTION), 'Metropolitan State University')
  assert.equal(parseMinnStateInstitutionFromDescription(BRAINERD_DESCRIPTION), 'Central Lakes College')
  assert.equal(parseMinnStateInstitutionFromDescription(''), null)
  assert.equal(parseMinnStateInstitutionFromDescription(null), null)
  assert.equal(parseMinnStateInstitutionFromDescription('No structured fields here.'), null)
})

test('repairMinnStateCollegeFromDescription corrects the Saint Paul College / Metropolitan State conflict (issue #152)', () => {
  const job = {
    title: 'Community Faculty - Computer Science and Cybersecurity',
    college: 'Saint Paul College',
    location: 'Saint Paul College, MN',
    url: SAINT_PAUL_URL,
    description: SAINT_PAUL_DESCRIPTION,
  }
  const repaired = repairMinnStateCollegeFromDescription(job)
  assert.equal(repaired.college, 'Metropolitan State University')
  assert.equal(repaired.location, 'St. Paul, MN')
  assert.notEqual(repaired, job)
})

test('repairMinnStateCollegeFromDescription corrects the synthetic Minnesota State (Brainerd) label (issue #152)', () => {
  const job = {
    title: 'Nursing AD - Faculty',
    college: 'Minnesota State (Brainerd)',
    location: 'Minnesota State (Brainerd), MN',
    url: BRAINERD_URL,
    description: BRAINERD_DESCRIPTION,
  }
  const repaired = repairMinnStateCollegeFromDescription(job)
  assert.equal(repaired.college, 'Central Lakes College')
  assert.equal(repaired.location, 'Brainerd, MN')
})

test('repairMinnStateCollegeFromDescription is a no-op when the stored college already matches, or evidence is missing', () => {
  const alreadyCorrect = {
    title: 'Community Faculty - Computer Science and Cybersecurity',
    college: 'Metropolitan State University',
    url: SAINT_PAUL_URL,
    description: SAINT_PAUL_DESCRIPTION,
  }
  assert.equal(repairMinnStateCollegeFromDescription(alreadyCorrect), alreadyCorrect)

  const noDescriptionYet = {
    title: 'Community Faculty - Computer Science and Cybersecurity',
    college: 'Saint Paul College',
    url: SAINT_PAUL_URL,
    description: null,
  }
  assert.equal(repairMinnStateCollegeFromDescription(noDescriptionYet), noDescriptionYet)

  const nonMinnStateJob = {
    title: 'Assistant Professor',
    college: 'Saint Paul College',
    url: 'https://example.edu/postings/1',
    description: SAINT_PAUL_DESCRIPTION,
  }
  assert.equal(repairMinnStateCollegeFromDescription(nonMinnStateJob), nonMinnStateJob)

  assert.equal(repairMinnStateCollegeFromDescription(null), null)
})

test('repairKnownInstitutionAttribution applies the Minnesota State description repair first', () => {
  const repaired = repairKnownInstitutionAttribution({
    title: 'Community Faculty - Computer Science and Cybersecurity',
    college: 'Saint Paul College',
    location: 'Saint Paul College, MN',
    url: SAINT_PAUL_URL,
    description: SAINT_PAUL_DESCRIPTION,
  })
  assert.equal(repaired.college, 'Metropolitan State University')
})

test('findMinnStateInstitutionConflicts reports only Minnesota State records that disagree with their own description', () => {
  const jobs = [
    {
      title: 'Community Faculty - Computer Science and Cybersecurity',
      college: 'Saint Paul College',
      location: 'Saint Paul College, MN',
      url: SAINT_PAUL_URL,
      description: SAINT_PAUL_DESCRIPTION,
    },
    {
      title: 'Nursing AD - Faculty',
      college: 'Central Lakes College',
      location: 'Brainerd, MN',
      url: BRAINERD_URL,
      description: BRAINERD_DESCRIPTION,
    },
    {
      title: 'Assistant Professor',
      college: 'Some Other College',
      url: 'https://example.edu/postings/1',
      description: 'Institution: Some Other College',
    },
  ]
  const conflicts = findMinnStateInstitutionConflicts(jobs)
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].storedCollege, 'Saint Paul College')
  assert.equal(conflicts[0].descriptionInstitution, 'Metropolitan State University')
  assert.equal(conflicts[0].url, SAINT_PAUL_URL)
})
