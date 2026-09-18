import assert from 'node:assert/strict'
import test from 'node:test'
import { getCollegeLocationFallback, normalizeLocationByCollege } from '../../server.js'

// Regression tests for https://github.com/sazeka/Faculty-Jobs/issues/127
//
// getCollegeLocationFallback() used to accept substring containment between
// normalized college-name keys ("k.includes(key) || key.includes(k)"). That
// let institutions that merely share a generic word or trailing/leading
// token collide with an unrelated institution's city/state, e.g. "Azusa
// Pacific University" resolving to "Pacific University"'s Forest Grove, OR.

test('does not fuzzy-match unrelated institutions that share generic words', () => {
  // Azusa Pacific University must not inherit Pacific University's location.
  assert.notEqual(getCollegeLocationFallback('Azusa Pacific University'), 'Forest Grove, OR')
  // Fresno Pacific University must not inherit Pacific University's location either.
  assert.notEqual(getCollegeLocationFallback('Fresno Pacific University'), 'Forest Grove, OR')
  // Salem State University must not inherit Winston-Salem State University's location.
  assert.notEqual(getCollegeLocationFallback('Salem State University'), 'Winston-Salem, NC')
  // Brigham Young University-Hawaii must not inherit BYU's Provo, UT location.
  assert.notEqual(getCollegeLocationFallback('Brigham Young University-Hawaii'), 'Provo, UT')
  // Virginia State University must not inherit West Virginia State University's location.
  assert.notEqual(getCollegeLocationFallback('Virginia State University'), 'Institute, WV')
  // The University of the South must not inherit University of Southern Indiana's location.
  assert.notEqual(getCollegeLocationFallback('The University of the South'), 'Evansville, IN')
  // Methodist University must not inherit Southern Methodist University's location.
  assert.notEqual(getCollegeLocationFallback('Methodist University'), 'Dallas, TX')
  // Clark State College must not inherit Lewis-Clark State College's location.
  assert.notEqual(getCollegeLocationFallback('Clark State College'), 'Lewiston, ID')
  // University of Mary Washington must not inherit University of Mary's location.
  assert.notEqual(getCollegeLocationFallback('University of Mary Washington'), 'Bismarck, ND')
  // St Lawrence University must not inherit Lawrence University's location.
  assert.notEqual(getCollegeLocationFallback('St Lawrence University'), 'Appleton, WI')
});

test('resolves the confirmed collision institutions to their own reviewed location', () => {
  assert.equal(getCollegeLocationFallback('Azusa Pacific University'), 'Azusa, CA')
  assert.equal(getCollegeLocationFallback('Fresno Pacific University'), 'Fresno, CA')
  assert.equal(getCollegeLocationFallback('Salem State University'), 'Salem, MA')
  assert.equal(getCollegeLocationFallback('Brigham Young University-Hawaii'), 'Laie, HI')
  assert.equal(getCollegeLocationFallback('Virginia State University'), 'Petersburg, VA')
  assert.equal(getCollegeLocationFallback('The University of the South'), 'Sewanee, TN')
  assert.equal(getCollegeLocationFallback('Methodist University'), 'Fayetteville, NC')
  assert.equal(getCollegeLocationFallback('Clark State College'), 'Springfield, OH')
  assert.equal(getCollegeLocationFallback('University of Mary Washington'), 'Fredericksburg, VA')
  assert.equal(getCollegeLocationFallback('St Lawrence University'), 'Canton, NY')
});

test('still resolves the unrelated institutions the confirmed collisions used to borrow from', () => {
  // The generic-name institutions themselves should keep resolving correctly —
  // the fix must not remove their own exact entries.
  assert.equal(getCollegeLocationFallback('Pacific University'), 'Forest Grove, OR')
  assert.equal(getCollegeLocationFallback('Winston-Salem State University'), 'Winston-Salem, NC')
  assert.equal(getCollegeLocationFallback('Brigham Young University'), 'Provo, UT')
  assert.equal(getCollegeLocationFallback('West Virginia State University'), 'Institute, WV')
  assert.equal(getCollegeLocationFallback('University of Southern Indiana'), 'Evansville, IN')
  assert.equal(getCollegeLocationFallback('Southern Methodist University'), 'Dallas, TX')
  assert.equal(getCollegeLocationFallback('Lewis-Clark State College'), 'Lewiston, ID')
  assert.equal(getCollegeLocationFallback('University of Mary'), 'Bismarck, ND')
  assert.equal(getCollegeLocationFallback('Lawrence University'), 'Appleton, WI')
});

