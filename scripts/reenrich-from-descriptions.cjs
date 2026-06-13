// One-off description-aware re-enrich. The base enricher historically saw only
// the title, so tenureTrack stayed "unknown" and some disciplines stayed null
// even when the posting text states them. This re-runs the local model with a
// description snippet on the rows that need help AND have a description, then
// applies the coercion. Writes public/jobs.json + docs/jobs.json; run
// rebuild-data-chunks-all.js afterward to reach the chunks.
//
// Update rules are strictly improving — we never regress a good value:
//   - tenureTrack: only when currently "unknown"
//   - discipline:  only when currently null/undefined (backfill) and new is real
//   - positionType: only when currently "Other" (bonus recovery)
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC_JOBS = path.join(ROOT, 'public', 'jobs.json');
const DOCS_JOBS = path.join(ROOT, 'docs', 'jobs.json');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 4);
const DESC_SNIPPET_CHARS = 600;
const SAVE_EVERY = 20; // batches

const VALID_POSITION_TYPES = new Set([
  'Assistant Professor', 'Associate Professor', 'Full Professor', 'Open Rank',
  'Lecturer', 'Instructor', 'Adjunct', 'Visiting', 'Clinical',
  'Postdoctoral', 'Research', 'Other',
]);
const VALID_TENURE_TRACK = new Set(['tenure-track', 'non-tenure-track', 'unknown']);

// The model sometimes returns a sentinel string in the discipline slot for
// non-jobs ("unknown", "n/a", ...). These are not real disciplines — reject
// them so we don't backfill garbage.
const NON_DISCIPLINE = new Set(['unknown', 'n/a', 'na', 'none', 'null', 'not specified', 'not applicable', 'other']);
function isRealDiscipline(v) {
  return v != null && String(v).trim().length > 0 && !NON_DISCIPLINE.has(String(v).trim().toLowerCase());
}

function coercePositionType(raw) {
  if (typeof raw !== 'string') return 'Other';
  if (VALID_POSITION_TYPES.has(raw)) return raw;
  const s = raw.toLowerCase();
  if (/open[\s-]?rank|all\s+ranks?|any\s+rank|multiple\s+ranks?/.test(s)) return 'Open Rank';
  const rankHits = ['assistant', 'associate', 'full'].filter(r => s.includes(r)).length;
  if (s.includes('professor') && (rankHits >= 2 || s.includes('/'))) return 'Open Rank';
  if (s.includes('postdoc')) return 'Postdoctoral';
  if (s.includes('adjunct')) return 'Adjunct';
  if (s.includes('visiting')) return 'Visiting';
  if (s.includes('clinical')) return 'Clinical';
  if (s.includes('assistant professor') || /\basst\.?\s*prof/.test(s)) return 'Assistant Professor';
  if (s.includes('associate professor') || /\bassoc\.?\s*prof/.test(s)) return 'Associate Professor';
  if (s.includes('full professor') || /^professor\b/.test(s) || /\bfull\s+prof/.test(s)) return 'Full Professor';
  if (s.includes('lecturer')) return 'Lecturer';
  if (s.includes('instructor')) return 'Instructor';
  if (s.includes('research')) return 'Research';
  return 'Other';
}

function coerceTenureTrack(raw) {
  if (typeof raw !== 'string') return 'unknown';
  if (VALID_TENURE_TRACK.has(raw)) return raw;
  const s = raw.toLowerCase().trim().replace(/[\s_]+/g, '-');
  if (/non-?tenure/.test(s) || /\bntt\b/.test(s)) return 'non-tenure-track';
  if (/tenure-track|tenured|tenure-eligible|tenure-eligibility|\btt\b/.test(s)) return 'tenure-track';
  if (s.includes('tenure')) return 'tenure-track';
  return 'unknown';
}

