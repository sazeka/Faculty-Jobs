#!/usr/bin/env bash
# daily-update.sh
# Faculty Atlas - daily scrape, build, commit, and push automation.
# Linux/Jetson port of daily-update.ps1. Scheduled via systemd timer
# (see deploy/jetson/faculty-atlas-daily-update.timer) at 2:00 AM.
#
# Usage: ./daily-update.sh [--dry-run]

set -uo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=1
fi

# -- Paths ---------------------------------------------------------------
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$PROJECT_ROOT/generated/automation-logs"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
LOG_FILE="$LOG_DIR/daily-update-$TIMESTAMP.log"

mkdir -p "$LOG_DIR"

# -- Logging ---------------------------------------------------------------
log() {
    local level="${2:-INFO}"
    local line
    line="[$(date +%H:%M:%S)] [$level] $1"
    echo "$line"
    echo "$line" >> "$LOG_FILE" 2>/dev/null || true
}

log_section() {
    local sep
    sep=$(printf -- '-%.0s' {1..50})
    log ""
    log "$sep"
    log "  $1"
    log "$sep"
}

# -- Run a command, logging stdout/stderr line-by-line, without aborting --
invoke_step() {
    local label="$1"
    shift
    log "Running: $*"

    local out err exit_code
    out="$(mktemp)"
    err="$(mktemp)"

    "$@" >"$out" 2>"$err"
    exit_code=$?

    while IFS= read -r line; do log "  $line"; done < "$out"
    while IFS= read -r line; do log "  [stderr] $line"; done < "$err"
    rm -f "$out" "$err"

    if [[ $exit_code -ne 0 ]]; then
        log "$label FAILED (exit code $exit_code)" "ERROR"
        return 1
    fi
    log "$label succeeded." "OK"
    return 0
}

# -- Find npm and git --------------------------------------------------------
NPM_CMD="$(command -v npm || true)"
GIT_CMD="$(command -v git || true)"

if [[ -z "$NPM_CMD" ]]; then
    log "npm not found on PATH. Aborting." "ERROR"
    exit 1
fi

cd "$PROJECT_ROOT"

# -- Environment -------------------------------------------------------------
# Orin Nano (8GB): a 7B model + Chromium + Node leaves little headroom, so
# default enrichment to a smaller quantized model. Override by exporting
# OLLAMA_MODEL before invoking this script.
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"

# -- Main ---------------------------------------------------------------------
log "================================================"
log "  Faculty Atlas - Daily Update"
log "  $(date '+%A, %B %d %Y %H:%M:%S')"
log "  Project: $PROJECT_ROOT"
[[ $DRY_RUN -eq 1 ]] && log "  *** DRY RUN - no commit or push ***" "WARN"
log "================================================"

OVERALL_SUCCESS=1

# 1. Scrape
log_section "Step 1/8 - Scrape jobs"
SCRAPED=1
invoke_step "Scrape" "$NPM_CMD" run scrape:json || SCRAPED=0
if [[ $SCRAPED -eq 0 ]]; then
    log "Scrape failed - aborting to preserve existing data." "ERROR"
    OVERALL_SUCCESS=0
    # Don't exit - still run monitor so we know the site is still up.
fi

