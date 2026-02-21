[CmdletBinding()]
param(
  [string]$MacSummarizerUrl = "http://192.168.1.118:8000/summarize",
  [string]$PcSummarizerUrl = "http://192.168.1.137:9000/summarize",
  [string]$CampusAllowlist = "NY,IL,MN,MI,TX,FL,GA,AL,MS,LA,AR,KS,OK,MO,KY,TN"
)

$ErrorActionPreference = "Stop"

function Test-Endpoint {
  param([Parameter(Mandatory = $true)][string]$Url)

  try {
    $uri = [Uri]$Url
    $result = Test-NetConnection -ComputerName $uri.Host -Port $uri.Port -WarningAction SilentlyContinue
    return [bool]$result.TcpTestSucceeded
  } catch {
    return $false
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

Write-Host "Repo: $repoRoot"
Write-Host "Mac summarizer: $MacSummarizerUrl"
Write-Host "PC summarizer:  $PcSummarizerUrl"

$macOk = Test-Endpoint -Url $MacSummarizerUrl
$pcOk = Test-Endpoint -Url $PcSummarizerUrl

if (-not $macOk) {
  Write-Error "Mac summarizer is unreachable: $MacSummarizerUrl"
}
if (-not $pcOk) {
  Write-Error "PC summarizer is unreachable: $PcSummarizerUrl"
}

Write-Host "Both summarizer endpoints reachable. Starting shared scrape..."

$env:CAMPUS_ALLOWLIST = $CampusAllowlist
$env:LOCAL_LLM_URLS = "$MacSummarizerUrl,$PcSummarizerUrl"

npm run scrape:json
