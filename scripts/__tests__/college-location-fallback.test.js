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
