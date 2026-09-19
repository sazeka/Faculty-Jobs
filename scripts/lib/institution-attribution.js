const WAKE_FOREST_NAME = 'Wake Forest University'
const WAKE_FOREST_LOCATION = 'Winston-Salem, NC'

const CSU_LOCATION_INSTITUTIONS = new Map([
  ['Bakersfield', 'California State University-Bakersfield'],
  ['Channel Islands', 'California State University-Channel Islands'],
  ['Chico', 'California State University-Chico'],
  ['Dominguez Hills', 'California State University-Dominguez Hills'],
  ['East Bay', 'California State University-East Bay'],
  ['Fresno', 'California State University-Fresno'],
  ['Fullerton', 'California State University-Fullerton'],
  ['Humboldt', 'California State Polytechnic University-Humboldt'],
  ['Long Beach', 'California State University-Long Beach'],
  ['Los Angeles', 'California State University-Los Angeles'],
  ['Maritime Academy', 'California State University Maritime Academy'],
  ['Monterey Bay', 'California State University-Monterey Bay'],
  ['Northridge', 'California State University-Northridge'],
  ['Pomona', 'California State Polytechnic University-Pomona'],
  ['Sacramento', 'California State University-Sacramento'],
  ['San Bernardino', 'California State University-San Bernardino'],
  ['San Diego', 'San Diego State University'],
  ['San Francisco', 'San Francisco State University'],
  ['San Jose', 'San Jose State University'],
  ['San José', 'San Jose State University'],
  ['San Luis Obispo', 'California Polytechnic State University-San Luis Obispo'],
  ['San Marcos', 'California State University-San Marcos'],
  ['Sonoma', 'Sonoma State University'],
  ['Stanislaus', 'California State University-Stanislaus'],
])

export function canonicalCsuInstitutionFromLocation(value) {
  const location = String(value || '').replace(/\s+/g, ' ').trim()
  if (!location) return null
  if (CSU_LOCATION_INSTITUTIONS.has(location)) return CSU_LOCATION_INSTITUTIONS.get(location)
  if (/^Cal Poly - (?:San Luis Obispo|Solano) Campus\b/i.test(location)) {
    return 'California Polytechnic State University-San Luis Obispo'
  }
  return null
}

