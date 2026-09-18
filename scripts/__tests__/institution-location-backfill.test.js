import assert from 'node:assert/strict'
import test from 'node:test'
import { resolvePlaceholderLocation, backfillPlaceholderLocations } from '../lib/institution-location-backfill.js'
import { getCollegeLocationFallback } from '../../server.js'

// scripts/fix-institution-name-location-placeholders.js (issue #120) backfills
// historical placeholder locations already committed to public/jobs.json /
// docs/jobs.json. These tests cover the pure logic it's built on, using a
// stubbed lookup so the unit-level behavior doesn't depend on the live
// institutions-master.json dataset, plus an integration check against the
// real getCollegeLocationFallback() for the issue's own confirmed examples.

function fakeLookup(map) {
  return (college) => map[college] || null
}

test('resolvePlaceholderLocation resolves a placeholder to the looked-up campus city', () => {
  const lookup = fakeLookup({ 'Wilson Community College': 'Wilson, NC' })
  const resolved = resolvePlaceholderLocation(
    { college: 'Wilson Community College', location: 'Wilson Community College, NC' },
    lookup
  )
  assert.equal(resolved, 'Wilson, NC')
});

test('resolvePlaceholderLocation returns null for a real, non-placeholder location', () => {
  const lookup = fakeLookup({ 'Harvard University': 'Cambridge, MA' })
  const resolved = resolvePlaceholderLocation(
    { college: 'Harvard University', location: 'Cambridge, MA' },
    lookup
  )
  assert.equal(resolved, null)
});

test('resolvePlaceholderLocation returns null for a remote role', () => {
  const lookup = fakeLookup({ 'Harvard University': 'Cambridge, MA' })
  const resolved = resolvePlaceholderLocation(
    { college: 'Harvard University', location: 'Remote' },
    lookup
  )
  assert.equal(resolved, null)
});

test('resolvePlaceholderLocation returns null when no campus city is known', () => {
  const lookup = fakeLookup({})
  const resolved = resolvePlaceholderLocation(
    { college: 'Totally Fictional University', location: 'Totally Fictional University, XX' },
    lookup
  )
  assert.equal(resolved, null)
});

test('resolvePlaceholderLocation does not flag a legitimate campus name sharing the college city', () => {
  const lookup = fakeLookup({ 'Santa Clara University': 'Santa Clara, CA' })
  const resolved = resolvePlaceholderLocation(
    { college: 'Santa Clara University', location: 'Santa Clara, CA' },
    lookup
  )
  assert.equal(resolved, null)
});

test('backfillPlaceholderLocations only rewrites placeholder rows and reports each change', () => {
  const lookup = fakeLookup({
    'Wilson Community College': 'Wilson, NC',
    'Medical College of Wisconsin': 'Milwaukee, WI',
  })
  const jobs = [
    { college: 'Wilson Community College', location: 'Wilson Community College, NC', url: 'https://a.example/1' },
    { college: 'Medical College of Wisconsin', location: 'Medical College of Wisconsin, WI', url: 'https://a.example/2' },
    { college: 'Harvard University', location: 'Cambridge, MA', url: 'https://a.example/3' },
    { college: 'Totally Fictional University', location: 'Remote', url: 'https://a.example/4' },
  ]
  const { jobs: updated, changes } = backfillPlaceholderLocations(jobs, lookup)

  assert.equal(updated[0].location, 'Wilson, NC')
  assert.equal(updated[1].location, 'Milwaukee, WI')
  assert.equal(updated[2].location, 'Cambridge, MA')
  assert.equal(updated[3].location, 'Remote')
  assert.equal(changes.length, 2)
  assert.deepEqual(changes.map((c) => c.to).sort(), ['Milwaukee, WI', 'Wilson, NC'])

  // The input array/objects are not mutated in place.
  assert.equal(jobs[0].location, 'Wilson Community College, NC')
});

test('backfillPlaceholderLocations resolves the issue\'s own confirmed examples via the real institution lookup', () => {
  const jobs = [
    { college: 'Wilson Community College', location: 'Wilson Community College, NC' },
    { college: 'Medical College of Wisconsin', location: 'Medical College of Wisconsin, WI' },
    { college: 'Harvard University', location: 'Harvard University, MA' },
    { college: 'Tennessee Technological University', location: 'Tennessee Technological University, TN' },
  ]
  const { jobs: updated } = backfillPlaceholderLocations(jobs, getCollegeLocationFallback)
  assert.deepEqual(updated.map((j) => j.location), ['Wilson, NC', 'Milwaukee, WI', 'Cambridge, MA', 'Cookeville, TN'])
});
