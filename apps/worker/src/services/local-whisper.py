import json
import os
import sys

from faster_whisper import WhisperModel

sys.stdout.reconfigure(encoding="utf-8")

model_root, *audio_paths = sys.argv[1:]
model_name = os.environ.get("WHISPER_ALIGNER_MODEL", "turbo")
model = WhisperModel(model_name, device="cpu", compute_type="int8", download_root=model_root)
results = []
for audio_path in audio_paths:
    segments, _ = model.transcribe(
        audio_path,
        language="zh",
        word_timestamps=True,
        vad_filter=False,
        # Exact project text is force-aligned after transcription. A greedy
        # pass is much faster for dozens of short, isolated scene clips and
        # avoids hitting the worker's process timeout.
        beam_size=1,
        condition_on_previous_text=False,
    )
    words = []
    for segment in segments:
        for word in segment.words or []:
            words.append(
                {
                    "start": word.start,
                    # Whisper can emit a zero-length first token for a clip
                    # that begins immediately with speech. Keep the token for
                    # text coverage while giving it a valid minimal interval.
                    "end": max(word.end, word.start + 0.001),
                    "word": word.word,
                    "probability": word.probability,
                }
            )
    results.append({"words": words})
print(json.dumps({"results": results}, ensure_ascii=False))
