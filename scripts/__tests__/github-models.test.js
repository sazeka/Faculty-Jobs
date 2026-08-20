import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildGitHubModelsBody,
  extractGitHubModelsText,
  GITHUB_MODELS_HOST,
  GITHUB_MODELS_PATH,
} from '../lib/github-models.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('builds a GitHub Models chat-completion request', () => {
  assert.equal(GITHUB_MODELS_HOST, 'models.github.ai');
  assert.equal(GITHUB_MODELS_PATH, '/inference/chat/completions');
  assert.deepEqual(buildGitHubModelsBody({
    prompt: 'Classify this job',
    model: 'openai/gpt-4.1-mini',
    maxTokens: 200,
  }), {
    model: 'openai/gpt-4.1-mini',
    messages: [{ role: 'user', content: 'Classify this job' }],
    max_tokens: 200,
    temperature: 0,
  });
});

test('extracts text and rejects malformed GitHub Models responses', () => {
  assert.equal(extractGitHubModelsText({
    choices: [{ message: { content: '  result  ' } }],
  }), 'result');
  assert.throws(() => extractGitHubModelsText({ choices: [] }), /returned no text/);
});

test('CI uses GitHub Models while local scripts default to Ollama', () => {
  for (const workflow of ['agent-team.yml', 'weekly-trends.yml']) {
    const yaml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', workflow), 'utf8');
    assert.match(yaml, /models:\s*read/);
    assert.match(yaml, /AI_BACKEND:\s*github-models/);
    assert.match(yaml, /GITHUB_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/);
    assert.doesNotMatch(yaml, /ANTHROPIC_API_KEY|USE_CLAUDE/);
  }

  for (const script of ['agent-job-enrichment.js', 'generate-weekly-trends.js']) {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', script), 'utf8');
    assert.match(source, /process\.env\.AI_BACKEND \|\| ['"]ollama['"]/);
    assert.doesNotMatch(source, /ANTHROPIC_API_KEY|USE_CLAUDE|api\.anthropic\.com/);
  }
});
