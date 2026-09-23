#!/usr/bin/env node
/**
 * agent-department-enrichment.js
 *
 * AI-assisted department backfill for jobs the mechanical extractors (title
 * pattern in department-inference.js, labeled "Department:" field in
 * labeled-posting-fields.js) couldn't resolve -- the ones that have a full
 * description but no clean pattern to latch onto. An LLM reads the prose the
 * way a human would ("...joining our Department of Biochemistry...") instead
 * of pattern-matching for it.
 *
 * Same architecture as agent-job-enrichment.js: Ollama chat completions,
 * batched, with bisect-and-retry on a malformed/misaligned response. The
 * anti-hallucination bar is the same idea as that script's tenure evidence
 * check (scripts/lib/enrichment-response.js): the model must supply a short
 * verbatim quote from the job's own text naming the department, and that
 * quote is checked to actually appear in the source and be on-topic for the
 * claimed department before the value is accepted (see
 * validateAiDepartmentEvidence in scripts/lib/department-inference.js).
 * Correctness over coverage -- an accepted department is only ever written
 * when the model's own supporting evidence checks out; nothing here is ever
 * accepted on the model's say-so alone.
 *
 * Usage:
 *   node scripts/agent-department-enrichment.js [--dry-run] [--max <n>] [--batch-size <n>] [--concurrency <n>]
 *
 * Point OLLAMA_HOST at a remote box running Ollama (e.g. a Tailscale IP) to
 * run inference there instead of locally: OLLAMA_HOST=100.87.14.30:11434
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { alignEnrichmentResults } from './lib/enrichment-response.js';
import { validateAiDepartmentEvidence } from './lib/department-inference.js';
import { readJobsFileOrNull, writeJobsFile } from './lib/jobs-file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PUBLIC_JOBS = path.join(ROOT, 'public', 'jobs.json');
const REPORT_PATH = path.join(ROOT, 'generated', 'department-ai-enrichment-report.json');

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

const args = parseArgs(process.argv.slice(2));
const DRY_RUN = Boolean(args['dry-run']);
const MAX = Number(args['max'] || process.env.AI_DEPT_MAX || 500);
// Smaller default batch than agent-job-enrichment.js: each job here carries a
// much longer description snippet (the department can be mentioned anywhere
// in the body, not just the opening), so fewer jobs fit per request's context
// budget.
const BATCH_SIZE = Math.min(Number(args['batch-size'] || 10), 25);
const CONCURRENCY = Math.min(Number(args['concurrency'] || process.env.AI_DEPT_CONCURRENCY || 1), 8);
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
// Same reasoning as agent-job-enrichment.js's identical guard: an overloaded
// or memory-thrashing Ollama backend can accept the connection and then just
// never respond, which is not a connection-level failure -- without a
// request-level timeout that hangs this process (and any pipeline calling
// it) forever.
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 180_000);
const DESC_SNIPPET_CHARS = Number(args['desc-chars'] || 1800);

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf8');
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildPrompt(batch) {
  const jobLines = batch
    .map((j, i) => {
      const desc = String(j.description || '').replace(/\s+/g, ' ').trim();
      return `${i + 1}. Title: ${j.title}\n   Description: ${desc.slice(0, DESC_SNIPPET_CHARS)}`;
    })
    .join('\n\n');

  return `You are a careful data extractor for academic faculty job postings.

For each item, find the specific academic department, division, or unit the position belongs to (e.g. "Department of Biochemistry", "Division of Cardiology", "School of Nursing"). Read the description text; the department is often mentioned in an introductory sentence, even when there is no labeled "Department:" field.

For each item return:
1. itemId - copy the numbered item ID exactly. Required even when department is null.
2. department - the department/division/unit name, in the same words used in the text. Return null if the text never actually names one -- do not guess from the job title's subject area, and do not invent a plausible-sounding department that isn't actually stated.
3. quote - a short exact quote (5-15 words) copied verbatim from the Description that names the department. Return null if department is null. This must be copied exactly, not paraphrased -- your answer will be rejected if the quote does not appear in the original text.

Return ONLY a JSON array with one object per item. No explanation, no markdown fences.

Example: [{"itemId":1,"department":"Department of Biochemistry","quote":"joining our Department of Biochemistry as we expand"}]

Items:
${jobLines}`;
}

function parseResponse(text) {
  const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(clean);
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
        res.on('data', (c) => (data += c));
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
  console.log('\nFaculty Atlas - Department Enrichment Agent');
  if (DRY_RUN) console.log('  *** DRY RUN ***');
  console.log(`  Backend: Ollama (${OLLAMA_MODEL} @ ${OLLAMA_HOST})`);

  const payload = readJobsFileOrNull(PUBLIC_JOBS);
  if (!payload?.jobs?.length) {
    console.error('  Cannot read public/jobs.json');
    process.exit(1);
  }

  // Only jobs the mechanical extractors already gave up on -- must have a
  // description for the model to actually read, and no department yet.
  const needsDepartment = (job) => !job.department || !String(job.department).trim();
  const candidates = payload.jobs.filter(
    (job) => needsDepartment(job) && String(job.description || '').trim()
  );
  const toProcess = candidates.slice(0, MAX);
  const missingTotal = payload.jobs.filter(needsDepartment).length;

  console.log(`\n  Total jobs         : ${payload.jobs.length.toLocaleString()}`);
  console.log(`  Missing department : ${missingTotal.toLocaleString()}`);
  console.log(`  Have description   : ${candidates.length.toLocaleString()} (eligible for this pass)`);
  console.log(`  To process now     : ${toProcess.length.toLocaleString()} (max ${MAX})`);
  console.log(`  Batch size         : ${BATCH_SIZE}`);
  console.log(`  Concurrency        : ${CONCURRENCY}`);

  if (toProcess.length === 0) {
    console.log('\n  Nothing eligible. Nothing to do.');
    writeJson(REPORT_PATH, {
      generatedAt: new Date().toISOString(),
      totalJobs: payload.jobs.length,
      filledThisRun: 0,
      missingDepartment: missingTotal,
      errors: 0,
    });
    return;
  }

  if (DRY_RUN) {
    console.log('\n  Sample jobs that would be processed:');
    for (const j of toProcess.slice(0, 5)) console.log(`    ${j.college} — ${(j.title || '').slice(0, 70)}`);
    console.log(`\n  Would make ${Math.ceil(toProcess.length / BATCH_SIZE)} API calls. No files written.`);
    return;
  }

  const jobIndex = new Map(payload.jobs.map((j) => [j.canonicalJobId, j]));

  const batches = [];
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) batches.push(toProcess.slice(i, i + BATCH_SIZE));
  const totalBatches = batches.length;

  let filledCount = 0;
  let errorCount = 0;
  let nextBatch = 0;

  // Same bisect-on-mismatch retry as agent-job-enrichment.js: an off-count or
  // malformed response from a smaller local model shouldn't discard an entire
  // batch's worth of otherwise-good rows.
  async function processBatch(batch, label) {
    let results = null;
    let errMsg = null;
    try {
      results = await callOllama(batch);
    } catch (err) {
      errMsg = err.message;
    }

    const alignedResults = alignEnrichmentResults(results, batch.length);
    if (!alignedResults) {
      if (/authentication_error|api key is invalid|unauthorized|forbidden|HTTP (401|403|429)/i.test(errMsg || '')) {
        throw new Error(`Fatal enrichment backend error: ${errMsg}`);
      }
      if (batch.length === 1) {
        errorCount++;
        console.log(`${label}... ERROR: ${errMsg || `expected 1 result, got ${results?.length ?? 0}`}`);
        return 0;
      }
      const mid = Math.ceil(batch.length / 2);
      console.log(`${label}... mismatch, splitting into ${mid}+${batch.length - mid}`);
      const a = await processBatch(batch.slice(0, mid), `${label} ↳`);
      const b = await processBatch(batch.slice(mid), `${label} ↳`);
      return a + b;
    }

    let batchFilled = 0;
    for (let j = 0; j < batch.length; j++) {
      const job = jobIndex.get(batch[j].canonicalJobId);
      const result = alignedResults[j];
      if (!job || !result || !needsDepartment(job)) continue;
      const accepted = validateAiDepartmentEvidence(result.department, result.quote, job);
      if (accepted) {
        job.department = accepted;
        job.departmentInferredFrom = 'ai-quoted';
        filledCount++;
        batchFilled++;
      }
    }

    // Save after each successful (sub)batch -- partial progress is never lost.
    writeJobsFile(PUBLIC_JOBS, payload);

    console.log(`${label}... done (+${batchFilled}/${batch.length})`);
    return batchFilled;
  }

  async function worker() {
    while (nextBatch < totalBatches) {
      const batchIdx = nextBatch++;
      const batch = batches[batchIdx];
      const label = `  Batch ${batchIdx + 1}/${totalBatches} (${batch.length} jobs)`;
      await processBatch(batch, label);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const remaining = payload.jobs.filter(needsDepartment).length;
  writeJson(REPORT_PATH, {
    generatedAt: new Date().toISOString(),
    totalJobs: payload.jobs.length,
    filledThisRun: filledCount,
    missingDepartmentBefore: missingTotal,
    missingDepartmentAfter: remaining,
    failedThisRun: errorCount,
    config: { max: MAX, batchSize: BATCH_SIZE, model: OLLAMA_MODEL },
  });

  console.log(`\n  Filled this run    : ${filledCount.toLocaleString()}`);
  console.log(`  Missing department : ${missingTotal.toLocaleString()} -> ${remaining.toLocaleString()}`);
  if (errorCount) console.log(`  Jobs left for next run : ${errorCount}`);
  console.log(`  Report saved       : generated/department-ai-enrichment-report.json\n`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
