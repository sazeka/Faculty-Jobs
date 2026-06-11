#!/usr/bin/env node
/**
 * agent-job-enrichment.js
 *
 * Enriches job records with AI-extracted fields:
 *   - discipline:   academic field (e.g., "Computer Science", "Nursing")
 *   - tenureTrack:  "tenure-track" | "non-tenure-track" | "unknown"
 *   - positionType: normalized category (e.g., "Assistant Professor", "Adjunct")
 *
 * Only processes jobs missing the `discipline` field. Batches 25 jobs per
 * API call for cost efficiency. Saves progress after each batch so partial
 * runs are never lost.
 *
 * Backend selection (automatic):
 *   ANTHROPIC_API_KEY set → Claude Haiku (used in CI/GitHub Actions)
 *   not set              → Ollama local (used on developer machines)
 *
 * Usage:
 *   node scripts/agent-job-enrichment.js [--dry-run] [--max <n>] [--batch-size <n>] [--concurrency <n>]
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PUBLIC_JOBS = path.join(ROOT, 'public', 'jobs.json');
const DOCS_JOBS   = path.join(ROOT, 'docs',   'jobs.json');
const REPORT_PATH = path.join(ROOT, 'generated', 'enrichment-report.json');

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

const args        = parseArgs(process.argv.slice(2));
const DRY_RUN     = Boolean(args['dry-run']);
const MAX         = Number(args['max'] || process.env.AI_ENRICH_MAX || 500);
const BATCH_SIZE  = Math.min(Number(args['batch-size'] || 25), 50);
const CONCURRENCY = Math.min(Number(args['concurrency'] || process.env.AI_ENRICH_CONCURRENCY || 1), 8);
const API_KEY     = process.env.ANTHROPIC_API_KEY;
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const USE_OLLAMA  = process.env.USE_CLAUDE !== '1';

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf8');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Prompt + validation ───────────────────────────────────────────────────────

const VALID_POSITION_TYPES = new Set([
  'Assistant Professor', 'Associate Professor', 'Full Professor', 'Open Rank',
  'Lecturer', 'Instructor', 'Adjunct', 'Visiting', 'Clinical',
  'Postdoctoral', 'Research', 'Other',
]);

const VALID_TENURE_TRACK = new Set(['tenure-track', 'non-tenure-track', 'unknown']);

// The local model frequently returns descriptive or compound positionType
// strings outside the allowed enum (e.g. "Assistant/Associate/Full Professor",
// "Clinical Instructor", "Postdoctoral Fellow"). Map the common variants onto a
// valid value instead of collapsing every off-enum answer to "Other".
function coercePositionType(raw) {
  if (typeof raw !== 'string') return 'Other';
  if (VALID_POSITION_TYPES.has(raw)) return raw;
  const s = raw.toLowerCase();

  // Compound / open-rank signals first: any "X/Y" rank slash or explicit phrasing.
  if (/open[\s-]?rank|all\s+ranks?|any\s+rank|multiple\s+ranks?/.test(s)) return 'Open Rank';
  const rankHits = ['assistant', 'associate', 'full'].filter(r => s.includes(r)).length;
  if (s.includes('professor') && (rankHits >= 2 || s.includes('/'))) return 'Open Rank';

  // Distinct categories that may co-occur with a rank word — match these before
  // the plain rank checks so "Clinical Assistant Professor" → Clinical, etc.
  if (s.includes('postdoc')) return 'Postdoctoral';
  if (s.includes('adjunct')) return 'Adjunct';
  if (s.includes('visiting')) return 'Visiting';
  if (s.includes('clinical')) return 'Clinical';

  // Single ranks.
  if (s.includes('assistant professor') || /\basst\.?\s*prof/.test(s)) return 'Assistant Professor';
  if (s.includes('associate professor') || /\bassoc\.?\s*prof/.test(s)) return 'Associate Professor';
  if (s.includes('full professor') || /^professor\b/.test(s) || /\bfull\s+prof/.test(s)) return 'Full Professor';

  if (s.includes('lecturer')) return 'Lecturer';
  if (s.includes('instructor')) return 'Instructor';
  if (s.includes('research')) return 'Research';

  return 'Other';
}

// The model is inconsistent on tenureTrack: casing ("Tenure-Track"), spacing
// ("tenure track", "non tenure track"), and synonyms ("tenured", "NTT") all
// fall outside the enum and were being dropped to "unknown". Normalize and map
// the common variants. Check non-tenure first — "non-tenure-track" contains the
// substring "tenure".
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
  const jobLines = batch
    .map((j, i) => {
      const dept = j.department ? ` [Dept: ${j.department}]` : '';
      return `${i + 1}. ${j.title}${dept}`;
    })
    .join('\n');

  return `You are a structured data extractor for academic faculty job listings.

For each item, extract three fields:
1. discipline - the academic field (e.g., "Computer Science", "Nursing", "Mathematics", "English Literature"). Be specific. Return null if the item is not a real faculty job posting (e.g., a phone number, degree program name, or non-job listing).
2. tenureTrack - exactly one of: "tenure-track", "non-tenure-track", or "unknown"
3. positionType - MUST be exactly one of these strings (no others allowed): "Assistant Professor", "Associate Professor", "Full Professor", "Open Rank", "Lecturer", "Instructor", "Adjunct", "Visiting", "Clinical", "Postdoctoral", "Research", "Other". Use "Other" for anything that does not fit.

Return ONLY a JSON array with one object per item in the same order. No explanation, no markdown fences.

Example: [{"discipline":"Computer Science","tenureTrack":"tenure-track","positionType":"Assistant Professor"}]

Items:
${jobLines}`;
}

function normalizeResult(result) {
  return {
    discipline:   result.discipline ?? null,
    tenureTrack:  coerceTenureTrack(result.tenureTrack),
    positionType: coercePositionType(result.positionType),
  };
}

function parseResponse(text) {
  const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(clean);
}

// ── Claude API ────────────────────────────────────────────────────────────────

function callClaude(batch) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildPrompt(batch) }],
    });

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed?.content?.[0]?.text?.trim();
            if (!text) { reject(new Error(JSON.stringify(parsed))); return; }
            resolve(parseResponse(text));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Ollama API ────────────────────────────────────────────────────────────────

function callOllama(batch) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: buildPrompt(batch) }],
      stream: false,
    });

    const [hostname, port] = OLLAMA_HOST.split(':');
    const req = http.request(
      {
        hostname,
        port: Number(port) || 11434,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed?.message?.content?.trim();
            if (!text) { reject(new Error(JSON.stringify(parsed))); return; }
            resolve(parseResponse(text));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nFaculty Atlas - Job Enrichment Agent');
  if (DRY_RUN) console.log('  *** DRY RUN ***');

  if (USE_OLLAMA) {
    console.log(`  Backend: Ollama (${OLLAMA_MODEL} @ ${OLLAMA_HOST})`);
  } else {
    console.log('  Backend: Claude Haiku (Anthropic API)');
  }

  const enrichBatch = USE_OLLAMA ? callOllama : callClaude;

  const payload = readJson(PUBLIC_JOBS);
  if (!payload?.jobs?.length) {
    console.error('  Cannot read public/jobs.json');
    process.exit(1);
  }

  const unenriched = payload.jobs.filter(j => j.discipline === undefined);
  const toProcess  = unenriched.slice(0, MAX);

  console.log(`\n  Total jobs       : ${payload.jobs.length.toLocaleString()}`);
  console.log(`  Already enriched : ${(payload.jobs.length - unenriched.length).toLocaleString()}`);
  console.log(`  To process now   : ${toProcess.length.toLocaleString()} (max ${MAX})`);
  console.log(`  Batch size       : ${BATCH_SIZE}`);
  console.log(`  Concurrency      : ${CONCURRENCY}`);

  if (toProcess.length === 0) {
    console.log('\n  All jobs already enriched. Nothing to do.');
    writeJson(REPORT_PATH, {
      generatedAt: new Date().toISOString(),
      totalJobs: payload.jobs.length,
      enrichedThisRun: 0,
      totalEnriched: payload.jobs.length,
      errors: 0,
    });
    return;
  }

  if (DRY_RUN) {
    console.log('\n  Sample jobs that would be enriched:');
    for (const j of toProcess.slice(0, 5)) {
      console.log(`    ${j.college} — ${j.title?.slice(0, 70)}`);
    }
    console.log(`\n  Would make ${Math.ceil(toProcess.length / BATCH_SIZE)} API calls. No files written.`);
    return;
  }

  // Index by canonicalJobId for fast in-place mutation
  const jobIndex = new Map(payload.jobs.map(j => [j.canonicalJobId, j]));

  // Build batch list up front
  const batches = [];
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    batches.push(toProcess.slice(i, i + BATCH_SIZE));
  }
  const totalBatches = batches.length;

  let enrichedCount = 0;
  let errorCount    = 0;
  let nextBatch     = 0;

  // Worker: grabs the next available batch until all are done.
  async function worker() {
    while (nextBatch < totalBatches) {
      const batchIdx = nextBatch++;
      const batch    = batches[batchIdx];
      const label    = `  Batch ${batchIdx + 1}/${totalBatches} (${batch.length} jobs)`;

      try {
        const results = await enrichBatch(batch);

        if (!Array.isArray(results) || results.length !== batch.length) {
          throw new Error(`Expected ${batch.length} results, got ${results?.length}`);
        }

        let batchEnriched = 0;
        for (let j = 0; j < batch.length; j++) {
          const job    = jobIndex.get(batch[j].canonicalJobId);
          const result = results[j];
          if (!job || !result) continue;
          const norm = normalizeResult(result);
          job.discipline   = norm.discipline;
          job.tenureTrack  = norm.tenureTrack;
          job.positionType = norm.positionType;
          enrichedCount++;
          batchEnriched++;
        }

        // Save after each batch — partial progress is never lost
        writeJson(PUBLIC_JOBS, payload);
        if (fs.existsSync(DOCS_JOBS)) writeJson(DOCS_JOBS, payload);

        console.log(`${label}... done (+${batchEnriched})`);
      } catch (err) {
        errorCount++;
        console.log(`${label}... ERROR: ${err.message}`);
        // Leave these jobs unenriched so they're retried next run
      }
    }
  }

  // Launch CONCURRENCY workers in parallel
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const totalEnriched = payload.jobs.filter(j => j.discipline !== undefined).length;

  writeJson(REPORT_PATH, {
    generatedAt:     new Date().toISOString(),
    totalJobs:       payload.jobs.length,
    enrichedThisRun: enrichedCount,
    totalEnriched,
    remaining:       payload.jobs.length - totalEnriched,
    errors:          errorCount,
    config: { max: MAX, batchSize: BATCH_SIZE },
  });

  console.log(`\n  Enriched this run : ${enrichedCount}`);
  console.log(`  Total enriched    : ${totalEnriched.toLocaleString()} / ${payload.jobs.length.toLocaleString()}`);
  if (errorCount) console.log(`  Batch errors      : ${errorCount}`);
  console.log(`  Report saved      : generated/enrichment-report.json`);
  console.log('');
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
