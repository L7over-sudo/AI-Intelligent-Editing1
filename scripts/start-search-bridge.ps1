param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8790,
  [ValidateRange(5, 120)]
  [int]$WaitTimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$healthUrl = "http://127.0.0.1:${Port}/api/status"
$workDirectory = Join-Path $workspaceRoot "work\dev-logs"
$stdoutLog = Join-Path $workDirectory "search-bridge.out.log"
$stderrLog = Join-Path $workDirectory "search-bridge.err.log"
$pidFile = Join-Path $workDirectory "search-bridge.pid"

function Test-SearchBridgeReady {
  try {
    $status = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
    return $status.ok -eq $true -and $status.bridgeConfigured -eq $true
  } catch {
    return $false
  }
}

function Resolve-SearchBridgeRoot {
  $candidates = @()
  if ($env:STICKMOTION_SEARCH_BRIDGE_HOME) {
    $candidates += $env:STICKMOTION_SEARCH_BRIDGE_HOME
  }
  $candidates += (Join-Path (Split-Path $workspaceRoot -Parent) "AI Agent")

  foreach ($candidate in $candidates) {
    $serverScript = Join-Path $candidate "server.js"
    if (Test-Path -LiteralPath $serverScript -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "SEARCH_BRIDGE_NOT_INSTALLED: expected AI Agent\server.js next to this workspace."
}

function Resolve-NodePath {
  $node = Get-Command "node.exe" -ErrorAction SilentlyContinue
  if (-not $node) {
    $node = Get-Command "node" -ErrorAction SilentlyContinue
  }
  if ($node) {
    return $node.Source
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return $candidate
    }
  }

  throw "NODE_NOT_FOUND: Node.js is required by the local search service."
}

if (Test-SearchBridgeReady) {
  Write-Host "Search service is ready at $healthUrl"
  exit 0
}

$serviceRoot = Resolve-SearchBridgeRoot
$nodePath = Resolve-NodePath
$serverScript = Join-Path $serviceRoot "server.js"
New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

$existingProcess = $null
if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
  $savedPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue
  if ($savedPid -match "^\d+$") {
    $existingProcess = Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
  }
}

if (-not $existingProcess) {
  Write-Host "Starting the local search service automatically..."
  $previousPort = $env:PORT
  try {
    $env:PORT = [string]$Port
    $process = Start-Process `
      -FilePath $nodePath `
      -ArgumentList @("server.js") `
      -WorkingDirectory $serviceRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog `
      -PassThru
  } finally {
    [Environment]::SetEnvironmentVariable("PORT", $previousPort, "Process")
  }
  Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii
  $existingProcess = $process
}

$deadline = [DateTime]::UtcNow.AddSeconds($WaitTimeoutSeconds)
while ([DateTime]::UtcNow -lt $deadline) {
  if (Test-SearchBridgeReady) {
    Write-Host "Search service started successfully."
    exit 0
  }

  if ($existingProcess.HasExited) {
    $errorTail = if (Test-Path -LiteralPath $stderrLog -PathType Leaf) {
      Get-Content -LiteralPath $stderrLog -Tail 20 -ErrorAction SilentlyContinue
    } else {
      @()
    }
    throw "SEARCH_BRIDGE_START_FAILED: $($errorTail -join ' ')"
  }
  Start-Sleep -Seconds 1
}

throw "SEARCH_BRIDGE_START_TIMEOUT: see $stderrLog"
