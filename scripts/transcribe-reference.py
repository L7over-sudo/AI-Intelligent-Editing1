import json
import os
import sys

from faster_whisper import WhisperModel


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: transcribe-reference.py AUDIO LANGUAGE MODEL_DIR")

    audio_path, language, model_directory = sys.argv[1:]
    os.makedirs(model_directory, exist_ok=True)
    model = WhisperModel(
        "small",
        device="cuda",
        compute_type="float16",
        download_root=model_directory,
    )
    segments, info = model.transcribe(
        audio_path,
        language=None if language == "auto" else language,
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )
    text = "".join(segment.text for segment in segments).strip()
    print(
        json.dumps(
            {"text": text, "language": info.language},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
