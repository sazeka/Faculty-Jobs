export const RESPONSIBLE_TECH_CLASSIFIER_VERSION = 2;

const AI = String.raw`(?:ai|artificial[\s-]+intelligence|machine[\s-]+learning)`;
// "Responsible AI use/integration/practices" describes adopting AI tools in
// teaching or operations, not responsible-tech scholarship.
const NOT_TOOL_USE = String.raw`(?![\s-]+(?:use|usage|integration|training|practices|adoption|literacy|tools|framework))`;
const ONLINE = String.raw`(?:online|digital|social[\s-]+media|platforms?|algorithmic|computational|${AI})`;

// Specific phrases that signal responsible-tech work wherever they appear,
// including long descriptions.
const STRONG_SIGNALS = [
  ['Responsible & trustworthy AI', new RegExp(String.raw`\b(?:responsible|trustworthy|explainable|fair)[\s-]+${AI}\b${NOT_TOOL_USE}`, 'i')],
  ['AI & technology ethics', new RegExp(String.raw`\b${AI}[\s-]+ethics\b|\bethics[\s-]+(?:of|in)[\s-]+(?:${AI}|technology|computing|data|algorithms)\b|\b(?:technology|tech|data|computing|digital|information)[\s-]+ethics\b`, 'i')],
  ['Algorithmic fairness & accountability', /\balgorithmic[\s-]+(?:fairness|bias|justice|accountability|transparency|harms?|discrimination)\b/i],
  ['AI governance & policy', new RegExp(String.raw`\b${AI}[\s-]+(?:governance|policy|safety|regulation|law)\b|\bgovernance[\s-]+of[\s-]+(?:${AI}|technology|algorithms)\b`, 'i')],
  ['Public interest technology', /\bpublic[\s-]+interest[\s-]+(?:technology|tech|computing)\b/i],
  ['Societal impacts of technology', new RegExp(String.raw`\bsocietal[\s-]+(?:impacts?|implications)[\s-]+of[\s-]+(?:${AI}|technology|computing|algorithms)\b`, 'i')],
  ['Privacy, justice & information integrity', /\bprivacy[\s-]+(?:preserving|enhancing)\b|\bdata[\s-]+justice\b|\bdigital[\s-]+rights\b|\btrust[\s-]+(?:and|&)[\s-]+safety\b/i],
  // Misinformation counts only near an online/AI context, so civics or
  // health-communication roles that mention it in passing are excluded.
  ['Privacy, justice & information integrity', new RegExp(String.raw`\b${ONLINE}\b[^.;]{0,80}\b(?:mis|dis)information\b|\b(?:mis|dis)information\b[^.;]{0,80}\b${ONLINE}\b`, 'i')],
];

// Phrases that turn up in campus initiatives and program lists ("Good
// Systems (AI for Good)", "minors in ... Human-Centered AI"), so in a
// description they count only when the role itself is computing-related.
const COMPUTING_ROLE = new RegExp(String.raw`\b(?:${AI}|comput\w*|informatics?|information|technolog\w*|digital|cyber\w*|software|engineering|robotics?)\b`, 'i');
const CONTEXT_SIGNALS = [
  ['Responsible & trustworthy AI', new RegExp(String.raw`\b(?:ethical|human[\s-]+centered)[\s-]+${AI}\b${NOT_TOOL_USE}`, 'i')],
  ['Public interest technology', /\b(?:ai|computing|technology|data[\s-]+science)[\s-]+for[\s-]+(?:social[\s-]+)?good\b/i],
];

// Phrases that are often program lists, course catalogs, or lab-policy
// boilerplate in descriptions, so they only count in the title, department,
// or declared specialization.
const CORE_ONLY_SIGNALS = [
  ['Societal impacts of technology', new RegExp(String.raw`\b(?:${AI}|technology|computing)[\s,]+(?:and|&)[\s-]+society\b`, 'i')],
  ['AI governance & policy', /\b(?:technology|tech|information|digital)[\s-]+policy\b/i],
  ['Privacy, justice & information integrity', /\bdata[\s-]+privacy\b/i],
];

export const RESPONSIBLE_TECH_THEMES = [...new Set(STRONG_SIGNALS.map(([label]) => label))];

function plainText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyResponsibleTechJob(job = {}) {
  const coreText = [job.title, job.department, job.specialization]
    .map(plainText)
    .filter(Boolean)
    .join(' ');
  const fullText = [coreText, job.summary, job.description]
    .map(plainText)
    .filter(Boolean)
    .join(' ');

  const themes = [
    ...STRONG_SIGNALS.filter(([, pattern]) => pattern.test(fullText)),
    ...CORE_ONLY_SIGNALS.filter(([, pattern]) => pattern.test(coreText)),
    ...CONTEXT_SIGNALS.filter(([, pattern]) => pattern.test(COMPUTING_ROLE.test(coreText) ? fullText : coreText)),
  ].map(([label]) => label);

  return {
    related: themes.length > 0,
    themes: [...new Set(themes)],
    classifierVersion: RESPONSIBLE_TECH_CLASSIFIER_VERSION,
  };
}

export function computeResponsibleTechBreakdown(jobs = []) {
  const byInstitution = new Map();
  const byTheme = new Map(RESPONSIBLE_TECH_THEMES.map((theme) => [theme, 0]));
  const listings = [];

  for (const job of jobs) {
    const { related, themes } = classifyResponsibleTechJob(job);
    if (!related) continue;
    for (const theme of themes) byTheme.set(theme, byTheme.get(theme) + 1);
    const institution = String(job?.college || '').trim();
    if (institution) byInstitution.set(institution, (byInstitution.get(institution) || 0) + 1);
    listings.push({
      title: plainText(job.title),
      institution,
      url: job.url || null,
      themes,
    });
  }

  const total = jobs.length;
  const related = listings.length;
  return {
    related,
    total,
    sharePct: total ? Number(((related / total) * 100).toFixed(1)) : 0,
    classifierVersion: RESPONSIBLE_TECH_CLASSIFIER_VERSION,
    byTheme: [...byTheme.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([theme, count]) => ({ theme, count })),
    topInstitutions: [...byInstitution.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([institution, count]) => ({ institution, count })),
    listings: listings.sort((a, b) => a.institution.localeCompare(b.institution) || a.title.localeCompare(b.title)),
  };
}

// Keeps every week's matched listings (not just counts) so the set of
// responsible-tech postings can be reviewed over time. Re-running a week
// replaces that week's entry.
export function updateResponsibleTechListingHistory(archive = [], weekEnd, breakdown) {
  const entry = {
    weekEnd,
    classifierVersion: breakdown.classifierVersion,
    related: breakdown.related,
    listings: breakdown.listings,
  };
  return [...archive.filter((week) => week.weekEnd !== weekEnd), entry]
    .sort((a, b) => a.weekEnd.localeCompare(b.weekEnd));
}
