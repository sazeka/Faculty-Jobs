#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const DISCOVER_SCRIPT = path.join(ROOT, "scripts", "discover-career-pages.js");
const REPORT_PATH = path.join(ROOT, "generated", "career-discovery-report.json");
const CHECKPOINT_DIR = path.join(ROOT, "generated", "career-discovery-checkpoints");

function usage() {
  console.log(
    "Usage: node scripts/discover-careers-batch.js [--batch-size N] [--max-batches N] [--pause-ms N] [--delay-ms N] [--min-confidence 0.65] [--rebuild-coverage]"
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    batchSize: 100,
    maxBatches: 25,
    pauseMs: 1200,
    delayMs: 700,
    minConfidence: 0.65,
    rebuildCoverage: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    }
    if (a === "--batch-size" && args[i + 1]) out.batchSize = Math.max(1, Number(args[++i]));
    else if (a === "--max-batches" && args[i + 1]) out.maxBatches = Math.max(1, Number(args[++i]));
    else if (a === "--pause-ms" && args[i + 1]) out.pauseMs = Math.max(0, Number(args[++i]));
    else if (a === "--delay-ms" && args[i + 1]) out.delayMs = Math.max(0, Number(args[++i]));
    else if (a === "--min-confidence" && args[i + 1]) {
      out.minConfidence = Math.max(0, Math.min(1, Number(args[++i])));
    } else if (a === "--rebuild-coverage") out.rebuildCoverage = true;
  }

  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toISOString().replace(/[.:]/g, "-");
}

function runNodeScript(scriptPath, args, label) {
  const proc = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    throw new Error(`${label} failed with exit code ${proc.status}`);
  }
}

function readReport() {
  return JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
}

async function main() {
  const opts = parseArgs(process.argv);

  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });

  console.log(
    `Starting career discovery batch run (batchSize=${opts.batchSize}, maxBatches=${opts.maxBatches}, minConfidence=${opts.minConfidence})`
  );

  const summary = {
    startedAt: new Date().toISOString(),
    options: opts,
    batches: [],
    totals: {
      scanned: 0,
      updated: 0,
      discovered: 0,
      unresolved: 0,
      inferredPlatform: 0,
    },
  };

  for (let i = 1; i <= opts.maxBatches; i++) {
    console.log(`\n=== Batch ${i}/${opts.maxBatches} ===`);
    runNodeScript(
      DISCOVER_SCRIPT,
      [
        "--apply",
        "--limit",
        String(opts.batchSize),
        "--delay-ms",
        String(opts.delayMs),
        "--min-confidence",
        String(opts.minConfidence),
      ],
      "discover-career-pages"
    );

    const report = readReport();
    const checkpoint = {
      batch: i,
      createdAt: new Date().toISOString(),
      report,
    };

    const checkpointPath = path.join(CHECKPOINT_DIR, `batch-${String(i).padStart(3, "0")}-${timestamp()}.json`);
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2) + "\n", "utf8");
    console.log(`Checkpoint written: ${path.relative(ROOT, checkpointPath)}`);

    summary.batches.push({
      batch: i,
      checkpoint: path.relative(ROOT, checkpointPath),
      scanned: report.scanned || 0,
      updated: report.updated || 0,
      discovered: report.discovered || 0,
      unresolved: report.unresolved || 0,
      inferredPlatform: report.inferredPlatform || 0,
    });

    summary.totals.scanned += report.scanned || 0;
    summary.totals.updated += report.updated || 0;
    summary.totals.discovered += report.discovered || 0;
    summary.totals.unresolved += report.unresolved || 0;
    summary.totals.inferredPlatform += report.inferredPlatform || 0;

    if ((report.scanned || 0) === 0) {
      console.log("No remaining unresolved targets. Stopping batch run.");
      break;
    }

    if (opts.pauseMs > 0 && i < opts.maxBatches) await sleep(opts.pauseMs);
  }

  summary.finishedAt = new Date().toISOString();
  const summaryPath = path.join(CHECKPOINT_DIR, `run-summary-${timestamp()}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  console.log(`\nBatch run summary: ${path.relative(ROOT, summaryPath)}`);

  if (opts.rebuildCoverage) {
    console.log("\nRebuilding coverage artifacts...");
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const proc = spawnSync(npmCmd, ["run", "build:coverage"], { cwd: ROOT, stdio: "inherit" });
    if (proc.status !== 0) throw new Error(`build:coverage failed with exit code ${proc.status}`);
  }
}

main().catch((err) => {
  console.error(`\n❌ discover:careers:batch failed: ${err?.message || err}`);
  process.exit(1);
});
