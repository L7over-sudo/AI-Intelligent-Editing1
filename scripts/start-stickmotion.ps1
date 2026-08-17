param(
  [switch]$NoBrowser,
  [ValidateRange(30, 1800)]
  [int]$WaitTimeoutSeconds = 1200
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workDirectory = Join-Path $workspaceRoot "work\dev-logs"
$stdoutLog = Join-Path $workDirectory "dev.out.log"
$stderrLog = Join-Path $workDirectory "dev.err.log"
$pidFile = Join-Path $workDirectory "dev.pid"
$webStdoutLog = Join-Path $workDirectory "web.out.log"
$webStderrLog = Join-Path $workDirectory "web.err.log"
$webPidFile = Join-Path $workDirectory "web.pid"
$webUrl = "http://localhost:3000/projects/new"
$healthUrl = "http://127.0.0.1:3000/api/health"

function Test-WebReady {
  try {
    $response = Invoke-WebRequest `
      -Uri $healthUrl `
      -UseBasicParsing `
      -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Open-StickMotion {
  if ($NoBrowser) {
    Write-Host "StickMotion is ready: $webUrl"
    return
  }
  Start-Process $webUrl
}

function Resolve-PnpmInvocation {
  $pnpm = Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue
  if (-not $pnpm) {
    $pnpm = Get-Command "pnpm" -ErrorAction SilentlyContinue
  }
  if ($pnpm) {
    return @{
      FilePath = $pnpm.Source
      PrefixArgument = ""
    }
  }

  $corepack = Get-Command "corepack.cmd" -ErrorAction SilentlyContinue
  if (-not $corepack) {
    $corepack = Get-Command "corepack" -ErrorAction SilentlyContinue
  }
  if ($corepack) {
    return @{
      FilePath = $corepack.Source
      PrefixArgument = "pnpm"
    }
  }

  $pnpmCandidates = @(
    (Join-Path $env:ProgramFiles "nodejs\pnpm.cmd"),
    (Join-Path $env:LOCALAPPDATA "pnpm\pnpm.cmd"),
    (Join-Path $env:APPDATA "npm\pnpm.cmd"),
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd")
  )
  foreach ($candidate in $pnpmCandidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return @{
        FilePath = $candidate
        PrefixArgument = ""
      }
    }
  }

  throw "PNPM_NOT_FOUND: Node.js Corepack or pnpm is required."
}

function Get-SavedProcess {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }

  $savedPid = (Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($savedPid -notmatch "^\d+$") {
    return $null
  }

  return Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
}

function Start-StandaloneWeb {
  param([Parameter(Mandatory = $true)][hashtable]$PnpmInvocation)

  $arguments = @()
  if ($PnpmInvocation.PrefixArgument) {
    $arguments += $PnpmInvocation.PrefixArgument
  }
  $arguments += @("--filter", "@stickmotion/web", "dev")

  $webProcess = Start-Process `
    -FilePath $PnpmInvocation.FilePath `
    -ArgumentList $arguments `
    -WorkingDirectory $workspaceRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $webStdoutLog `
    -RedirectStandardError $webStderrLog `
    -PassThru
  Set-Content -LiteralPath $webPidFile -Value $webProcess.Id -Encoding ascii
  return $webProcess
}

try {
  & (Join-Path $PSScriptRoot "start-search-bridge.ps1")

  $indexTtsRoot = if ($env:INDEXTTS_HOME) {
    $env:INDEXTTS_HOME
  } else {
    "D:\iwen-codex\IndexTTS2"
  }
  $indexTtsLauncher = Join-Path $indexTtsRoot "start-service.ps1"
  if (Test-Path -LiteralPath $indexTtsLauncher -PathType Leaf) {
    Write-Host "Starting IndexTTS2 local voice service..."
    & $indexTtsLauncher
  } else {
    Write-Host "IndexTTS2 launcher not found at $indexTtsLauncher; voice generation will be unavailable." -ForegroundColor Yellow
  }

  if (Test-WebReady) {
    Write-Host "StickMotion is already running."
    Open-StickMotion
    exit 0
  }

  $pnpmInvocation = Resolve-PnpmInvocation

  New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

  $existingProcess = Get-SavedProcess -Path $pidFile
  $healthProcess = $existingProcess

  if (-not $existingProcess) {
    Write-Host "Starting search, IndexTTS2, web, and worker..."
    $runtimeBin = Join-Path $workDirectory "runtime-bin"
    $pnpmShim = Join-Path $runtimeBin "pnpm.cmd"
    New-Item -ItemType Directory -Path $runtimeBin -Force | Out-Null
    $env:STICKMOTION_PNPM_FILE = $pnpmInvocation.FilePath
    $env:STICKMOTION_PNPM_PREFIX = $pnpmInvocation.PrefixArgument
    Set-Content `
      -LiteralPath $pnpmShim `
      -Encoding ascii `
      -Value @(
        "@echo off",
        '"%STICKMOTION_PNPM_FILE%" %STICKMOTION_PNPM_PREFIX% %*'
      )
    $env:PATH = "$runtimeBin;$PSHOME;$env:PATH"
    $process = Start-Process `
      -FilePath $pnpmShim `
      -ArgumentList @("dev") `
      -WorkingDirectory $workspaceRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog `
      -PassThru
    Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii
    $existingProcess = $process
    $healthProcess = $process
  } else {
    $webProcess = Get-SavedProcess -Path $webPidFile
    if (-not $webProcess) {
      Write-Host "The worker is running but web is unavailable. Restarting web..."
      $webProcess = Start-StandaloneWeb -PnpmInvocation $pnpmInvocation
    } else {
      Write-Host "A web restart process was found. Waiting for web..."
    }
    $healthProcess = $webProcess
  }

  $deadline = [DateTime]::UtcNow.AddSeconds($WaitTimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-WebReady) {
      Write-Host "StickMotion started successfully."
      Open-StickMotion
      exit 0
    }

    if ($healthProcess.HasExited) {
      $activeErrorLog = if ($healthProcess.Id -eq $existingProcess.Id) {
        $stderrLog
      } else {
        $webStderrLog
      }
      $errorTail = if (Test-Path -LiteralPath $activeErrorLog) {
        Get-Content -LiteralPath $activeErrorLog -Tail 30 -ErrorAction SilentlyContinue
      } else {
        @()
      }
      throw "START_FAILED: $($errorTail -join ' ')"
    }
    Start-Sleep -Seconds 2
  }

  throw "START_TIMEOUT: inspect $stderrLog"
} catch {
  Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
  if (-not $NoBrowser) {
    Read-Host "Press Enter to close"
  }
  exit 1
}
