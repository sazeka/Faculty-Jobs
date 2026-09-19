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
