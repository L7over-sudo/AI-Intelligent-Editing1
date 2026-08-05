param(
  [string]$HostAddress = "127.0.0.1",
  [int]$Port = 9880
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$installRoot = if ($env:VOXCPM_HOME) { $env:VOXCPM_HOME } else { "D:\AI-Tools\VoxCPM" }
$pythonPath = if ($env:VOXCPM_PYTHON) {
  $env:VOXCPM_PYTHON
} else {
  Join-Path $installRoot "venv\Scripts\python.exe"
}
$serviceScript = Join-Path $PSScriptRoot "voxcpm-service.py"

if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
  throw "VOXCPM_NOT_INSTALLED: $pythonPath"
}

$healthUrl = "http://${HostAddress}:${Port}/health"
try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
  if ($health.ok) {
    Write-Host "VoxCPM2 service is ready at $healthUrl"
    exit 0
  }
} catch {
  # Start the local service below.
}

$serviceLogDirectory = Join-Path $installRoot "logs"
New-Item -ItemType Directory -Path $serviceLogDirectory -Force | Out-Null
$stdoutLog = Join-Path $serviceLogDirectory "service.out.log"
$stderrLog = Join-Path $serviceLogDirectory "service.err.log"

$serviceEnvironment = @{
  VOXCPM_HOME = $installRoot
  VOXCPM_HOST = $HostAddress
  VOXCPM_PORT = [string]$Port
  VOXCPM_ALLOWED_ROOT = (Join-Path $workspaceRoot "storage\media")
  VOXCPM_CACHE_DIR = if ($env:VOXCPM_CACHE_DIR) {
    $env:VOXCPM_CACHE_DIR
  } else {
    Join-Path $installRoot "models"
  }
  VOXCPM_MODEL_ID = if ($env:VOXCPM_MODEL_ID) {
    $env:VOXCPM_MODEL_ID
  } else {
    "openbmb/VoxCPM2"
  }
  VOXCPM_DEVICE = if ($env:VOXCPM_DEVICE) { $env:VOXCPM_DEVICE } else { "cuda" }
  PYTHONIOENCODING = "utf-8"
  PYTHONUTF8 = "1"
}
foreach ($entry in $serviceEnvironment.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
}

Start-Process `
  -FilePath $pythonPath `
  -ArgumentList @($serviceScript) `
  -WorkingDirectory $workspaceRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog

$deadline = [DateTime]::UtcNow.AddMinutes(20)
while ([DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Seconds 3
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
    if ($health.ok) {
      Write-Host "VoxCPM2 service is ready at $healthUrl"
      exit 0
    }
  } catch {
    # Model download and loading can take several minutes on first start.
  }
  if (Test-Path -LiteralPath $stderrLog) {
    $tail = Get-Content -LiteralPath $stderrLog -Tail 10 -ErrorAction SilentlyContinue
    if ($tail -match "Traceback|Application startup failed|CUDA_NOT_AVAILABLE") {
      throw "VOXCPM_START_FAILED: $($tail -join ' ')"
    }
  }
}

throw "VOXCPM_START_TIMEOUT: see $stderrLog"
