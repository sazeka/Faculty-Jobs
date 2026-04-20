# setup-task-scheduler.ps1
# Registers the Faculty Atlas daily update as a Windows Task Scheduler task.
# Run this script ONCE from an elevated (Administrator) PowerShell prompt.
#
# Usage:
#   Right-click PowerShell → "Run as Administrator", then:
#   cd "C:\Users\StevenAzeka\OneDrive\Documents\GitHub\Faculty-Jobs"
#   .\scripts\setup-task-scheduler.ps1

$TaskName    = "FacultyAtlas-DailyUpdate"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Script      = Join-Path $ProjectRoot "daily-update.ps1"
$RunAt       = "02:00"   # 2:00 AM

Write-Host ""
Write-Host "Faculty Atlas — Task Scheduler Setup"
Write-Host "  Task name : $TaskName"
Write-Host "  Script    : $Script"
Write-Host "  Runs at   : $RunAt daily"
Write-Host ""

# Remove any existing task with this name
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing task '$TaskName'..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Build the action — run PowerShell with our script
$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$Script`"" `
    -WorkingDirectory $ProjectRoot

# Trigger: daily at 2 AM
$Trigger = New-ScheduledTaskTrigger -Daily -At $RunAt

# Settings: run on battery, don't stop if it takes a while, wake to run
$Settings = New-ScheduledTaskSettingsSet `
    -DisallowStartIfOnBatteries:$false `
    -StopIfGoingOnBatteries:$false `
    -ExecutionTimeLimit (New-TimeSpan -Hours 5) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

# Run as the current user (so git credentials and npm are available)
$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Scrapes faculty jobs, rebuilds Faculty Atlas, commits and pushes to GitHub, then verifies the live site." `
    -Force

Write-Host ""
Write-Host "✅ Task '$TaskName' registered."
Write-Host "   It will run daily at $RunAt."
Write-Host ""
Write-Host "Useful commands:"
Write-Host "  Test now  : Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  View logs : Get-Content `"$ProjectRoot\generated\automation-logs\*.log`" | Select -Last 50"
Write-Host "  Remove    : Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
Write-Host ""
