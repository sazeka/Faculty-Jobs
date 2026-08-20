import https from 'https';

export const DEFAULT_GITHUB_MODEL = 'openai/gpt-4.1-mini';
export const GITHUB_MODELS_HOST = 'models.github.ai';
export const GITHUB_MODELS_PATH = '/inference/chat/completions';

export function buildGitHubModelsBody({
  prompt,
  model = DEFAULT_GITHUB_MODEL,
  maxTokens,
  temperature = 0,
}) {
  return {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature,
  };
}

export function extractGitHubModelsText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`GitHub Models returned no text: ${JSON.stringify(payload)}`);
  }
  return content.trim();
}

export function callGitHubModels({
  prompt,
  token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  model = process.env.GITHUB_MODEL || DEFAULT_GITHUB_MODEL,
  maxTokens = 1024,
  temperature = 0,
  timeoutMs = Number(process.env.GITHUB_MODELS_TIMEOUT_MS || 90_000),
}) {
  if (!token) {
    return Promise.reject(new Error('GITHUB_TOKEN is required when AI_BACKEND=github-models'));
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(buildGitHubModelsBody({ prompt, model, maxTokens, temperature }));
    const req = https.request(
      {
        hostname: GITHUB_MODELS_HOST,
        path: GITHUB_MODELS_PATH,
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2026-03-10',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (err) {
            reject(new Error(`GitHub Models returned invalid JSON (HTTP ${res.statusCode}): ${err.message}`));
            return;
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const detail = parsed?.message || parsed?.error?.message || JSON.stringify(parsed);
            reject(new Error(`GitHub Models HTTP ${res.statusCode}: ${detail}`));
            return;
          }

          try {
            resolve(extractGitHubModelsText(parsed));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`GitHub Models request timed out after ${timeoutMs / 1000}s`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
