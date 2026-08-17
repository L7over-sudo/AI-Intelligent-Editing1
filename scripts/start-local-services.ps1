$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "start-search-bridge.ps1")

$indexTtsRoot = if ($env:INDEXTTS_HOME) {
  $env:INDEXTTS_HOME
} else {
  "D:\iwen-codex\IndexTTS2"
}
$indexTtsLauncher = Join-Path $indexTtsRoot "start-service.ps1"
if (Test-Path -LiteralPath $indexTtsLauncher -PathType Leaf) {
  & $indexTtsLauncher
} else {
  Write-Host "IndexTTS2 launcher not found at $indexTtsLauncher; voice generation will be unavailable." -ForegroundColor Yellow
}
