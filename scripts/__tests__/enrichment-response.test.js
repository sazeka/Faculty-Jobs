import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignEnrichmentResults,
  validateAiTenureEvidence,
} from '../lib/enrichment-response.js';

test('aligns enrichment results by explicit item id instead of array order', () => {
  const aligned = alignEnrichmentResults([
    { itemId: 2, discipline: 'Economics' },
    { itemId: 1, discipline: 'Nursing' },
  ], 2);
  assert.equal(aligned[0].discipline, 'Nursing');
  assert.equal(aligned[1].discipline, 'Economics');
});

test('rejects missing, duplicate, and out-of-range enrichment item ids', () => {
  assert.equal(alignEnrichmentResults([{ discipline: 'Nursing' }], 1), null);
  assert.equal(alignEnrichmentResults([{ itemId: 1 }, { itemId: 1 }], 2), null);
  assert.equal(alignEnrichmentResults([{ itemId: 2 }], 1), null);
});

test('accepts tenure status only when an exact supporting quote is present', () => {
  const job = { description: 'This is a full-time, tenure-track faculty appointment.' };
  assert.equal(
    validateAiTenureEvidence('tenure-track', 'tenure-track faculty appointment', job),
    'tenure-track faculty appointment',
  );
  assert.equal(validateAiTenureEvidence('tenure-track', 'full-time faculty', job), null);
  assert.equal(validateAiTenureEvidence('tenure-track', 'tenure-track role', job), null);
});

test('does not mistake non-tenure evidence for positive tenure evidence', () => {
  const job = { description: 'This is a non-tenure-track teaching appointment.' };
  assert.equal(
    validateAiTenureEvidence('non-tenure-track', 'non-tenure-track teaching appointment', job),
    'non-tenure-track teaching appointment',
  );
  assert.equal(
    validateAiTenureEvidence('tenure-track', 'non-tenure-track teaching appointment', job),
    null,
  );
});
