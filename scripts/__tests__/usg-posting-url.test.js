import assert from 'node:assert/strict'
import test from 'node:test'
import { usgPostingUrl } from '../../server.js'
import { extractRequisitionId } from '../lib/canonical-id.js'

const SEARCH = 'https://careers.hprod.onehcm.usg.edu/psc/careers/CAREERS/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL'

test('OneUSG links open the job posting page, not the search page', () => {
  const url = new URL(usgPostingUrl(`${SEARCH}?FOCUS=Applicant&SiteId=03000`, 296346))
  assert.equal(url.hash, '')
  assert.equal(url.searchParams.get('Page'), 'HRS_APP_JBPST_FL')
  assert.equal(url.searchParams.get('JobOpeningId'), '296346')
  assert.equal(url.searchParams.get('SiteId'), '03000')
})

test('OneUSG system search URL without a SiteId uses careers site 1', () => {
  const url = new URL(usgPostingUrl(`${SEARCH}?Page=HRS_APP_SCHJOB_FL&Action=U`, 303322))
  assert.equal(url.searchParams.get('SiteId'), '1')
  assert.equal(url.searchParams.get('Page'), 'HRS_APP_JBPST_FL')
})

test('OneUSG canonical id is unchanged by the move from #jobId to JobOpeningId', () => {
  const legacy = extractRequisitionId(`${SEARCH}?FOCUS=Applicant&SiteId=03000#jobId=296346`)
  const current = extractRequisitionId(usgPostingUrl(`${SEARCH}?FOCUS=Applicant&SiteId=03000`, 296346))
  assert.equal(current, legacy)
})
