# daily-update.ps1
# Faculty Atlas - daily scrape, build, commit, and push automation.
# Scheduled to run at 2:00 AM via Windows Task Scheduler.
# To register: run scripts/setup-task-scheduler.ps1 as Administrator (once).

param(
    [switch]$DryRun   # Pass -DryRun to simulate without committing or pushing
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# -- Paths --------------------------------------------------------------------
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir      = Join-Path $ProjectRoot "generated\automation-logs"
$Timestamp   = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$LogFile     = Join-Path $LogDir "daily-update-$Timestamp.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# -- Logging ------------------------------------------------------------------
function Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[$(Get-Date -Format 'HH:mm:ss')] [$Level] $Message"
    Write-Host $line
    try { Add-Content -Path $LogFile -Value $line -ErrorAction Stop } catch {}
}

function LogSection {
    param([string]$Title)
    $sep = "-" * 50
    Log ""
    Log $sep
    Log "  $Title"
    Log $sep
}

# -- Run a command via Start-Process (no pipeline — survives session events) --
function Invoke-Step {
    param(
        [string]$Label,
        [string]$Command,
        [string[]]$Arguments
    )
    Log "Running: $Command $($Arguments -join ' ')"

    $stdOut = [System.IO.Path]::GetTempFileName()
    $stdErr = [System.IO.Path]::GetTempFileName()

    try {
        $proc = Start-Process `
            -FilePath $Command `
            -ArgumentList $Arguments `
            -WorkingDirectory $ProjectRoot `
            -RedirectStandardOutput $stdOut `
            -RedirectStandardError $stdErr `
            -NoNewWindow -Wait -PassThru
        $exitCode = $proc.ExitCode
    } finally {
        if (Test-Path $stdOut) {
            Get-Content $stdOut -ErrorAction SilentlyContinue | ForEach-Object { Log "  $_" }
            Remove-Item $stdOut -ErrorAction SilentlyContinue
        }
        if (Test-Path $stdErr) {
            Get-Content $stdErr -ErrorAction SilentlyContinue | ForEach-Object { Log "  [stderr] $_" }
            Remove-Item $stdErr -ErrorAction SilentlyContinue
        }
    }

    if ($exitCode -ne 0) {
        Log "$Label FAILED (exit code $exitCode)" "ERROR"
        return $false
    }
    Log "$Label succeeded." "OK"
    return $true
}

# -- Find npm and git (prefer .cmd wrappers on Windows) ----------------------
$_npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $_npm) { $_npm = Get-Command npm -ErrorAction SilentlyContinue }
$NpmCmd = if ($_npm) { $_npm.Source } else { $null }

$_git = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $_git) { $_git = Get-Command git -ErrorAction SilentlyContinue }
$GitCmd = if ($_git) { $_git.Source } else { $null }

if (-not $NpmCmd) {
    Log "npm not found on PATH. Aborting." "ERROR"
    exit 1
}

# -- Main ---------------------------------------------------------------------
Log "================================================"
Log "  Faculty Atlas - Daily Update"
Log "  $(Get-Date -Format 'dddd, MMMM dd yyyy HH:mm:ss')"
Log "  Project: $ProjectRoot"
if ($DryRun) { Log "  *** DRY RUN - no commit or push ***" "WARN" }
Log "================================================"

$OverallSuccess = $true

# 1. Scrape
LogSection "Step 1/5 - Scrape jobs"
$scraped = Invoke-Step "Scrape" $NpmCmd @("run", "scrape:json")
if (-not $scraped) {
    Log "Scrape failed - aborting to preserve existing data." "ERROR"
    $OverallSuccess = $false
    # Don't exit - still run monitor so we know the site is still up.
}

