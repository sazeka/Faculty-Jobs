export const AI_HIRING_CLASSIFIER_VERSION = 1;

const EXPLICIT_AI_SIGNALS = [
  ['artificial intelligence', /\bartificial[\s-]+intelligence\b/i],
  ['machine learning', /\bmachine[\s-]+learning\b/i],
  ['deep learning', /\bdeep[\s-]+learning\b/i],
  ['generative AI', /\bgenerative[\s-]+ai\b/i],
  ['large language models', /\blarge[\s-]+language[\s-]+models?\b/i],
  ['natural language processing', /\bnatural[\s-]+language[\s-]+processing\b/i],
  ['computer vision', /\bcomputer[\s-]+vision\b/i],
  ['reinforcement learning', /\breinforcement[\s-]+learning\b/i],
  ['neural networks', /\bneural[\s-]+networks?\b/i],
  ['responsible AI', /\b(?:responsible|trustworthy|explainable)[\s-]+ai\b/i],
];

function plainText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyAiRelatedJob(job = {}) {
  const coreText = [job.title, job.department, job.specialization]
    .map(plainText)
    .filter(Boolean)
    .join(' ');
  const fullText = [coreText, job.summary, job.description]
    .map(plainText)
    .filter(Boolean)
    .join(' ');

  const matchedTerms = EXPLICIT_AI_SIGNALS
    .filter(([, pattern]) => pattern.test(fullText))
    .map(([label]) => label);

  // Standalone "AI" is strong evidence in a title, department, or declared
  // specialization, but is too ambiguous in long descriptions and legal LLM
  // program text to use there by itself.
  if (/\bAI(?:[\s/-]*ML)?\b/.test(coreText)) matchedTerms.push('AI');

  return {
    related: matchedTerms.length > 0,
    matchedTerms: [...new Set(matchedTerms)],
    classifierVersion: AI_HIRING_CLASSIFIER_VERSION,
  };
}

export function computeAiHiringBreakdown(jobs = []) {
  const byInstitution = new Map();
  let related = 0;

  for (const job of jobs) {
    if (!classifyAiRelatedJob(job).related) continue;
    related += 1;
    const institution = String(job?.college || '').trim();
    if (institution) byInstitution.set(institution, (byInstitution.get(institution) || 0) + 1);
  }

  const total = jobs.length;
  return {
    related,
    total,
    sharePct: total ? Number(((related / total) * 100).toFixed(1)) : 0,
    classifierVersion: AI_HIRING_CLASSIFIER_VERSION,
    topInstitutions: [...byInstitution.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([institution, count]) => ({ institution, count })),
  };
}
