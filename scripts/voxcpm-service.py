"""Local-only VoxCPM2 voice-cloning HTTP service for StickMotion."""

from __future__ import annotations

import io
import os
import threading
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from voxcpm import VoxCPM


class CloneRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=4096)
    reference_audio_path: str = Field(min_length=1, max_length=1000)
    prompt_text: str = Field(default="", max_length=1000)
    cfg_value: float = Field(default=2.0, ge=1.0, le=4.0)
    inference_timesteps: int = Field(default=10, ge=4, le=30)
    normalize: bool = True

    @field_validator("text", "prompt_text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


install_root = Path(os.environ.get("VOXCPM_HOME", r"D:\AI-Tools\VoxCPM")).resolve()
allowed_root = Path(
    os.environ.get("VOXCPM_ALLOWED_ROOT", str(Path.cwd() / "storage" / "media"))
).resolve()
cache_directory = Path(
    os.environ.get("VOXCPM_CACHE_DIR", str(install_root / "models"))
).resolve()
model_id = os.environ.get("VOXCPM_MODEL_ID", "openbmb/VoxCPM2")
device = os.environ.get("VOXCPM_DEVICE", "cuda")

cache_directory.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="StickMotion VoxCPM2", docs_url=None, redoc_url=None)
generation_lock = threading.Lock()
model: VoxCPM | None = None
model_error = ""


def resolve_reference(raw_path: str) -> Path:
    candidate = Path(raw_path).resolve(strict=True)
    try:
        candidate.relative_to(allowed_root)
    except ValueError as error:
        raise HTTPException(
            status_code=400, detail="REFERENCE_AUDIO_OUTSIDE_STORAGE"
        ) from error
    if candidate.suffix.lower() != ".wav":
        raise HTTPException(status_code=400, detail="REFERENCE_AUDIO_WAV_REQUIRED")
    return candidate


@app.on_event("startup")
def load_model() -> None:
    global model, model_error
    try:
        if device.startswith("cuda") and not torch.cuda.is_available():
            raise RuntimeError("CUDA_NOT_AVAILABLE")
        model = VoxCPM.from_pretrained(
            model_id,
            load_denoiser=False,
            device=device,
            cache_dir=str(cache_directory),
            optimize=False,
        )
        model_error = ""
    except Exception as error:
        model_error = f"{type(error).__name__}: {error}"[-1000:]
        raise


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": model is not None,
        "model": model_id,
        "device": device,
        "sampleRate": 48_000 if model is None else model.tts_model.sample_rate,
        "error": model_error or None,
    }


@app.post("/v1/voice-clone")
def clone_voice(request: CloneRequest) -> Response:
    if model is None:
        raise HTTPException(status_code=503, detail="VOXCPM_MODEL_NOT_READY")
    reference = resolve_reference(request.reference_audio_path)
    prompt_text = request.prompt_text.strip()
    generate_kwargs: dict[str, object] = {
        "text": request.text,
        "reference_wav_path": str(reference),
        "cfg_value": request.cfg_value,
        "inference_timesteps": request.inference_timesteps,
        "normalize": request.normalize,
        "denoise": False,
        "retry_badcase": True,
        "retry_badcase_max_times": 2,
    }
    if prompt_text:
        generate_kwargs.update(
            {
                "prompt_wav_path": str(reference),
                "prompt_text": prompt_text,
            }
        )

    try:
        with generation_lock, torch.inference_mode():
            waveform = model.generate(**generate_kwargs)
        audio = np.asarray(waveform, dtype=np.float32).reshape(-1)
        if audio.size == 0:
            raise RuntimeError("EMPTY_AUDIO")
        buffer = io.BytesIO()
        sf.write(
            buffer,
            audio,
            model.tts_model.sample_rate,
            format="WAV",
            subtype="PCM_16",
        )
        return Response(
            content=buffer.getvalue(),
            media_type="audio/wav",
            headers={"X-AI-Voice": "VoxCPM2", "Cache-Control": "no-store"},
        )
    except torch.OutOfMemoryError as error:
        torch.cuda.empty_cache()
        raise HTTPException(status_code=507, detail="VOXCPM_GPU_MEMORY_LOW") from error
    except HTTPException:
        raise
    except Exception as error:
        message = f"{type(error).__name__}: {error}".replace("\n", " ")
        raise HTTPException(status_code=500, detail=message[-1000:]) from error


def main() -> None:
    host = os.environ.get("VOXCPM_HOST", "127.0.0.1")
    port = int(os.environ.get("VOXCPM_PORT", "9880"))
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("VOXCPM_HOST_MUST_BE_LOOPBACK")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()