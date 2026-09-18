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
 * Backend selection:
 *   default               → Ollama local
 *   AI_BACKEND=rules-only → deterministic classification only (Actions)
 *
 * Usage:
 *   node scripts/agent-job-enrichment.js [--dry-run] [--max <n>] [--batch-size <n>] [--concurrency <n>]
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import {
  classifyTenureTrack,
  classifyTenureTrackWithEvidence,
} from './lib/weekly-tenure-stats.js';
import {
  alignEnrichmentResults,
  validateAiTenureEvidence,
} from './lib/enrichment-response.js';
import {
  buildKnownDisciplineVocabulary,
  deriveDisciplineFromDepartment,
} from './lib/discipline-from-department.js';

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
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'localhost:11434';
// qwen3.5:9b (9.7B params, 262K context vs. qwen2.5:7b's much smaller window)
// -- confirmed on the Dell's 8GB laptop GPU that a cold load takes ~235s
// (vision-tower tensor conversion, unused by this text-only task, dominates
// that one-time cost) but generation itself is ~26-31 tok/s once warm, same
// ballpark as qwen2.5:7b. Requires "think": false below -- without it, this
// model burns hundreds of chain-of-thought tokens per request before its
// actual answer (measured: 843 tokens / 32s to answer a single trivial
// 2-field JSON question), which would multiply out badly across real
// 25-job batches. With think disabled, response time and token count are
// back in line with qwen2.5:7b.
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:9b';
const AI_BACKEND = process.env.AI_BACKEND || 'ollama';
// A hung/overloaded backend (e.g. Ollama swapping a 7B model on an 8GB
// Jetson, or thrashing under memory pressure) can accept the connection and
// then just never respond -- that isn't a connection-level failure, so
// req.on('error') never fires for it. With no timeout, the request promise
// (and the whole daily-update.sh pipeline, which has no shell-level guard on
// this step either) hangs forever. Same bug class as the 2026-07-27 5-day
// hang already fixed in agent-job-descriptions.js -- that fix never made it
// to this file. Ollama gets a generous budget since local inference on
// constrained hardware is genuinely slow. Bumped from 180s to 300s: a cold
// qwen3.5:9b load alone measured ~235s on the Dell, which would already
// trip the old 180s timeout on the very first batch of a run, before the
// model even finished loading -- wasting that whole batch on a doomed
// bisect-and-retry cascade (see processBatch below) rather than actually
// erroring on a genuinely stuck backend.
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 300_000);

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

// Description snippet length fed to the model. Titles alone rarely state tenure
// status or rank; the opening of a posting usually does. Kept short to bound
// tokens and keep batches reliable.
const DESC_SNIPPET_CHARS = 600;

