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
    Add-Content -Path $LogFile -Value $line
}

function LogSection {
    param([string]$Title)
    $sep = "-" * 50
    Log ""
    Log $sep
    Log "  $Title"
    Log $sep
}

# -- Run a command, stream output, and return exit code ----------------------
function Invoke-Step {
    param(
        [string]$Label,
        [string]$Command,
        [string[]]$Arguments
    )
    Log "Running: $Command $($Arguments -join ' ')"

    $stdoutTmp = "$LogFile.stdout.tmp"
    $stderrTmp = "$LogFile.stderr.tmp"

    Push-Location $ProjectRoot
    try {
        $output = & $Command @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    foreach ($line in $output) { Log "  $line" }

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
LogSection "Step 1/4 - Scrape jobs"
$scraped = Invoke-Step "Scrape" $NpmCmd @("run", "scrape:json")
if (-not $scraped) {
    Log "Scrape failed - aborting to preserve existing data." "ERROR"
    $OverallSuccess = $false
    # Don't exit - still run monitor so we know the site is still up.
}

# 2. Build frontend (only if scrape succeeded)
if ($scraped) {
    LogSection "Step 2/4 - Build frontend"
    $built = Invoke-Step "Build" $NpmCmd @("run", "build:frontend")
    if (-not $built) {
        Log "Build failed - skipping commit." "ERROR"
        $OverallSuccess = $false
    } else {
        # 3. Commit and push
        LogSection "Step 3/4 - Commit and push"
        if ($DryRun) {
            Log "DRY RUN: skipping git commit and push." "WARN"
        } else {
            if (-not $GitCmd) {
                Log "git not found on PATH - skipping commit." "ERROR"
                $OverallSuccess = $false
            } else {
                # Stage everything the build pipeline touches
                Invoke-Step "git add" $GitCmd @(
                    "add",
                    "docs/", "public/",
                    "data/institutions-master.json",
                    "generated/coverage-report.json",
                    "generated/policy-excluded-colleges.json",
                    "web-vue/public/policy-excluded-colleges.json"
                ) | Out-Null

                # Only commit if there are actual changes
                $statusOutput = & $GitCmd -C $ProjectRoot status --porcelain 2>&1
                if ($statusOutput) {
                    $dateLabel = Get-Date -Format "yyyy-MM-dd"
                    $commitMsg = "Daily scrape update $dateLabel

Automated via daily-update.ps1

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
                    $committed = Invoke-Step "git commit" $GitCmd @("commit", "-m", $commitMsg)
                    if ($committed) {
                        $pushed = Invoke-Step "git push" $GitCmd @("push")
                        if (-not $pushed) {
                            Log "Push failed." "ERROR"
                            $OverallSuccess = $false
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

# 4. Monitor live site
LogSection "Step 4/4 - Monitor live site"
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