# 2-5. Agent pipeline (local Ollama) then build — only if scrape succeeded.
# These run BEFORE build:frontend so the rebuilt data chunks include firstSeen,
# enrichment, and posting dates. Each is best-effort (| Out-Null, no gating):
# preserveEnrichment already carries prior enrichment/firstSeen/datePosted, so a
# skipped or partial agent step degrades gracefully instead of losing data.
if ($scraped) {
    LogSection "Step 2/8 - Track job presence (stamp firstSeen, purge expired)"
    Invoke-Step "Job presence" $NpmCmd @("run", "agent:job-presence") | Out-Null

    LogSection "Step 3/8 - Enrich new jobs (discipline/positionType/tenureTrack via local Ollama)"
    Invoke-Step "Enrich" $NpmCmd @("run", "agent:enrich", "--", "--max", "1500", "--batch-size", "6") | Out-Null

    LogSection "Step 4/8 - Backfill descriptions + posting dates (datePosted)"
    # Higher --max to work through the ~5.5k unfetched-page backlog faster (clears
    # in ~3 nights). Each fetch also extracts JSON-LD/Open Date posting dates.
    Invoke-Step "Descriptions" $NpmCmd @("run", "agent:descriptions", "--", "--max", "2000", "--concurrency", "8") | Out-Null

    LogSection "Step 5/8 - Build frontend"
    $built = Invoke-Step "Build" $NpmCmd @("run", "build:frontend")
    if (-not $built) {
        Log "Build failed - skipping commit." "ERROR"
        $OverallSuccess = $false
    } else {
        # 6. Commit and push
        LogSection "Step 6/8 - Commit and push"
        if ($DryRun) {
            Log "DRY RUN: skipping git commit and push." "WARN"
        } else {
            if (-not $GitCmd) {
                Log "git not found on PATH - skipping commit." "ERROR"
                $OverallSuccess = $false
            } else {
                # Stage everything the build pipeline touches. NOTE: this must
                # cover ALL files the scrape modifies — generated/ reports and
                # web-vue/public/ data included — otherwise the commit leaves the
                # working tree dirty, and the merge -X ours recovery below aborts
                # with "commit your changes or stash them before you merge",
                # silently stranding the push (this caused 6 days of stale data).
                Invoke-Step "git add" $GitCmd @(
                    "add", "-A",
                    "docs/", "public/", "generated/", "web-vue/public/",
                    "data/institutions-master.json"
                ) | Out-Null

                # Only commit if there are actual changes
                $statusOutput = & $GitCmd -C $ProjectRoot status --porcelain 2>&1
                if ($statusOutput) {
                    $dateLabel = Get-Date -Format "yyyy-MM-dd"
                    $msgFile = [System.IO.Path]::GetTempFileName()
                    Set-Content -Path $msgFile -Value "Daily scrape update $dateLabel`n`nAutomated via daily-update.ps1`n`nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" -NoNewline
                    $committed = Invoke-Step "git commit" $GitCmd @("commit", "-F", $msgFile)
                    Remove-Item $msgFile -ErrorAction SilentlyContinue
                    if ($committed) {
                        $pushed = Invoke-Step "git push" $GitCmd @("push")
                        if (-not $pushed) {
                            # Remote moved (CI's agent-team pass commits between our
                            # commit and push), so the push is non-fast-forward.
                            # Reconcile by rebasing onto latest, then retry.
                            #
                            # IMPORTANT: use `pull --rebase --autostash`, NOT `merge`.
                            # core.autocrlf=true + `* text=auto` make the Node-written
                            # generated/*.json files read as locally-modified right
                            # after commit, so a bare `merge` aborts with "local changes
                            # would be overwritten ... commit or stash before merge" and
                            # strands the push (this caused ~6 days of stale firstSeen /
                            # presence data). --autostash stashes that churn before the
                            # rebase and restores it after. -X theirs keeps OUR fresh
                            # scrape data: during a rebase our replayed commits are
                            # "theirs". Mirrors .github/workflows/agent-team.yml.
                            Log "Push rejected - rebasing onto latest origin/main (autostash)..." "WARN"
                            for ($attempt = 1; $attempt -le 5; $attempt++) {
                                $rebased = Invoke-Step "git pull --rebase -X theirs --autostash (attempt $attempt)" `
                                    $GitCmd @("pull", "--rebase", "-X", "theirs", "--autostash", "origin", "main")
                                if (-not $rebased) {
                                    # Leave no half-applied rebase behind for the next run.
                                    Invoke-Step "git rebase --abort" $GitCmd @("rebase", "--abort") | Out-Null
                                }
                                $pushed = Invoke-Step "git push (retry $attempt)" $GitCmd @("push")
                                if ($pushed) { break }
                            }
                            if (-not $pushed) {
                                Log "Push failed after 5 rebase/push attempts." "ERROR"
                                $OverallSuccess = $false
                            }
                        }
                    } else {
                        Log "Commit failed." "ERROR"
                        $OverallSuccess = $false
                    }
                } else {
                    Log "No changes to commit - data unchanged since last run." "OK"
                }
            }
        }
    }
}

# 7. Validate job posting URLs
LogSection "Step 7/8 - Validate job URLs"
Invoke-Step "Verify job URLs" $NpmCmd @("run", "verify:job-urls") | Out-Null

# 8. Monitor live site
LogSection "Step 8/8 - Monitor live site"
if (-not $DryRun -and $scraped) {
    Log "Waiting 30s for GitHub Pages to propagate..."
    Start-Sleep -Seconds 30
}
Invoke-Step "Monitor" $NpmCmd @("run", "monitor:live") | Out-Null

# -- Summary ------------------------------------------------------------------
Log ""
Log "================================================"
if ($OverallSuccess) {
    Log "  [SUCCESS] Daily update completed."
} else {
    Log "  [FAILED]  Daily update finished with errors - check log."
}
Log "  Log: $LogFile"
Log "================================================"
Log ""

# Keep only the 30 most recent log files
Get-ChildItem $LogDir -Filter "daily-update-*.log" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 30 |
    Remove-Item -Force

exit $(if ($OverallSuccess) { 0 } else { 1 })
