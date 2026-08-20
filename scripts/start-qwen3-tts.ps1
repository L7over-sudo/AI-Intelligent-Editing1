param(
  [int]$Port = 7852,
  [string]$PythonPath = "",
  [string]$BaseModel = "",
  [string]$CustomModel = "",
  [switch]$StopIndexTTS2
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workDirectory = Join-Path $workspaceRoot "work\qwen3-tts"
$stdoutLog = Join-Path $workDirectory "qwen3-tts.out.log"
$stderrLog = Join-Path $workDirectory "qwen3-tts.err.log"
$pidFile = Join-Path $workDirectory "qwen3-tts.pid"
$healthUrl = "http://127.0.0.1:$Port/api/health"
$qwenRoot = "E:\codex\agent\Qwen3-TTS"
$indexRoot = "D:\iwen-codex\IndexTTS2\.venv"
$qwenSite = Join-Path $qwenRoot ".venv\Lib\site-packages"

if (-not $PythonPath) {
  $PythonPath = Join-Path $qwenRoot ".venv\Scripts\python.exe"
}
if (-not $BaseModel) {
  $BaseModel = Join-Path $qwenRoot "models\Qwen3-TTS-12Hz-1.7B-Base"
}
if (-not $CustomModel) {
  $CustomModel = Join-Path $qwenRoot "models\Qwen3-TTS-12Hz-1.7B-CustomVoice"
}
if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
  throw "QWEN3_TTS_PYTHON_NOT_FOUND: $PythonPath"
}
if (-not (Test-Path -LiteralPath $BaseModel -PathType Container) -or
    -not (Test-Path -LiteralPath (Join-Path $BaseModel "model.safetensors") -PathType Leaf)) {
  throw "QWEN3_TTS_BASE_MODEL_NOT_FOUND: $BaseModel"
}
if (-not (Test-Path -LiteralPath $CustomModel -PathType Container) -or
    -not (Test-Path -LiteralPath (Join-Path $CustomModel "model.safetensors") -PathType Leaf)) {
  throw "QWEN3_TTS_CUSTOM_MODEL_NOT_FOUND: $CustomModel"
}

function Test-ServiceReady {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
    return $response.ready -eq $true
  } catch {
    return $false
  }
}

function Stop-ValidatedProcess {
  param([Parameter(Mandatory = $true)][int]$ProcessId)
  $info = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
  if (-not $info) { return }
  Stop-Process -Id $ProcessId -Force
}

if ($StopIndexTTS2) {
  $legacyListener = Get-NetTCPConnection -LocalPort 7851 -State Listen -ErrorAction SilentlyContinue
  if ($legacyListener) {
    $legacyPid = [int]$legacyListener.OwningProcess
    $legacyInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$legacyPid"
    if (
      $legacyInfo -and
      $legacyInfo.CommandLine -like '*-m uvicorn service:app*--port 7851*' -and
      $legacyInfo.CommandLine -like '*IndexTTS2*'
    ) {
      Write-Host "Stopping legacy IndexTTS2 listener PID $legacyPid..."
      Stop-ValidatedProcess -ProcessId $legacyPid
      Start-Sleep -Milliseconds 500
    }
  }
}

if (Test-ServiceReady) {
  Write-Host "Qwen3-TTS service is already ready on port $Port."
  exit 0
}

New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null
$env:QWEN3_TTS_PORT = "$Port"
$env:QWEN3_TTS_BASE_MODEL = $BaseModel
$env:QWEN3_TTS_CUSTOM_MODEL = $CustomModel
$torchSite = if (Test-Path -LiteralPath (Join-Path $indexRoot "Lib\site-packages\torch") -PathType Container) {
  Join-Path $indexRoot "Lib\site-packages"
} else {
  $qwenSite
}
$env:QWEN3_TTS_TORCH_SITE = $torchSite
$torchLib = Join-Path $torchSite "torch\lib"
if (Test-Path -LiteralPath $torchLib -PathType Container) {
  $env:PATH = "$torchLib;$env:PATH"
}

$existingPid = if (Test-Path -LiteralPath $pidFile) {
  Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
} else { "" }
if ($existingPid -match "^\d+$") {
  $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$existingPid)"
  if ($existing -and $existing.CommandLine -like '*qwen3-tts-service.py*') {
    Stop-ValidatedProcess -ProcessId ([int]$existingPid)
    Start-Sleep -Milliseconds 500
  }
}

$process = Start-Process `
  -FilePath $PythonPath `
  -ArgumentList @((Join-Path $workspaceRoot "scripts\qwen3-tts-service.py")) `
  -WorkingDirectory $workspaceRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii

$deadline = [DateTime]::UtcNow.AddSeconds(600)
while ([DateTime]::UtcNow -lt $deadline) {
  if (Test-ServiceReady) {
    Write-Host "Qwen3-TTS service started: $healthUrl"
    exit 0
  }
  if ($process.HasExited) {
    $errorTail = if (Test-Path -LiteralPath $stderrLog) {
      Get-Content -LiteralPath $stderrLog -Tail 40 -ErrorAction SilentlyContinue
    } else { @() }
    throw "QWEN3_TTS_SERVICE_EXITED: $($errorTail -join ' ')"
  }
  Start-Sleep -Seconds 3
}
throw "QWEN3_TTS_SERVICE_START_TIMEOUT: inspect $stderrLog"