test('still resolves an exact institution name that only differs by minor formatting', () => {
  // toCollegeLocationKey() normalizes whitespace, "&", apostrophes,
  // parenthetical campus descriptors, and "Univ"/"Inst" abbreviations —
  // that direct normalized-key match is intentionally preserved.
  assert.equal(getCollegeLocationFallback('  Pacific   University  '), 'Forest Grove, OR')
  assert.equal(getCollegeLocationFallback('Pacific University (Forest Grove Campus)'), 'Forest Grove, OR')
});

test('leaves an unrecognized institution unresolved instead of guessing', () => {
  assert.equal(getCollegeLocationFallback('Totally Fictional University'), null)
});

test('normalizeLocationByCollege fills in the correct campus city for a placeholder location', () => {
  const job = normalizeLocationByCollege({
    college: 'Azusa Pacific University',
    location: 'Azusa Pacific University',
    source: 'CA Private',
  })
  assert.equal(job.location, 'Azusa, CA')
});

test('normalizeLocationByCollege does not corrupt Salem State University records with Winston-Salem', () => {
  const job = normalizeLocationByCollege({
    college: 'Salem State University',
    location: 'Salem State University',
    source: 'MA',
  })
  assert.equal(job.location, 'Salem, MA')
});

// Regression tests for https://github.com/sazeka/Faculty-Jobs/issues/120
//
// getCollegeLocationFallback() previously only resolved via the ~200-entry
// hand-curated COLLEGE_LOCATION_DEFAULTS map, so the vast majority of
// institutions using the "College Name, ST" placeholder convention (Wilson
// Community College, Medical College of Wisconsin, Harvard University,
// Tennessee Technological University — none of which were in that curated
// map) had no fallback available. It now also consults a second tier built
// from data/institutions-master.json's IPEDS-derived `city` field, matched
// by exact institution name only (same discipline as #127).
test('resolves institutions not in the curated map via the IPEDS-derived city fallback (issue #120)', () => {
  assert.equal(getCollegeLocationFallback('Wilson Community College'), 'Wilson, NC')
  assert.equal(getCollegeLocationFallback('Medical College of Wisconsin'), 'Milwaukee, WI')
  assert.equal(getCollegeLocationFallback('Harvard University'), 'Cambridge, MA')
  assert.equal(getCollegeLocationFallback('Tennessee Technological University'), 'Cookeville, TN')
});

// normalizeLocationByCollege() previously trusted normalizeUsLocation()'s
// parse of any string matching "<text>, ST" as already being a real "City,
// ST" location — which meant a placeholder like "Wilson Community College,
// NC" (the institution's own name plus a state suffix, with no real city)
// was returned unchanged instead of ever reaching the campus-city fallback
// below. It must now catch this case before normalizeUsLocation runs.
test('normalizeLocationByCollege resolves a "College Name, ST" placeholder to the real campus city', () => {
  const wilson = normalizeLocationByCollege({
    college: 'Wilson Community College',
    location: 'Wilson Community College, NC',
    source: 'NC',
  })
  assert.equal(wilson.location, 'Wilson, NC')

  const mcw = normalizeLocationByCollege({
    college: 'Medical College of Wisconsin',
    location: 'Medical College of Wisconsin, WI',
    source: 'WI',
  })
  assert.equal(mcw.location, 'Milwaukee, WI')

  const harvard = normalizeLocationByCollege({
    college: 'Harvard University',
    location: 'Harvard University, MA',
    source: 'MA Private',
  })
  assert.equal(harvard.location, 'Cambridge, MA')
});

test('normalizeLocationByCollege leaves a legitimate real city/state location untouched', () => {
  const job = normalizeLocationByCollege({
    college: 'Wilson Community College',
    location: 'Rocky Mount, NC',
    source: 'NC',
  })
  assert.equal(job.location, 'Rocky Mount, NC')
});

test('normalizeLocationByCollege leaves a remote role untouched', () => {
  const job = normalizeLocationByCollege({
    college: 'Harvard University',
    location: 'Remote',
    source: 'MA Private',
  })
  assert.equal(job.location, 'Remote')
});

test('normalizeLocationByCollege leaves an institution with no known campus city unresolved', () => {
  const job = normalizeLocationByCollege({
    college: 'Totally Fictional University',
    location: 'Totally Fictional University, XX',
    source: 'XX',
  })
  assert.equal(job.location, 'Totally Fictional University, XX')
});
