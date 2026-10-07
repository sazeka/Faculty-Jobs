import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RESPONSIBLE_TECH_CLASSIFIER_VERSION,
  classifyResponsibleTechJob,
  computeResponsibleTechBreakdown,
} from '../lib/weekly-responsible-tech-stats.js';

test('classifies responsible-tech titles and descriptions', () => {
  assert.deepEqual(classifyResponsibleTechJob({ title: 'Assistant Professor of Technology Ethics' }).themes, ['AI & technology ethics']);
  assert.equal(classifyResponsibleTechJob({ description: 'Research on algorithmic fairness and bias in hiring systems.' }).related, true);
  assert.equal(classifyResponsibleTechJob({ description: 'We welcome work on trustworthy AI and AI governance.' }).themes.length, 2);
  assert.equal(classifyResponsibleTechJob({ title: 'Faculty in Public Interest Technology' }).related, true);
});

test('broad phrases count only in title, department, or specialization', () => {
  assert.equal(classifyResponsibleTechJob({ description: 'Programs include Science, Technology, and Society and Women’s Studies.' }).related, false);
  assert.equal(classifyResponsibleTechJob({ department: 'Science, Technology, and Society' }).related, true);
  assert.equal(classifyResponsibleTechJob({ description: 'Enforce data privacy and lab-use policies.' }).related, false);
  assert.equal(classifyResponsibleTechJob({ title: 'Lecturer in Data Privacy Law' }).related, true);
});

test('rejects generic AI and ethics listings without a responsible-tech signal', () => {
  assert.equal(classifyResponsibleTechJob({ title: 'Professor of Machine Learning' }).related, false);
  assert.equal(classifyResponsibleTechJob({ title: 'Assistant Professor of Philosophy', description: 'AOS: ethics.' }).related, false);
  assert.equal(classifyResponsibleTechJob({ description: 'Courses include engineering ethics and statics.' }).related, false);
});

test('computes a versioned share, theme counts, and listings', () => {
  const stats = computeResponsibleTechBreakdown([
    { title: 'Professor of AI Ethics', college: 'Example University', url: 'https://example.edu/1' },
    { title: 'Algorithmic Accountability Fellow', college: 'Example University' },
    { title: 'Professor of History', college: 'Other College' },
  ]);

  assert.equal(stats.related, 2);
  assert.equal(stats.total, 3);
  assert.equal(stats.sharePct, 66.7);
  assert.equal(stats.classifierVersion, RESPONSIBLE_TECH_CLASSIFIER_VERSION);
  assert.deepEqual(stats.topInstitutions, [{ institution: 'Example University', count: 2 }]);
  assert.deepEqual(stats.byTheme, [
    { theme: 'AI & technology ethics', count: 1 },
    { theme: 'Algorithmic fairness & accountability', count: 1 },
  ]);
  assert.deepEqual(stats.listings[1], {
    title: 'Professor of AI Ethics',
    institution: 'Example University',
    url: 'https://example.edu/1',
    themes: ['AI & technology ethics'],
  });
});
