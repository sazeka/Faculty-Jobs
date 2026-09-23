#!/usr/bin/env bash
# Faculty Atlas - weekly posting liveness audit (runs on the Dell via cron).
#
#   1. Reset a dedicated clone to origin/main
#   2. Audit every posting (scripts/audit-posting-liveness.js, with Chromium)
#   3. Re-check everything flagged in an independent second pass
#   4. Exclude postings flagged closed/dead/expired/stale in BOTH passes
#      (data/post-quality-exclusions.json, which the daily scrape honors)
#   5. Drop them from jobs.json, rebuild the site, commit, push
#
# Aborts without pushing if the removal count looks implausible (a detection
# bug or a blocked network would otherwise wipe real postings).
#
# Env overrides: LIVENESS_REPO, LIVENESS_RUNS, LIVENESS_MAX_REMOVE_PCT, DRY_RUN=1
set -euo pipefail

REPO="${LIVENESS_REPO:-$HOME/faculty-jobs-liveness}"
RUNS="${LIVENESS_RUNS:-$HOME/liveness-runs}"
MAX_REMOVE_PCT="${LIVENESS_MAX_REMOVE_PCT:-5}"
export PATH="$HOME/local/node/bin:$PATH"
# Playwright has no Ubuntu 26.04 build yet; the 24.04 one runs fine.
export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE="${PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:-ubuntu24.04-x64}"

STAMP="$(date +%Y-%m-%d)"
RUN_DIR="$RUNS/$STAMP"
mkdir -p "$RUN_DIR"
exec > >(tee -a "$RUN_DIR/run.log") 2>&1

# One run at a time
exec 9>"$RUNS/.lock"
# Shares the clone with daily-enrichment.sh; wait up to 3h rather than skip a week.
flock -w 10800 9 || { echo "Clone busy for 3h; skipping this week's audit."; exit 0; }

log() { echo "[$(date '+%F %T')] $*"; }

cd "$REPO"

sync_to_origin() {
  git fetch --quiet origin main
  git checkout --quiet -B main origin/main
  git reset --quiet --hard origin/main
  git clean -fdq -e node_modules -e web-vue/node_modules
}

install_deps() {
  # Reinstall only when a lockfile changed since the last install
  local sum
  sum="$(cat package-lock.json web-vue/package-lock.json 2>/dev/null | sha1sum | cut -d' ' -f1)"
  if [[ ! -f node_modules/.liveness-lock-sum || "$(cat node_modules/.liveness-lock-sum)" != "$sum" ]]; then
    log "Installing dependencies"
    npm ci --no-audit --no-fund --silent
    (cd web-vue && npm ci --no-audit --no-fund --silent)
    ./node_modules/.bin/playwright install chromium >/dev/null
    echo "$sum" > node_modules/.liveness-lock-sum
  fi
}

# Build the flagged-postings subset for the confirmation pass
flagged_subset() {
  node -e '
    const [report, jobsPath, out] = process.argv.slice(1);
    const r = require(report);
    const bad = new Set(r.problems.filter((p) => ["closed", "dead", "expired", "stale"].includes(p.verdict)).map((p) => p.url));
    const jobs = require(jobsPath).jobs.filter((j) => bad.has(String(j.url || "").replace(/\s+/g, " ").trim()));
    require("fs").writeFileSync(out, JSON.stringify({ jobs }));
    console.log(jobs.length);
  ' "$1" "$REPO/public/jobs.json" "$2"
}

apply_and_build() {
  node scripts/apply-liveness-exclusions.js --report "$RUN_DIR/pass1/posting-liveness-report.json" \
    --confirm "$RUN_DIR/pass2/posting-liveness-report.json"
  npm run --silent clean:post-quality
  npm run --silent build:frontend
}

log "Syncing $REPO to origin/main"
sync_to_origin
install_deps
TOTAL="$(node -e 'console.log(require("./public/jobs.json").jobs.length)')"

log "Pass 1: auditing $TOTAL postings"
node scripts/audit-posting-liveness.js --fresh --browser --concurrency 32 --per-host 2 \
  --browser-concurrency 6 --out "$RUN_DIR/pass1"

FLAGGED="$(flagged_subset "$RUN_DIR/pass1/posting-liveness-report.json" "$RUN_DIR/flagged.json")"
log "Pass 2: re-checking $FLAGGED flagged postings"
if [[ "$FLAGGED" -eq 0 ]]; then log "Nothing flagged. Done."; exit 0; fi
node scripts/audit-posting-liveness.js --fresh --browser --jobs "$RUN_DIR/flagged.json" \
  --per-host 1 --out "$RUN_DIR/pass2"

CONFIRMED="$(node -e '
  const [a, b] = process.argv.slice(1).map((p) => require(p));
  const flag = (r) => new Set(r.problems.filter((p) => ["closed", "dead", "expired", "stale"].includes(p.verdict)).map((p) => p.url));
  const second = flag(b);
  console.log([...flag(a)].filter((u) => second.has(u)).length);
' "$RUN_DIR/pass1/posting-liveness-report.json" "$RUN_DIR/pass2/posting-liveness-report.json")"
LIMIT=$(( TOTAL * MAX_REMOVE_PCT / 100 ))
log "Confirmed in both passes: $CONFIRMED (safety limit $LIMIT = ${MAX_REMOVE_PCT}%)"
if [[ "$CONFIRMED" -gt "$LIMIT" ]]; then
  log "ABORT: $CONFIRMED removals exceeds the safety limit. Review $RUN_DIR and rerun with LIVENESS_MAX_REMOVE_PCT raised if it's real."
  exit 1
fi

for attempt in 1 2 3; do
  apply_and_build
  if git diff --quiet -- data/post-quality-exclusions.json; then
    log "No new exclusions (all already excluded). Done."
    exit 0
  fi
  npm run --silent jobs:normalize
  npm run --silent jobs:check
  # Same paths daily-update.sh stages, plus the exclusion ledger
  git add -A docs/ public/ generated/ web-vue/public/ data/institutions-master.json data/post-quality-exclusions.json
  ADDED="$(git diff --cached -U0 data/post-quality-exclusions.json | grep -c '^+ *"reason"' || true)"
  BREAKDOWN="$(git diff --cached -U0 data/post-quality-exclusions.json | grep '^+ *"reason"' | sed -E 's/.*"reason": "([^"]+)".*/\1/' | sort | uniq -c | awk '{printf "- %s: %s\n", $2, $1}')"
  git commit --quiet -F - <<EOF
Weekly liveness audit $STAMP: remove $ADDED closed/dead/expired postings

Postings flagged in two independent passes of
scripts/audit-posting-liveness.js on the Dell.

$BREAKDOWN

Automated via scripts/weekly-liveness-audit.sh (Dell)
EOF
  if [[ "${DRY_RUN:-0}" == "1" ]]; then log "DRY RUN: not pushing"; exit 0; fi
  if git push --quiet origin HEAD:main; then
    log "Pushed: removed $ADDED postings"
    exit 0
  fi
  # The daily scrape workflow (or another CI job) pushed in between. Rebuilding on the new
  # origin/main is cheaper and safer than merging generated files.
  log "Push rejected (attempt $attempt); rebuilding on latest origin/main"
  sync_to_origin
done

log "ERROR: could not push after 3 attempts"
exit 1
