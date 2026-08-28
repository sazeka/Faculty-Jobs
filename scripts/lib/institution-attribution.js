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