function buildPrompt(batch) {
  const jobLines = batch
    .map((j, i) => {
      const dept = j.department ? ` [Dept: ${j.department}]` : '';
      const desc = String(j.description || '').replace(/\s+/g, ' ').trim();
      const snippet = desc ? `\n   Description: ${desc.slice(0, DESC_SNIPPET_CHARS)}` : '';
      return `${i + 1}. ${j.title}${dept}${snippet}`;
    })
    .join('\n');

  return `You are a structured data extractor for academic faculty job listings.

For each item, extract five fields:
1. discipline - the academic field (e.g., "Computer Science", "Nursing", "Mathematics", "English Literature"). Be specific. Return null if the item is not a real faculty job posting (e.g., a phone number, degree program name, or non-job listing).
2. tenureTrack - exactly one of: "tenure-track", "non-tenure-track", or "unknown". Do not infer tenure status from words such as full-time, faculty, professor, lecturer, or instructor. Use a non-unknown value only when the supplied text explicitly states the appointment track; otherwise return "unknown".
3. positionType - MUST be exactly one of these strings (no others allowed): "Assistant Professor", "Associate Professor", "Full Professor", "Open Rank", "Lecturer", "Instructor", "Adjunct", "Visiting", "Clinical", "Postdoctoral", "Research", "Other". Use "Other" for anything that does not fit.
4. itemId - copy the numbered item ID exactly. This is required even when other fields are null.
5. tenureEvidence - for a non-unknown tenureTrack, copy an exact short quote from the supplied title or description that explicitly supports the appointment track. Return null for unknown. Never paraphrase.

When a Description is provided, use it — it usually states tenure status, rank, and field more reliably than the title alone.

Return ONLY a JSON array with one object per item. No explanation, no markdown fences.

Example: [{"itemId":1,"discipline":"Computer Science","tenureTrack":"tenure-track","tenureEvidence":"tenure-track faculty appointment","positionType":"Assistant Professor"}]

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

// ── Ollama API ────────────────────────────────────────────────────────────────

// Grammar-constrains qwen3.5:9b's output to actually be a JSON array of
// per-item objects. A bare format:"json" string is *too* loose here: for a
// single-item batch it satisfied "valid JSON" by emitting one bare object
// instead of a 1-element array (observed live -- alignEnrichmentResults then
// saw a non-array and every single-item retry failed with "expected 1
// result, got 0"). An explicit schema pins the top level to an array.
// positionType deliberately has no enum -- coercePositionType already maps
// free-form answers like "Clinical Instructor" or "Postdoctoral Fellow" onto
// the valid set, and constraining generation to the enum directly would
// prevent the model from saying what it actually means when nothing in the
// enum fits well.
const ENRICHMENT_RESPONSE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      itemId: { type: 'integer' },
      discipline: { type: ['string', 'null'] },
      tenureTrack: { type: 'string', enum: ['tenure-track', 'non-tenure-track', 'unknown'] },
      tenureEvidence: { type: ['string', 'null'] },
      positionType: { type: 'string' },
    },
    required: ['itemId', 'discipline', 'tenureTrack', 'tenureEvidence', 'positionType'],
  },
};

function callOllama(batch) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: buildPrompt(batch) }],
      stream: false,
      // Disable qwen3.5's reasoning trace -- see the OLLAMA_MODEL comment
      // above. Ollama silently ignores this field for models without a
      // "thinking" capability (e.g. qwen2.5:7b), so it's safe to always send.
      think: false,
      // Without an explicit cap, a full 25-item batch's JSON array response
      // was silently truncated mid-array on qwen3.5:9b -- every single batch
      // failed alignEnrichmentResults' length check on the first attempt and
      // fell through to the bisect-and-retry path (observed live: batches 1-5
      // of a real run all mismatched at 25, then succeeded cleanly once split
      // to ~12-13). Root cause, confirmed by dumping the raw Ollama response
      // (done_reason: "length" after only ~71 output tokens): Ollama's
      // runtime num_ctx defaults to far less than qwen3.5:9b's 262K
      // architectural max, and a 25-item batch's prompt (title + up to 600
      // chars of description each) alone already used ~4,025 of that tiny
      // default window, leaving almost nothing for the output. Raising
      // num_predict alone did not fix it -- num_ctx must be raised too.
      // 32768 covers even a max-size 50-item batch's prompt (BATCH_SIZE is
      // capped at 50 above) plus an 8192-token completion with headroom.
      //
      // Fixing num_ctx surfaced a second, distinct bug: with qwen3.5:9b's
      // default temperature of 1.0 (meant for open-ended chat, not
      // structured extraction), it would drop the "},{" separator between
      // consecutive array items and merge all 25 objects into one object
      // with 25 repeated keys -- syntactically valid JSON (last key wins)
      // but semantically wrong, so alignEnrichmentResults saw an array of
      // length 1 and mismatched every time. A schema-constrained format
      // (see ENRICHMENT_RESPONSE_SCHEMA above) plus a low temperature fixes
      // both the shape and the wandering.
      format: ENRICHMENT_RESPONSE_SCHEMA,
      options: { num_predict: 8192, num_ctx: 32768, temperature: 0.1 },
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
            if (process.env.DEBUG_ENRICH) {
              fs.writeFileSync(`/tmp/enrich-debug-${Date.now()}.json`, JSON.stringify({ text, parsed }, null, 2));
            }
            if (!text) { reject(new Error(JSON.stringify(parsed))); return; }
            resolve(parseResponse(text));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.setTimeout(OLLAMA_TIMEOUT_MS, () => {
      req.destroy(new Error(`Ollama request timed out after ${OLLAMA_TIMEOUT_MS / 1000}s`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nFaculty Atlas - Job Enrichment Agent');
  if (DRY_RUN) console.log('  *** DRY RUN ***');

  if (AI_BACKEND === 'ollama') {
    console.log(`  Backend: Ollama (${OLLAMA_MODEL} @ ${OLLAMA_HOST})`);
  } else if (AI_BACKEND === 'rules-only') {
    console.log('  Backend: deterministic rules only');
  } else {
    throw new Error(`Unsupported AI_BACKEND: ${AI_BACKEND}`);
  }

  const enrichBatch = callOllama;

  const payload = readJson(PUBLIC_JOBS);
  if (!payload?.jobs?.length) {
    console.error('  Cannot read public/jobs.json');
    process.exit(1);
  }

  // Apply high-confidence deterministic classifications first. This resolves
  // explicit title/description language plus definitionally temporary ranks
  // without spending model tokens, and records why each decision was made.
  let deterministicTenureCount = 0;
  for (const job of payload.jobs) {
    // Check the stored field in isolation so the richer classifier can still
    // discover title/description evidence on records currently marked unknown.
    if (classifyTenureTrack({ tenureTrack: job.tenureTrack }) !== null) continue;
    const inferred = classifyTenureTrackWithEvidence(job);
    if (inferred.value === null) continue;
    deterministicTenureCount++;
    if (!DRY_RUN) {
      job.tenureTrack = inferred.value ? 'tenure-track' : 'non-tenure-track';
      job.tenureEvidence = inferred.evidence;
    }
  }

  // Fill `discipline` for free wherever the job's department string exactly
  // matches (after stripping common institutional boilerplate) a discipline
  // value the AI has already validated elsewhere in the dataset. Zero cost,
  // zero network calls -- runs even under AI_BACKEND=rules-only in CI.
  const disciplineVocabulary = buildKnownDisciplineVocabulary(payload.jobs);
  let deterministicDisciplineCount = 0;
  for (const job of payload.jobs) {
    if (job.discipline !== undefined) continue;
    const derived = deriveDisciplineFromDepartment(job.department, disciplineVocabulary);
    if (!derived) continue;
    deterministicDisciplineCount++;
    if (!DRY_RUN) job.discipline = derived;
  }

  const needsDiscipline = job => job.discipline === undefined;
  const needsTenure = job => classifyTenureTrack(job) === null;
  const candidates = payload.jobs
    .filter(job => needsDiscipline(job) || needsTenure(job))
    .sort((a, b) => {
      // Resolve unknown tenure statuses with usable descriptions first; those
      // are the cases where the model has actual evidence rather than a title-
      // only guess. Then continue the existing discipline backlog.
      const score = job => needsTenure(job) && String(job.description || '').trim() ? 0
        : needsDiscipline(job) ? 1
          : 2;
      return score(a) - score(b);
    });
  const toProcess = AI_BACKEND === 'rules-only' ? [] : candidates.slice(0, MAX);
  const tenureUnknown = payload.jobs.filter(needsTenure).length;
  const disciplineMissing = payload.jobs.filter(needsDiscipline).length;

  console.log(`\n  Total jobs       : ${payload.jobs.length.toLocaleString()}`);
  console.log(`  Discipline known : ${(payload.jobs.length - disciplineMissing).toLocaleString()}`);
  console.log(`  Tenure unknown   : ${tenureUnknown.toLocaleString()}`);
  console.log(`  Rule-classified  : ${deterministicTenureCount.toLocaleString()}`);
  console.log(`  Dept-derived now : ${deterministicDisciplineCount.toLocaleString()} (free, no AI)`);
  console.log(`  To process now   : ${toProcess.length.toLocaleString()} (max ${MAX})`);
  console.log(`  Batch size       : ${BATCH_SIZE}`);
  console.log(`  Concurrency      : ${CONCURRENCY}`);

  if (AI_BACKEND === 'rules-only') {
    if (DRY_RUN) {
      console.log(`\n  Would save ${deterministicTenureCount.toLocaleString()} rule-based tenure classifications and ${deterministicDisciplineCount.toLocaleString()} dept-derived disciplines. No files written.`);
      return;
    }
    if (deterministicTenureCount || deterministicDisciplineCount) {
      writeJson(PUBLIC_JOBS, payload);
      if (fs.existsSync(DOCS_JOBS)) writeJson(DOCS_JOBS, payload);
    }
    const totalEnriched = payload.jobs.filter(j => j.discipline !== undefined).length;
    writeJson(REPORT_PATH, {
      generatedAt: new Date().toISOString(),
      backend: 'rules-only',
      totalJobs: payload.jobs.length,
      enrichedThisRun: 0,
      totalEnriched,
      remaining: payload.jobs.length - totalEnriched,
      tenureClassifiedByRules: deterministicTenureCount,
      disciplineClassifiedByRules: deterministicDisciplineCount,
      tenureUnknown,
      errors: 0,
    });
    console.log(`\n  Saved ${deterministicTenureCount.toLocaleString()} rule-based tenure classifications and ${deterministicDisciplineCount.toLocaleString()} dept-derived disciplines.`);
    console.log('  Model enrichment skipped in CI; run locally with Ollama for remaining fields.');
    return;
  }

  if (toProcess.length === 0) {
    // candidates.length === 0 means every job genuinely has a discipline and
    // a known tenure status; MAX === 0 (or AI_BACKEND === 'rules-only', which
    // is handled above) can also reach here with real candidates still
    // outstanding, so totalEnriched must be counted, not assumed.
    console.log(candidates.length === 0
      ? '\n  All jobs already enriched. Nothing to do.'
      : `\n  Nothing to process this run (max ${MAX}); ${candidates.length.toLocaleString()} candidates remain.`);
    if (!DRY_RUN && (deterministicTenureCount || deterministicDisciplineCount)) {
      writeJson(PUBLIC_JOBS, payload);
      if (fs.existsSync(DOCS_JOBS)) writeJson(DOCS_JOBS, payload);
    }
    const totalEnriched = payload.jobs.filter(j => j.discipline !== undefined).length;
    writeJson(REPORT_PATH, {
      generatedAt: new Date().toISOString(),
      totalJobs: payload.jobs.length,
      enrichedThisRun: 0,
      totalEnriched,
      remaining: payload.jobs.length - totalEnriched,
      tenureClassifiedByRules: deterministicTenureCount,
      disciplineClassifiedByRules: deterministicDisciplineCount,
      tenureUnknown: payload.jobs.filter(needsTenure).length,
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

  // Persist deterministic work before making any external model calls. A bad
  // or expired API credential must not throw away thousands of rule-based
  // classifications discovered earlier in this run.
  if (deterministicTenureCount || deterministicDisciplineCount) {
    writeJson(PUBLIC_JOBS, payload);
    if (fs.existsSync(DOCS_JOBS)) writeJson(DOCS_JOBS, payload);
    console.log(`\n  Saved ${deterministicTenureCount.toLocaleString()} rule-based tenure classifications and ${deterministicDisciplineCount.toLocaleString()} dept-derived disciplines before AI enrichment.`);
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
  let aiTenureCount = 0;
  let nextBatch     = 0;

  // Process one batch. The local model frequently drops rows (or emits
  // malformed JSON) on larger batches, which would otherwise discard the
  // whole batch. So on a count mismatch or parse failure we bisect and retry
  // the halves recursively, down to single jobs — bad rows get isolated while
  // good ones still land in a single run. Returns the number enriched.
  async function processBatch(batch, label) {
    let results = null;
    let errMsg  = null;
    try {
      results = await enrichBatch(batch);
    } catch (err) {
      errMsg = err.message;
    }

    const alignedResults = alignEnrichmentResults(results, batch.length);
    const ok = Boolean(alignedResults);

    if (!ok) {
      // Authentication/configuration errors affect every row. Do not recursively
      // split a 25-row batch into hundreds of guaranteed-failing requests.
      if (/authentication_error|api key is invalid|unauthorized|forbidden|HTTP (401|403|429)/i.test(errMsg || '')) {
        throw new Error(`Fatal enrichment backend error: ${errMsg}`);
      }
      if (batch.length === 1) {
        // Genuinely un-enrichable on this pass; leave it for the next run.
        errorCount++;
        const why = errMsg || `expected 1 result, got ${results?.length ?? 0}`;
        console.log(`${label}... ERROR: ${why}`);
        return 0;
      }
      // Bisect and retry each half independently.
      const mid = Math.ceil(batch.length / 2);
      console.log(`${label}... mismatch, splitting into ${mid}+${batch.length - mid}`);
      const a = await processBatch(batch.slice(0, mid), `${label} ↳`);
      const b = await processBatch(batch.slice(mid), `${label} ↳`);
      return a + b;
    }

    let batchEnriched = 0;
    for (let j = 0; j < batch.length; j++) {
      const job    = jobIndex.get(batch[j].canonicalJobId);
      const result = alignedResults[j];
      if (!job || !result) continue;
      const norm = normalizeResult(result);
      if (
        job.discipline === undefined &&
        typeof norm.discipline === 'string' &&
        norm.discipline.trim()
      ) {
        job.discipline = norm.discipline.trim();
      }
      if (classifyTenureTrack(job) === null) {
        const evidence = validateAiTenureEvidence(norm.tenureTrack, result.tenureEvidence, job);
        if (evidence) {
          job.tenureTrack = norm.tenureTrack;
          job.tenureEvidence = 'ai-quoted';
          aiTenureCount++;
        }
      }
      if (!job.positionType || job.positionType === 'Unknown') job.positionType = norm.positionType;
      enrichedCount++;
      batchEnriched++;
    }

    // Save after each successful (sub)batch — partial progress is never lost
    writeJson(PUBLIC_JOBS, payload);
    if (fs.existsSync(DOCS_JOBS)) writeJson(DOCS_JOBS, payload);

    console.log(`${label}... done (+${batchEnriched})`);
    return batchEnriched;
  }

  // Worker: grabs the next available batch until all are done.
  async function worker() {
    while (nextBatch < totalBatches) {
      const batchIdx = nextBatch++;
      const batch    = batches[batchIdx];
      const label    = `  Batch ${batchIdx + 1}/${totalBatches} (${batch.length} jobs)`;
      await processBatch(batch, label);
    }
  }

  // Launch CONCURRENCY workers in parallel
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const totalEnriched = payload.jobs.filter(j => j.discipline !== undefined).length;

  writeJson(REPORT_PATH, {
    generatedAt:     new Date().toISOString(),
    totalJobs:       payload.jobs.length,
    enrichedThisRun: enrichedCount,
    tenureClassifiedByRules: deterministicTenureCount,
    disciplineClassifiedByRules: deterministicDisciplineCount,
    tenureClassifiedByAi: aiTenureCount,
    tenureUnknown: payload.jobs.filter(needsTenure).length,
    totalEnriched,
    remaining:       payload.jobs.length - totalEnriched,
    failedThisRun:   errorCount,
    config: { max: MAX, batchSize: BATCH_SIZE },
  });

  console.log(`\n  Enriched this run : ${enrichedCount} (AI) + ${deterministicDisciplineCount.toLocaleString()} (dept-derived)`);
  console.log(`  Total enriched    : ${totalEnriched.toLocaleString()} / ${payload.jobs.length.toLocaleString()}`);
  console.log(`  Tenure accepted   : ${aiTenureCount.toLocaleString()} (exact quoted evidence)`);
  if (errorCount) console.log(`  Jobs left for next run : ${errorCount}`);
  console.log(`  Report saved      : generated/enrichment-report.json`);
  console.log('');
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
