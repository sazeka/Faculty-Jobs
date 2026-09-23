#!/usr/bin/env bash
# Faculty Atlas - daily LLM enrichment (runs on the Dell via cron).
#
# GitHub Actions only runs the rules-only enrichment pass (no GPU/Ollama there),
# so postings the rules can't classify wait for this job. It replaces the
# Jetson's old "Step 3/8 - Enrich" in daily-update.sh.
#
#   1. Reset the shared liveness clone to origin/main
#   2. Enrich up to $ENRICH_MAX unclassified postings with the local Ollama model
#      (discipline / tenureTrack / positionType; scripts/agent-job-enrichment.js)
#   3. Rebuild the site's data chunks, commit, push
#
# Aborts without pushing if the run changed postings that were already
# classified (enrichment should only fill gaps) beyond a small tolerance.
#
# Env overrides: LIVENESS_REPO, LIVENESS_RUNS, ENRICH_MAX, OLLAMA_MODEL, DRY_RUN=1
set -euo pipefail

REPO="${LIVENESS_REPO:-$HOME/faculty-jobs-liveness}"
RUNS="${LIVENESS_RUNS:-$HOME/liveness-runs}"
ENRICH_MAX="${ENRICH_MAX:-2000}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3.5:9b}"
export PATH="$HOME/local/node/bin:$PATH"

STAMP="$(date +%Y-%m-%d)"
RUN_DIR="$RUNS/enrich-$STAMP"
mkdir -p "$RUN_DIR"
exec > >(tee -a "$RUN_DIR/run.log") 2>&1

log() { echo "[$(date '+%F %T')] $*"; }

# Shares the clone with weekly-liveness-audit.sh; wait up to 3h for it.
exec 9>"$RUNS/.lock"
flock -w 10800 9 || { log "Clone busy for 3h; skipping today's enrichment."; exit 0; }

if ! curl -sf "http://${OLLAMA_HOST:-localhost:11434}/api/tags" | grep -q "\"$OLLAMA_MODEL\""; then
  log "ERROR: Ollama is not serving $OLLAMA_MODEL; skipping."
  exit 1
fi

cd "$REPO"

sync_to_origin() {
  git fetch --quiet origin main
  git checkout --quiet -B main origin/main
  git reset --quiet --hard origin/main
  git clean -fdq -e node_modules -e web-vue/node_modules
}

install_deps() {
  local sum
  sum="$(cat package-lock.json web-vue/package-lock.json 2>/dev/null | sha1sum | cut -d' ' -f1)"
  if [[ ! -f node_modules/.liveness-lock-sum || "$(cat node_modules/.liveness-lock-sum)" != "$sum" ]]; then
    log "Installing dependencies"
    npm ci --no-audit --no-fund --silent
    (cd web-vue && npm ci --no-audit --no-fund --silent)
    echo "$sum" > node_modules/.liveness-lock-sum
  fi
}

# discipline/tenureTrack/positionType of every already-classified posting
snapshot_classified() {
  node --input-type=module -e '
    import fs from "node:fs";
    import { readJobsFile } from "./scripts/lib/jobs-file.js";
    const out = {};
    for (const j of readJobsFile("public/jobs.json", { descriptions: false }).jobs) {
      if (j.discipline) out[j.canonicalJobId || j.url] = [j.discipline, j.tenureTrack ?? null, j.positionType ?? null];
    }
    fs.writeFileSync(process.argv[1], JSON.stringify(out));
    console.log(Object.keys(out).length);
  ' "$1"
}

enrich_and_build() {
  local before="$RUN_DIR/classified-before.json"
  local classified
  classified="$(snapshot_classified "$before")"
  log "Enriching up to $ENRICH_MAX postings with $OLLAMA_MODEL ($classified already classified)"
  # The agent saves after every batch, so a timeout still leaves usable progress.
  timeout 10800 npm run --silent agent:enrich -- --max "$ENRICH_MAX" --batch-size 25 \
    || log "Enrichment stopped early (exit $?); keeping the batches it saved"

  # Enrichment should only fill gaps (null/"Unknown" -> value); overwriting a
  # value that was already set, at scale, means something is wrong.
  local changed
  changed="$(node --input-type=module -e '
    import fs from "node:fs";
    import { readJobsFile } from "./scripts/lib/jobs-file.js";
    const before = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    let changed = 0;
    for (const j of readJobsFile("public/jobs.json", { descriptions: false }).jobs) {
      const b = before[j.canonicalJobId || j.url];
      if (!b) continue;
      const after = [j.discipline, j.tenureTrack ?? null, j.positionType ?? null];
      const isSet = (v) => v !== null && v !== undefined && v !== "" && v !== "Unknown";
      if (b.some((v, i) => isSet(v) && JSON.stringify(v) !== JSON.stringify(after[i]))) changed++;
    }
    console.log(changed);
  ' "$before")"
  local limit=$(( classified / 100 + 25 ))
  log "Existing classifications overwritten: $changed (limit $limit)"
  if (( changed > limit )); then
    log "ABORT: enrichment rewrote $changed existing classifications. Review $RUN_DIR; nothing pushed."
    exit 1
  fi

  save_enrichment "$before"
  rebuild_site_data
}

