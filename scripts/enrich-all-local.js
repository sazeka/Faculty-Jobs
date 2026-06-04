// Run the local Ollama enricher in repeated passes until the dataset is fully
// enriched or progress stalls. qwen2.5:7b drops items from larger batches, so we
// use small batches and re-sweep the stragglers each round. The enricher writes
// public/jobs.json + docs/jobs.json incrementally, so this is safe to interrupt
// and resume. Does NOT commit or rebuild chunks — do that after it finishes.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JOBS = path.join(ROOT, "public", "jobs.json");

const MAX_ROUNDS = Number(process.env.ENRICH_ROUNDS || 25);
const BATCH = process.env.ENRICH_BATCH || "6";
const CONC = process.env.ENRICH_CONCURRENCY || "4";

function unenrichedCount() {
  const d = JSON.parse(fs.readFileSync(JOBS, "utf8"));
  return d.jobs.filter((j) => j.discipline === undefined).length;
}

let prev = Infinity;
let stalls = 0;
for (let round = 1; round <= MAX_ROUNDS; round++) {
  const before = unenrichedCount();
  if (before === 0) {
    console.log(`✅ Fully enriched — nothing left.`);
    break;
  }
  console.log(`\n── Round ${round}: ${before} jobs still unenriched (batch=${BATCH}, conc=${CONC}) ──`);
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, "agent-job-enrichment.js"), "--max", "9999", "--batch-size", BATCH, "--concurrency", CONC],
    { cwd: ROOT, stdio: "inherit", env: process.env }
  );
  if (r.status !== 0) console.warn(`   (enricher exited ${r.status})`);
  const after = unenrichedCount();
  const done = before - after;
  console.log(`── Round ${round} done: enriched ${done}, ${after} remaining ──`);
  if (after === 0) {
    console.log(`✅ Fully enriched after ${round} round(s).`);
    break;
  }
  // Stop if a round makes no headway twice in a row (model can't classify the rest).
  if (after >= prev) {
    stalls += 1;
    if (stalls >= 2) {
      console.log(`⚠️  No progress for 2 rounds; stopping with ${after} unenriched (likely unclassifiable).`);
      break;
    }
  } else {
    stalls = 0;
  }
  prev = after;
}
console.log(`\nFinal: ${unenrichedCount()} unenriched remaining.`);
