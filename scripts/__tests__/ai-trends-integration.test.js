import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const generator = readFileSync(new URL('../generate-weekly-trends.js', import.meta.url), 'utf8');
const pages = readFileSync(new URL('../generate-trends-pages.js', import.meta.url), 'utf8');
const component = readFileSync(new URL('../../web-vue/src/components/TrendsTab.vue', import.meta.url), 'utf8');

test('weekly outputs persist versioned AI counts and history points', () => {
  assert.match(generator, /aiHiringBreakdown: statsForPrompt\.aiHiringBreakdown/);
  assert.match(generator, /aiRelatedJobs: h\.aiHiringBreakdown\?\.related \?\? null/);
  assert.match(generator, /aiClassifierVersion: h\.aiHiringBreakdown\?\.classifierVersion \?\? null/);
});

test('interactive and static trends surfaces explain the AI hiring metric', () => {
  assert.match(component, /AI hiring pulse/);
  assert.match(component, /Strict classifier v/);
  assert.match(pages, /AI hiring pulse/);
  assert.match(pages, /Broad data-science and robotics listings are excluded/);
});