function isAtriumWorkdayUrl(value) {
  try {
    return /^aah\.wd\d+\.myworkdayjobs\.com$/i.test(new URL(String(value || '')).hostname)
  } catch {
    return false
  }
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function key(value) {
  return clean(value).toLowerCase()
}

// Issue #152: the shared minnstate.wd115.myworkdayjobs.com Workday tenant
// (33 Minnesota State colleges/universities on one board) was being
// attributed by the city in job.location/URL alone. Several Minnesota State
// institutions share a city (St. Paul: Saint Paul College AND Metropolitan
// State University; St. Cloud: St. Cloud State University AND St. Cloud
// Technical and Community College; Brooklyn Park: North Hennepin Community
// College AND Hennepin Technical College's Brooklyn Park campus; etc.), so a
// city is not a unique campus identifier on this tenant. Every posting's own
// scraped description carries a structured "Institution: <name>" field
// (confirmed live: this is the actual hiring institution, not boilerplate)
// that is authoritative where a city guess is not. See also
// scrapeMinnStateWorkdayAs() in server.js, which now prefers the same
// Institution value straight from Workday's own per-posting bulletFields at
// scrape time -- this description-based repair is the fallback/backstop for
// records whose description was only backfilled after the initial scrape
// (agent-job-descriptions.js), or that predate that scrape-time fix.
function isMinnStateWorkdayUrl(value) {
  try {
    return /^minnstate\.wd\d+\.myworkdayjobs\.com$/i.test(new URL(String(value || '')).hostname)
  } catch {
    return false
  }
}

// Known city for each Minnesota State institution seen conflicting with a
// city-derived guess on this tenant (issue #152's confirmed table). Not
// exhaustive of all 33 Minnesota State institutions -- only the ones this
// resolver has had to correct a location for. Institutions not listed here
// keep whatever location the job already carries.
const MINN_STATE_INSTITUTION_LOCATIONS = new Map(
  [
    ['Metropolitan State University', 'St. Paul, MN'],
    ['Minnesota State College Southeast', 'Winona, MN'],
    ['Hennepin Technical College', 'Brooklyn Park, MN'],
    ['Northland Community and Technical College', 'Thief River Falls, MN'],
    ['North Hennepin Community College', 'Brooklyn Park, MN'],
    ['St. Cloud Technical and Community College', 'St. Cloud, MN'],
    ['Central Lakes College', 'Brainerd, MN'],
    ['Rochester Community and Technical College', 'Rochester, MN'],
    ['Minnesota State Community and Technical College', 'Fergus Falls, MN'],
    ['Saint Paul College', 'St. Paul, MN'],
    ['St. Cloud State University', 'St. Cloud, MN'],
  ].map(([name, location]) => [key(name), location])
)

// Extracts the structured "Institution: <name>" field from a Minnesota State
// Workday posting description. The field always sits between the posting's
// "Working Title:" and "Classification Title:" (or, on shorter descriptions,
// whichever labeled field comes next -- "Bargaining Unit", "City:", "FLSA:",
// etc.), so anchor on that label set rather than assuming a fixed shape.
export function parseMinnStateInstitutionFromDescription(description) {
  const text = clean(description)
  if (!text) return null
  const m = text.match(
    /\bInstitution:\s*([A-Z][A-Za-z&.,'\- ]+?)(?=\s+Classification Title:|\s+Bargaining Unit|\s+City:|\s+FLSA:|\s+Full Time|\s+Employment Condition:|\s+Salary Range:|\s+Job Description:|$)/
  )
  return m ? clean(m[1]) : null
}

// Reports every Minnesota State Workday-tenant job whose stored `college`
// disagrees with a structured `Institution:` value parsed from its own
// description -- the post-scrape invariant issue #152 asks for. Returns an
// empty array when everything agrees (or no description is available yet).
export function findMinnStateInstitutionConflicts(jobs) {
  if (!Array.isArray(jobs)) return []
  const conflicts = []
  for (const job of jobs) {
    if (!isMinnStateWorkdayUrl(job?.url)) continue
    const institution = parseMinnStateInstitutionFromDescription(job?.description)
    if (!institution) continue
    if (key(job?.college) === key(institution)) continue
    conflicts.push({
      url: job.url,
      storedCollege: clean(job.college),
      descriptionInstitution: institution,
      location: clean(job.location) || null,
    })
  }
  return conflicts
}

// Corrects `college` (and, where known, `location`) on a Minnesota State
// Workday-tenant job from its own description's structured `Institution:`
// field when it disagrees with the stored college. A no-op for every other
// job, and a no-op when no description is available yet (descriptions are
// often backfilled well after the initial scrape -- see
// agent-job-descriptions.js) or when the parsed name already matches.
export function repairMinnStateCollegeFromDescription(job) {
  if (!job || !isMinnStateWorkdayUrl(job.url)) return job
  const institution = parseMinnStateInstitutionFromDescription(job.description)
  if (!institution) return job
  if (key(job.college) === key(institution)) return job

  const location = MINN_STATE_INSTITUTION_LOCATIONS.get(key(institution))
  return {
    ...job,
    college: institution,
    ...(location ? { location } : {}),
  }
}

// Issue #143: a handful of institution-specific ATS tenants/hosts were being
// absorbed by a neighboring institution's broader discovery pass (e.g. every
// jobs.geneseo.edu posting landing on "Finger Lakes Community College"), or
// misattributed by a broad text hint that a city token proves an institution
// (a SUNY Erie Community College Workday posting whose location path segment
// is "City-Campus---Downtown-Buffalo" was being read as evidence for
// "University at Buffalo"). These host/path matches are authoritative for
// source ownership -- unlike a location-derived fallback, the tenant a
// posting was scraped from cannot lie about which institution owns it -- so
// they apply even when the record already carries a different, wrong
// `college` value.
const NY_SOURCE_OWNERSHIP_RULES = [
  {
    test: (url) => /^jobs\.geneseo\.edu$/i.test(url.hostname),
    college: "SUNY College at Geneseo",
    location: "Geneseo, NY",
  },
  {
    test: (url) => /(^|\.)schooljobs\.com$/i.test(url.hostname) && /^\/careers\/brockport(\/|$)/i.test(url.pathname),
    college: "SUNY Brockport",
    location: "Brockport, NY",
  },
  {
    test: (url) => /^monroecc\.interviewexchange\.com$/i.test(url.hostname),
    college: "Monroe Community College",
    location: "Rochester, NY",
  },
  {
    test: (url) => /^ecc\.wd\d+\.myworkdayjobs\.com$/i.test(url.hostname),
    college: "Erie Community College",
    location: "Buffalo, NY",
  },
];

export function repairKnownSourceOwnership(job) {
  if (!job?.url) return job;
  let url;
  try {
    url = new URL(job.url);
  } catch {
    return job;
  }
  for (const rule of NY_SOURCE_OWNERSHIP_RULES) {
    if (!rule.test(url)) continue;
    if (job.college === rule.college && job.location === rule.location) return job;
    return { ...job, college: rule.college, location: rule.location };
  }
  return job;
}

export function repairKnownInstitutionAttribution(job) {
  if (!job) return job

  const minnStateRepaired = repairMinnStateCollegeFromDescription(job)
  if (minnStateRepaired !== job) return minnStateRepaired

  if (job.source === 'CSU' && !String(job.college || '').trim()) {
    const descriptionLocation = String(job.description || '').match(/\bLocation:\s*(Cal Poly - (?:San Luis Obispo|Solano) Campus(?:\s*\(Vallejo\))?)/i)?.[1]
    const college = canonicalCsuInstitutionFromLocation(job.location)
      || canonicalCsuInstitutionFromLocation(descriptionLocation)
    if (college) return { ...job, college }
  }

  if (job.college !== 'Queens University of Charlotte' || !isAtriumWorkdayUrl(job.url)) return job

  // Atrium appends enterprise boilerplate mentioning Wake Forest to many
  // unrelated listings. Require the institution in the posting title so that
  // boilerplate alone can never move a job between universities.
  if (!/\bWake Forest University (?:School of Medicine|Health Sciences)\b/i.test(String(job.title || ''))) return job

  return {
    ...job,
    college: WAKE_FOREST_NAME,
    location: WAKE_FOREST_LOCATION,
  }
}
