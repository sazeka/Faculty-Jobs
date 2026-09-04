function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function sourceText(job) {
  return clean([
    job?.title,
    job?.location,
    job?.description,
    job?.summary,
  ].filter(Boolean).join(' '))
}

export function inferEmploymentType(job = {}) {
  const explicit = clean(job.employmentType || job.timeType || job.scheduleType)
  const heading = `${explicit} ${clean(job.title)}`.toLowerCase()
  if (/\bpart[- ]time\b/.test(heading)) return 'Part-time'
  if (/\bfull[- ]time\b/.test(heading)) return 'Full-time'
  const text = sourceText(job).toLowerCase()
  if (/\b(?:position|appointment|role) is part[- ]time\b|\bpart[- ]time(?:\s+\w+){0,2}\s+appointment\b/.test(text)) return 'Part-time'
  if (/\b(?:position|appointment|role) is full[- ]time\b|\bfull[- ]time(?:\s+\w+){0,2}\s+appointment\b/.test(text)) return 'Full-time'
  return null
}

export function inferWorkMode(job = {}) {
  if (job.remote === true) return 'Remote'
  const explicit = clean(job.workMode || job.workplaceType || job.remoteStatus)
  if (/hybrid/i.test(explicit)) return 'Hybrid'
  if (/remote/i.test(explicit)) return 'Remote'
  if (/on[- ]site|in[- ]person/i.test(explicit)) return 'On-site'
  const text = sourceText(job).toLowerCase()
  if (/\bhybrid(?: work| schedule| position| option| appointment)\b|\bremote or hybrid\b/.test(text)) return 'Hybrid'
  if (/\bfully remote\b|\bremote position\b|\bposition is remote\b|\bwork remotely\b|\bremote work (?:eligible|available|option)\b/.test(text)) return 'Remote'
  if (/\bon[- ]site (?:position|work|schedule|required)\b|\bin[- ]person (?:position|work|schedule|required)\b/.test(text)) return 'On-site'
  return null
}

export function inferSalaryText(job = {}) {
  const explicit = clean(job.salaryText || job.salary || job.compensation)
  if (explicit) return explicit.slice(0, 180)
  const text = sourceText(job)
  const amount = /\$\s?\d{2,3}(?:,\d{3})+(?:\.\d+)?(?:\s*(?:-|–|—|to)\s*\$?\s?\d{2,3}(?:,\d{3})+(?:\.\d+)?)?(?:\s*(?:per year|annually|\/year|per hour|hourly))?/i
  const context = text.match(new RegExp(`(?:salary|compensation|pay range|annual pay|hiring range)[^.$]{0,100}(${amount.source})`, 'i'))
  return context ? clean(context[1]) : null
}

export function inferAppointmentLength(job = {}) {
  const explicit = clean(job.appointmentLength || job.termLength)
  if (explicit) return explicit.slice(0, 100)
  const text = sourceText(job)
  const match = text.match(/\b(?:nine|ten|eleven|twelve|9|10|11|12)[- ]month appointment\b|\b(?:one|two|three|1|2|3)[- ]year appointment\b/i)
  return match ? match[0].replace(/^./, (character) => character.toUpperCase()) : null
}

export function inferReviewDateText(job = {}) {
  const explicit = clean(job.reviewDateText || job.reviewDate)
  if (explicit) return explicit.slice(0, 100)
  const text = sourceText(job)
  const match = text.match(/(?:review of applications|application review|reviewing applications) (?:will )?(?:begin|begins|starting|starts) (?:on )?([A-Z][a-z]+ \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i)
  return match ? clean(match[1]) : null
}

export function inferVisaSponsorship(job = {}) {
  const explicit = clean(job.visaSponsorship || job.sponsorship)
  const text = `${explicit} ${sourceText(job)}`.toLowerCase()
  if (/\b(?:visa|immigration) sponsorship (?:is )?(?:not available|not provided|unavailable)\b|\bwill not sponsor\b/.test(text)) return 'Not offered'
  if (/\b(?:visa|immigration) sponsorship (?:is )?(?:available|provided)\b|\bwill sponsor\b/.test(text)) return 'Offered'
  return null
}

export function deriveCandidateFields(job = {}) {
  return {
    employmentType: inferEmploymentType(job),
    workMode: inferWorkMode(job),
    salaryText: inferSalaryText(job),
    appointmentLength: inferAppointmentLength(job),
    reviewDateText: inferReviewDateText(job),
    visaSponsorship: inferVisaSponsorship(job),
  }
}
