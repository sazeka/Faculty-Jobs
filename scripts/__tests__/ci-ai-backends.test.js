import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('CI uses no-secret deterministic backends while local scripts default to Ollama', () => {
  const agentWorkflow = fs.readFileSync(path.join(ROOT, '.github/workflows/agent-team.yml'), 'utf8');
  const trendsWorkflow = fs.readFileSync(path.join(ROOT, '.github/workflows/weekly-trends.yml'), 'utf8');
  assert.match(agentWorkflow, /AI_BACKEND:\s*rules-only/);
  assert.match(trendsWorkflow, /AI_BACKEND:\s*template/);

  for (const yaml of [agentWorkflow, trendsWorkflow]) {
    assert.doesNotMatch(yaml, /ANTHROPIC_API_KEY|GITHUB_MODEL|models:\s*read|USE_CLAUDE/);
  }

  for (const script of ['agent-job-enrichment.js', 'generate-weekly-trends.js']) {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', script), 'utf8');
    assert.match(source, /process\.env\.AI_BACKEND \|\| ['"]ollama['"]/);
    assert.doesNotMatch(source, /ANTHROPIC_API_KEY|GITHUB_MODEL|USE_CLAUDE|api\.anthropic\.com|models\.github\.ai/);
  }
});

test('daily data-health workflow backfills 1,600 descriptions in recoverable batches', () => {
  const agentWorkflow = fs.readFileSync(path.join(ROOT, '.github/workflows/agent-team.yml'), 'utf8');
  assert.match(agentWorkflow, /for batch in 1 2 3 4/);
  assert.match(agentWorkflow, /npm run agent:descriptions -- --max 400 --concurrency 8/);
  assert.match(agentWorkflow, /name: Push description checkpoint/);
  assert.match(agentWorkflow, /timeout-minutes:\s*45/);
});

test('description backfill does not use the Workday-blocked bot user agent', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/agent-job-descriptions.js'), 'utf8');
  assert.doesNotMatch(source, /userAgent:\s*["']Mozilla\/5\.0 FacultyJobsDescBot/);
  assert.match(source, /chromium\.launch\(\{ headless: true \}\)/);
});

test('description backfill bounds browser lifecycle calls and writes atomic checkpoints', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/agent-job-descriptions.js'), 'utf8');
  assert.match(source, /withTimeout\(context\.newPage\(\), PAGE_CREATE_TIMEOUT_MS/);
  assert.match(source, /withTimeout\(page\.close\(\), PAGE_CLOSE_TIMEOUT_MS/);
  assert.match(source, /withTimeout\(context\.close\(\), 10000/);
  assert.match(source, /withTimeout\(browser\.close\(\), 10000/);
  assert.match(source, /fs\.renameSync\(tmp, p\)/);
});

test('focused description workflow restricts runs to an explicit platform', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/description-backfill.yml'), 'utf8');
  assert.match(workflow, /type:\s*choice/);
  assert.match(workflow, /DESC_PLATFORM:\s*\$\{\{ inputs\.platform \}\}/);
  assert.match(workflow, /npm run agent:descriptions -- --concurrency 8/);
  assert.doesNotMatch(workflow, /agent:data-health|agent:job-presence|agent:alert-issues|agent:discover/);
});
