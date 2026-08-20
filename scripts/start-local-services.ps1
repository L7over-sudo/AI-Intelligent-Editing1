$ErrorActionPreference = "Stop"

if (
  (Test-Path -LiteralPath "E:\codex\agent\Qwen3-TTS\.venv\Scripts\python.exe" -PathType Leaf) -and
  (Test-Path -LiteralPath "E:\codex\agent\Qwen3-TTS\models\Qwen3-TTS-12Hz-1.7B-CustomVoice\model.safetensors" -PathType Leaf)
) {
  & (Join-Path $PSScriptRoot "start-qwen3-tts.ps1") -Port 7852 -StopIndexTTS2
}

& (Join-Path $PSScriptRoot "start-search-bridge.ps1")