# 2-6. Agent pipeline (local Ollama) then build - only if scrape succeeded.
# Each step is best-effort: preserveEnrichment already carries prior
# enrichment/firstSeen/datePosted, so a skipped or partial step degrades
# gracefully instead of losing data.
if [[ $SCRAPED -eq 1 ]]; then
    log_section "Step 2/8 - Track job presence (stamp firstSeen, purge expired)"
    invoke_step "Job presence" "$NPM_CMD" run agent:job-presence || true

    log_section "Step 3/8 - Enrich new jobs (discipline/positionType/tenureTrack via local Ollama)"
    # A hung/overloaded Ollama server (e.g. swapping a 7B model under memory
    # pressure on an 8GB Jetson) used to be able to hang this step forever --
    # agent-job-enrichment.js's raw http.request() calls had no timeout, so a
    # connection that got accepted but never answered would never reject.
    # That's now fixed at the request level (OLLAMA_TIMEOUT_MS), but this
    # shell-level backstop matches the Descriptions step below in case some
    # other unbounded path turns up later — same lesson as the 2026-07-27
    # 5-day hang. 1800s (30 min) is a generous multiple of a normal run.
    invoke_step "Enrich" timeout 1800 "$NPM_CMD" run agent:enrich -- --max 1500 --batch-size 6 || true

    log_section "Step 4/8 - Backfill descriptions + posting dates (datePosted)"
    # This step hung for 5 days straight on 2026-07-27 (a page.evaluate() call
    # with no bound, since fixed in agent-job-descriptions.js) — nothing here
    # protected against it, and daily-update.sh has no other watchdog, so the
    # stuck systemd service blocked every subsequent nightly run until someone
    # manually intervened. A normal run takes ~15 minutes (checked across 5
    # successful runs); 45 minutes is a generous multiple that still bounds a
    # hang instead of letting it block the pipeline indefinitely.
    invoke_step "Descriptions" timeout 2700 "$NPM_CMD" run agent:descriptions -- --max 2000 --concurrency 8 || true

    log_section "Step 5/8 - Build frontend"
    BUILT=1
    invoke_step "Build" "$NPM_CMD" run build:frontend || BUILT=0
    if [[ $BUILT -eq 0 ]]; then
        log "Build failed - skipping commit." "ERROR"
        OVERALL_SUCCESS=0
    else
        # 6. Commit and push
        log_section "Step 6/8 - Commit and push"
        if [[ $DRY_RUN -eq 1 ]]; then
            log "DRY RUN: skipping git commit and push." "WARN"
        elif [[ -z "$GIT_CMD" ]]; then
            log "git not found on PATH - skipping commit." "ERROR"
            OVERALL_SUCCESS=0
        else
            # Stage everything the build pipeline touches. Must cover ALL
            # files the scrape modifies (generated/ reports, web-vue/public/
            # data) or the working tree stays dirty and the rebase -X theirs
            # recovery below aborts with "commit your changes or stash them",
            # silently stranding the push.
            invoke_step "git add" "$GIT_CMD" add -A \
                docs/ public/ generated/ web-vue/public/ \
                data/institutions-master.json || true

            if [[ -n "$("$GIT_CMD" -C "$PROJECT_ROOT" status --porcelain)" ]]; then
                DATE_LABEL="$(date +%Y-%m-%d)"
                MSG_FILE="$(mktemp)"
                printf 'Daily scrape update %s\n\nAutomated via daily-update.sh (Jetson)\n' "$DATE_LABEL" > "$MSG_FILE"

                COMMITTED=1
                invoke_step "git commit" "$GIT_CMD" commit -F "$MSG_FILE" || COMMITTED=0
                rm -f "$MSG_FILE"

                if [[ $COMMITTED -eq 1 ]]; then
                    PUSHED=1
                    invoke_step "git push" "$GIT_CMD" push || PUSHED=0
                    if [[ $PUSHED -eq 0 ]]; then
                        # Remote moved (CI's agent-team pass commits between our
                        # commit and push) -> non-fast-forward. Rebase onto
                        # latest, preferring our fresh scrape data on conflict.
                        log "Push rejected - rebasing onto latest origin/main (autostash)..." "WARN"
                        for attempt in 1 2 3 4 5; do
                            REBASED=1
                            invoke_step "git pull --rebase -X theirs --autostash (attempt $attempt)" \
                                "$GIT_CMD" pull --rebase -X theirs --autostash origin main || REBASED=0
                            if [[ $REBASED -eq 0 ]]; then
                                # Leave no half-applied rebase behind for the next run.
                                invoke_step "git rebase --abort" "$GIT_CMD" rebase --abort || true
                            fi
                            invoke_step "git push (retry $attempt)" "$GIT_CMD" push && { PUSHED=1; break; } || PUSHED=0
                        done
                        if [[ $PUSHED -eq 0 ]]; then
                            log "Push failed after 5 rebase/push attempts." "ERROR"
                            OVERALL_SUCCESS=0
                        fi
                    fi
                else
                    log "Commit failed." "ERROR"
                    OVERALL_SUCCESS=0
                fi
            else
                log "No changes to commit - data unchanged since last run." "OK"
            fi
        fi
    fi
fi

# 7. Validate job posting URLs
log_section "Step 7/8 - Validate job URLs"
invoke_step "Verify job URLs" "$NPM_CMD" run verify:job-urls || true

# 8. Monitor live site
log_section "Step 8/8 - Monitor live site"
if [[ $DRY_RUN -eq 0 && $SCRAPED -eq 1 ]]; then
    log "Waiting 30s for GitHub Pages to propagate..."
    sleep 30
fi
invoke_step "Monitor" "$NPM_CMD" run monitor:live || true

# -- Summary ------------------------------------------------------------------
log ""
log "================================================"
if [[ $OVERALL_SUCCESS -eq 1 ]]; then
    log "  [SUCCESS] Daily update completed."
else
    log "  [FAILED]  Daily update finished with errors - check log."
fi
log "  Log: $LOG_FILE"
log "================================================"
log ""

# Keep only the 30 most recent log files
find "$LOG_DIR" -maxdepth 1 -name "daily-update-*.log" -type f -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | tail -n +31 | cut -d' ' -f2- | xargs -r rm -f

if [[ $OVERALL_SUCCESS -eq 1 ]]; then
    exit 0
else
    exit 1
fi
