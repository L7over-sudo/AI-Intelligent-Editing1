"""Local Qwen3-TTS service used by the StickMotion voice Worker.

The 1.7B CustomVoice and Base models are loaded one at a time because the
target machine has an 8GB GPU. A request for a different provider replaces the
currently loaded model before synthesis.
"""

from __future__ import annotations

import gc
import io
import os
import sys
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any


def add_cuda_runtime() -> None:
    torch_root_value = os.environ.get("QWEN3_TTS_TORCH_SITE", "").strip()
    if not torch_root_value:
        return
    torch_root = Path(torch_root_value)
    if str(torch_root) not in sys.path and torch_root.exists():
        sys.path.append(str(torch_root))
    if sys.platform == "win32":
        torch_dll = torch_root / "torch" / "lib"
        if torch_dll.exists():
            os.add_dll_directory(str(torch_dll))


add_cuda_runtime()

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402
from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from qwen_tts import Qwen3TTSModel  # noqa: E402


SERVICE_PORT = int(os.environ.get("QWEN3_TTS_PORT", "7852"))
BASE_MODEL = Path(
    os.environ.get(
        "QWEN3_TTS_BASE_MODEL",
        r"E:\codex\agent\Qwen3-TTS\models\Qwen3-TTS-12Hz-1.7B-Base",
    )
)
CUSTOM_MODEL = Path(
    os.environ.get(
        "QWEN3_TTS_CUSTOM_MODEL",
        r"E:\codex\agent\Qwen3-TTS\models\Qwen3-TTS-12Hz-1.7B-CustomVoice",
    )
)
MAX_NEW_TOKENS = int(os.environ.get("QWEN3_TTS_MAX_NEW_TOKENS", "8192"))
CUSTOM_PROVIDER = "qwen3-tts-custom"
CLONE_PROVIDERS = {"qwen3-tts-clone", "local-clone"}

_model: Qwen3TTSModel | None = None
_model_provider: str | None = None
_model_lock = threading.RLock()


def _device_options() -> tuple[str, torch.dtype, str | None]:
    if torch.cuda.is_available():
        return "cuda:0", torch.float16, "sdpa"
    return "cpu", torch.float32, None


def _unload_model() -> None:
    global _model, _model_provider
    _model = None
    _model_provider = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def _model_for_provider(provider: str) -> Qwen3TTSModel:
    global _model, _model_provider
    if provider not in CLONE_PROVIDERS and provider != CUSTOM_PROVIDER:
        raise ValueError("VOICE_PROVIDER_UNSUPPORTED")
    with _model_lock:
        if _model is not None and _model_provider == provider:
            return _model
        _unload_model()
        model_path = CUSTOM_MODEL if provider == CUSTOM_PROVIDER else BASE_MODEL
        if not model_path.is_dir():
            raise FileNotFoundError(f"QWEN3_TTS_MODEL_NOT_FOUND:{model_path}")
        device, dtype, attention = _device_options()
        options: dict[str, Any] = {
            "device_map": device,
            "dtype": dtype,
            "local_files_only": True,
        }
        if attention:
            options["attn_implementation"] = attention
        _model = Qwen3TTSModel.from_pretrained(str(model_path), **options)
        _model_provider = provider
        print(
            f"[qwen3-tts] loaded provider={provider} device={device} "
            f"model={model_path}",
            flush=True,
        )
        return _model


def _speaker_for_model(model: Qwen3TTSModel, speaker: str) -> str:
    requested = speaker.strip().lower()
    for supported in model.get_supported_speakers():
        if supported.lower() == requested:
            return supported
    raise ValueError("QWEN3_TTS_SPEAKER_UNSUPPORTED")


def _read_reference(raw: bytes) -> tuple[np.ndarray, int]:
    try:
        audio, sample_rate = sf.read(io.BytesIO(raw), dtype="float32", always_2d=False)
    except Exception as error:  # pragma: no cover - exercised by the running service
        raise ValueError("VOICE_REFERENCE_INVALID") from error
    if audio.size == 0 or sample_rate <= 0:
        raise ValueError("VOICE_REFERENCE_INVALID")
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1, dtype=np.float32)
    return np.asarray(audio, dtype=np.float32), int(sample_rate)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # CustomVoice is the page's default so the built-in list is ready after
    # startup. The Base clone model is swapped in lazily on the first clone.
    try:
        _model_for_provider(CUSTOM_PROVIDER)
    except Exception as error:
        print(f"[qwen3-tts] startup load failed: {error}", flush=True)
        raise
    yield
    with _model_lock:
        _unload_model()


app = FastAPI(title="StickMotion Qwen3-TTS", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "model": "Qwen3-TTS-12Hz-1.7B",
        "loaded": _model is not None,
        "ready": _model is not None,
        "provider": _model_provider,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
    }


@app.post("/api/synthesize")
async def synthesize(
    provider: str = Form(...),
    text: str = Form(...),
    file: UploadFile = File(...),
    speaker: str | None = Form(None),
    emo_text: str | None = Form(None),
) -> StreamingResponse:
    clean_text = text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="VOICE_TEXT_REQUIRED")
    if len(clean_text) > 20_000:
        raise HTTPException(status_code=400, detail="VOICE_TEXT_TOO_LONG")
    raw_reference = await file.read()
    if not raw_reference:
        raise HTTPException(status_code=400, detail="VOICE_REFERENCE_REQUIRED")

    try:
        with _model_lock:
            model = _model_for_provider(provider.strip())
            if provider.strip() == CUSTOM_PROVIDER:
                if not speaker:
                    raise ValueError("QWEN3_TTS_SPEAKER_REQUIRED")
                normalized_speaker = _speaker_for_model(model, speaker)
                wavs, sample_rate = model.generate_custom_voice(
                    text=clean_text,
                    language="Chinese",
                    speaker=normalized_speaker,
                    instruct=emo_text.strip() if emo_text else None,
                    max_new_tokens=MAX_NEW_TOKENS,
                )
            else:
                reference = _read_reference(raw_reference)
                wavs, sample_rate = model.generate_voice_clone(
                    text=clean_text,
                    language="Chinese",
                    ref_audio=reference,
                    x_vector_only_mode=True,
                    max_new_tokens=MAX_NEW_TOKENS,
                )
        if not wavs:
            raise ValueError("VOICE_AUDIO_INVALID")
        output = io.BytesIO()
        sf.write(output, np.asarray(wavs[0]), sample_rate, format="WAV", subtype="PCM_16")
        output.seek(0)
        return StreamingResponse(output, media_type="audio/wav")
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:  # pragma: no cover - exercised by the running service
        print(f"[qwen3-tts] synthesis failed: {type(error).__name__}: {error}", flush=True)
        raise HTTPException(status_code=503, detail="VOICE_SYNTHESIS_FAILED") from error


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=SERVICE_PORT, log_level="info")