ENRICH_FIELDS='["discipline","tenureTrack","tenureEvidence","positionType"]'

# The fields this run filled, keyed by posting, so a push race can reapply them
# onto a newer main instead of re-running hours of model work.
save_enrichment() {
  node --input-type=module -e '
    import fs from "node:fs";
    import { readJobsFile } from "./scripts/lib/jobs-file.js";
    const [beforePath, outPath, fieldsJson] = process.argv.slice(1);
    const before = JSON.parse(fs.readFileSync(beforePath, "utf8"));
    const fields = JSON.parse(fieldsJson);
    const out = {};
    for (const j of readJobsFile("public/jobs.json", { descriptions: false }).jobs) {
      const key = j.canonicalJobId || j.url;
      if (!before[key] && j.discipline) out[key] = Object.fromEntries(fields.filter((f) => f in j).map((f) => [f, j[f]]));
    }
    fs.writeFileSync(outPath, JSON.stringify(out));
    console.log(`Saved ${Object.keys(out).length} newly enriched postings`);
  ' "$1" "$RUN_DIR/enriched.json" "$ENRICH_FIELDS"
}

# Apply saved results to postings still unclassified on the current checkout.
reapply_enrichment() {
  node --input-type=module -e '
    import fs from "node:fs";
    import { readJobsFile, writeJobsFile } from "./scripts/lib/jobs-file.js";
    const saved = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const payload = readJobsFile("public/jobs.json");
    let applied = 0;
    payload.jobs = payload.jobs.map((j) => {
      const s = saved[j.canonicalJobId || j.url];
      if (!s || j.discipline) return j;
      applied++;
      return { ...j, ...s };
    });
    writeJobsFile("public/jobs.json", payload);
    console.log(`Reapplied enrichment to ${applied} postings`);
  ' "$RUN_DIR/enriched.json"
}

rebuild_site_data() {
  node scripts/sync-web-data-files.js
  cp -R web-vue/public/data/. docs/data/
  cp -R web-vue/public/data/. public/data/
  node scripts/inject-og-meta.js
  npm run --silent jobs:normalize
  npm run --silent jobs:check
}

log "Syncing $REPO to origin/main"
sync_to_origin
install_deps

enrich_and_build
for attempt in 1 2 3; do
  git add public/jobs.json public/job-descriptions docs/index.html public/index.html \
    docs/data/ public/data/ generated/enrichment-report.json
  if git diff --cached --quiet; then
    log "Nothing to enrich. Done."
    exit 0
  fi
  [[ -f "$RUN_DIR/enrichment-report.json" ]] || cp generated/enrichment-report.json "$RUN_DIR/enrichment-report.json"
  cp "$RUN_DIR/enrichment-report.json" generated/enrichment-report.json
  git add generated/enrichment-report.json
  REPORT="$(node -e 'const r=require(process.argv[1]);console.log(`${r.enrichedThisRun} enriched this run; ${r.totalEnriched} total; ${r.remaining} remaining`)' "$RUN_DIR/enrichment-report.json")"
  git commit --quiet -F - <<EOF
Daily LLM enrichment $STAMP: $REPORT

Discipline, tenure status, and position type for postings the rules-only
pass in GitHub Actions couldn't classify, via $OLLAMA_MODEL on the Dell.

Automated via scripts/daily-enrichment.sh (Dell)
EOF
  if [[ "${DRY_RUN:-0}" == "1" ]]; then log "DRY RUN: not pushing ($REPORT)"; exit 0; fi
  if git push --quiet origin HEAD:main; then
    log "Pushed: $REPORT"
    exit 0
  fi
  # Another workflow pushed meanwhile: move to the new main and reapply this
  # run's results rather than merging generated files or re-running the model.
  log "Push rejected (attempt $attempt); reapplying results on latest origin/main"
  sync_to_origin
  reapply_enrichment
  rebuild_site_data
done

log "ERROR: could not push after 3 attempts"
exit 1
