import {
  concatenatePcmWav,
  fadeOutPcmWav,
  findQuietestPcmWavPointMs,
  slicePcmWav,
  splitSubtitleText,
  wavDurationMs,
} from "@stickmotion/media";

import {
  forceAlignSubtitleCues,
  type RecognizedWord,
} from "./forced-subtitle-alignment";
import { transcribeNarrationBatchesWithLocalWhisper } from "./local-whisper-aligner";

export interface NarrationArtifactRepair {
  index: number;
  originalDurationMs: number;
  repairedDurationMs: number;
  removedMs: number;
}

export interface NarrationArtifactGuardResult {
  parts: Uint8Array[];
  repairs: NarrationArtifactRepair[];
}

type NarrationTranscriber = (
  audioInputs: readonly Uint8Array[],
) => Promise<RecognizedWord[][]>;

/**
 * Removes a provider hallucination only when local recognition has already
 * covered the complete expected scene text and a large, unrecognized tail is
 * still present. Normal word timing and normal sentence pauses are untouched.
 */
export async function sanitizeNarrationArtifactTails(input: {
  parts: readonly Uint8Array[];
  texts: readonly string[];
  transcribe?: NarrationTranscriber;
  minimumUnexpectedTailMs?: number;
  retainedTailMs?: number;
}): Promise<NarrationArtifactGuardResult> {
  if (input.parts.length !== input.texts.length) {
    throw new Error("NARRATION_ARTIFACT_PART_COUNT_MISMATCH");
  }
  if (input.parts.length === 0) return { parts: [], repairs: [] };

  const minimumUnexpectedTailMs = Math.max(
    500,
    Math.round(input.minimumUnexpectedTailMs ?? 800),
  );
  const retainedTailMs = Math.max(
    120,
    Math.min(400, Math.round(input.retainedTailMs ?? 220)),
  );
  const transcribe =
    input.transcribe ?? transcribeNarrationBatchesWithLocalWhisper;
  const continuousAudio = concatenatePcmWav(
    input.parts.map((audio) => ({ audio, pauseAfterMs: 0 })),
  );
  const transcriptions = await transcribe([continuousAudio]);
  const continuousWords = transcriptions[0];
  if (!continuousWords) {
    throw new Error("NARRATION_ARTIFACT_TRANSCRIPTION_COUNT_MISMATCH");
  }

  let alignedEndsMs: number[];
  try {
    const aligned = forceAlignSubtitleCues(
      input.texts.join(""),
      continuousWords,
      input.texts,
      0.18,
    );
    let cueIndex = 0;
    alignedEndsMs = input.texts.map((text) => {
      const cueCount = splitSubtitleText(text, null).length;
      const sceneCues = aligned.slice(cueIndex, cueIndex + cueCount);
      cueIndex += cueCount;
      return Math.max(...sceneCues.map((cue) => cue.endMs), 0);
    });
    if (cueIndex !== aligned.length) {
      throw new Error("NARRATION_ARTIFACT_CUE_COUNT_MISMATCH");
    }
  } catch {
    // A difficult full-document recognition may cross Whisper segment
    // boundaries. Fall back to isolated scenes only in that rare case.
    const perPartTranscriptions = await transcribe(input.parts);
    if (perPartTranscriptions.length !== input.parts.length) {
      throw new Error("NARRATION_ARTIFACT_TRANSCRIPTION_COUNT_MISMATCH");
    }
    let fallbackOffsetMs = 0;
    alignedEndsMs = input.texts.map((text, index) => {
      const partDurationMs = wavDurationMs(input.parts[index]!) ?? 0;
      try {
        const aligned = forceAlignSubtitleCues(
          text,
          perPartTranscriptions[index] ?? [],
          undefined,
          0.15,
        );
        const endMs =
          fallbackOffsetMs + Math.max(...aligned.map((cue) => cue.endMs), 0);
        fallbackOffsetMs += partDurationMs;
        return endMs;
      } catch {
        fallbackOffsetMs += partDurationMs;
        return fallbackOffsetMs - partDurationMs;
      }
    });
  }

  const repairs: NarrationArtifactRepair[] = [];
  let partStartMs = 0;
  const parts = input.parts.map((audio, index) => {
    const originalDurationMs = wavDurationMs(audio);
    const text = input.texts[index]?.trim();
    const globalAlignedEndMs = alignedEndsMs[index] ?? 0;
    const alignedEndMs = Math.max(0, globalAlignedEndMs - partStartMs);
    partStartMs += originalDurationMs ?? 0;
    if (!originalDurationMs || !text || alignedEndMs <= 0) return audio;

    const unexpectedTailMs = originalDurationMs - alignedEndMs;
    if (unexpectedTailMs < minimumUnexpectedTailMs) return audio;
    const fallbackDurationMs = Math.min(
      originalDurationMs,
      alignedEndMs + retainedTailMs,
    );
    const quietest = findQuietestPcmWavPointMs(
      audio,
      Math.max(0, alignedEndMs - 180),
      Math.min(originalDurationMs, alignedEndMs + 650),
      { windowMs: 24, stepMs: 4 },
    );
    const repairedDurationMs =
      quietest &&
      quietest.rms <= Math.max(140, quietest.overallRms * 0.12)
        ? quietest.pointMs
        : fallbackDurationMs;
    if (originalDurationMs - repairedDurationMs < minimumUnexpectedTailMs / 2) {
      return audio;
    }

    const repaired = fadeOutPcmWav(
      slicePcmWav(audio, 0, repairedDurationMs),
      Math.min(24, retainedTailMs),
    );
    const actualDurationMs = wavDurationMs(repaired) ?? repairedDurationMs;
    repairs.push({
      index,
      originalDurationMs,
      repairedDurationMs: actualDurationMs,
      removedMs: originalDurationMs - actualDurationMs,
    });
    return repaired;
  });

  return { parts, repairs };
}
