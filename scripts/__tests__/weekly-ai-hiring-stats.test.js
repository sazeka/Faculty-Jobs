import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_HIRING_CLASSIFIER_VERSION,
  classifyAiRelatedJob,
  computeAiHiringBreakdown,
} from '../lib/weekly-ai-hiring-stats.js';

test('classifies explicit AI fields and descriptions', () => {
  assert.equal(classifyAiRelatedJob({ title: 'Assistant Professor of AI and Society' }).related, true);
  assert.equal(classifyAiRelatedJob({ description: 'Research in machine learning and causal inference.' }).related, true);
  assert.equal(classifyAiRelatedJob({ department: 'Computer Science', specialization: 'Natural Language Processing' }).related, true);
});

test('rejects broad adjacent and ambiguous terms without an explicit AI signal', () => {
  assert.equal(classifyAiRelatedJob({ title: 'Professor of Data Science' }).related, false);
  assert.equal(classifyAiRelatedJob({ title: 'Robotics Faculty Position' }).related, false);
  assert.equal(classifyAiRelatedJob({ title: 'Director of the LLM Program' }).related, false);
  assert.equal(classifyAiRelatedJob({ description: 'The LLM program welcomes applications.' }).related, false);
});

test('computes a versioned share and leading institutions', () => {
  const stats = computeAiHiringBreakdown([
    { title: 'Professor of Artificial Intelligence', college: 'Example University' },
    { title: 'Machine Learning Faculty', college: 'Example University' },
    { title: 'Professor of History', college: 'Other College' },
  ]);

  assert.deepEqual(stats, {
    related: 2,
    total: 3,
    sharePct: 66.7,
    classifierVersion: AI_HIRING_CLASSIFIER_VERSION,
    topInstitutions: [{ institution: 'Example University', count: 2 }],
  });
});