function buildPrompt(batch) {
  const jobLines = batch.map((j, i) => {
    const dept = j.department ? ` [Dept: ${j.department}]` : '';
    const desc = String(j.description || '').replace(/\s+/g, ' ').trim();
    const snippet = desc ? `\n   Description: ${desc.slice(0, DESC_SNIPPET_CHARS)}` : '';
    return `${i + 1}. ${j.title}${dept}${snippet}`;
  }).join('\n');
  return `You are a structured data extractor for academic faculty job listings.

For each item, extract three fields:
1. discipline - the academic field (e.g., "Computer Science", "Nursing", "Mathematics", "English Literature"). Be specific. Return null if the item is not a real faculty job posting.
2. tenureTrack - exactly one of: "tenure-track", "non-tenure-track", or "unknown"
3. positionType - MUST be exactly one of these strings (no others allowed): "Assistant Professor", "Associate Professor", "Full Professor", "Open Rank", "Lecturer", "Instructor", "Adjunct", "Visiting", "Clinical", "Postdoctoral", "Research", "Other". Use "Other" for anything that does not fit.

When a Description is provided, use it — it usually states tenure status, rank, and field more reliably than the title alone.

Return ONLY a JSON array with one object per item in the same order. No explanation, no markdown fences.

Example: [{"discipline":"Computer Science","tenureTrack":"tenure-track","positionType":"Assistant Professor"}]

Items:
${jobLines}`;
}

function parseResponse(text) {
  const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  const m = clean.match(/\[[\s\S]*\]/);
  return JSON.parse(m ? m[0] : clean);
}

function callOllama(batch) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: OLLAMA_MODEL, messages: [{ role: 'user', content: buildPrompt(batch) }], stream: false });
    const req = http.request({
      hostname: 'localhost', port: 11434, path: '/api/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed?.message?.content?.trim();
          if (!text) return reject(new Error('empty response'));
          resolve(parseResponse(text));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function save(payload) {
  fs.writeFileSync(PUBLIC_JOBS, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  if (fs.existsSync(DOCS_JOBS)) fs.writeFileSync(DOCS_JOBS, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(PUBLIC_JOBS, 'utf8'));
  const jobs = payload.jobs;
  const needs = (j) => (j.tenureTrack === 'unknown' || j.discipline === null || j.discipline === undefined);
  const hasDesc = (j) => String(j.description || '').trim().length > 100;
  const targets = jobs.filter(j => needs(j) && hasDesc(j));
  console.log(`Description-aware re-enrich targets: ${targets.length} (need help + have description) of ${jobs.length}`);

  const stats = { batches: 0, ttRecovered: 0, discBackfilled: 0, ptRecovered: 0, items: 0, dropped: 0, errors: 0 };
  const totalBatches = Math.ceil(targets.length / BATCH_SIZE);

  for (let b = 0; b < totalBatches; b++) {
    const batch = targets.slice(b * BATCH_SIZE, b * BATCH_SIZE + BATCH_SIZE);
    let results;
    try {
      results = await callOllama(batch);
    } catch (e) {
      stats.errors++;
      console.log(`batch ${b + 1}/${totalBatches} ERROR: ${e.message}`);
      continue;
    }
    if (!Array.isArray(results)) { stats.errors++; continue; }
    if (results.length < batch.length) stats.dropped += batch.length - results.length;

    const n = Math.min(results.length, batch.length);
    for (let i = 0; i < n; i++) {
      const job = batch[i];
      const r = results[i] || {};
      // tenureTrack: improve only when currently unknown.
      if (job.tenureTrack === 'unknown') {
        const newTT = coerceTenureTrack(r.tenureTrack);
        if (newTT !== 'unknown') { job.tenureTrack = newTT; stats.ttRecovered++; }
      }
      // discipline: backfill only when currently missing and the model returned
      // a real field (not an "unknown"/"n/a" sentinel).
      if ((job.discipline === null || job.discipline === undefined) && isRealDiscipline(r.discipline)) {
        job.discipline = String(r.discipline).trim(); stats.discBackfilled++;
      } else if (job.discipline === undefined) {
        job.discipline = null;
      }
      // positionType: recover only when currently Other.
      if (job.positionType === 'Other') {
        const newPT = coercePositionType(r.positionType);
        if (newPT !== 'Other') { job.positionType = newPT; stats.ptRecovered++; }
      }
      stats.items++;
    }
    stats.batches++;

    if ((b + 1) % SAVE_EVERY === 0 || b === totalBatches - 1) {
      save(payload);
      console.log(`batch ${b + 1}/${totalBatches} | items ${stats.items} | tenure +${stats.ttRecovered} | discipline +${stats.discBackfilled} | positionType +${stats.ptRecovered} | dropped ${stats.dropped} | errors ${stats.errors} (saved)`);
    }
  }

  save(payload);
  console.log('\nDONE');
  console.log(JSON.stringify(stats, null, 2));
}

main();
