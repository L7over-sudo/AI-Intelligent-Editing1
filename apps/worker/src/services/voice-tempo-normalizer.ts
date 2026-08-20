import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { wavDurationMs, type SubtitleCueInput } from "@stickmotion/media";

const execFileAsync = promisify(execFile);

export const VOICE_TEMPO_NORMALIZER_TIMEOUT_MS = 120_000;

export interface VoiceTempoNormalizerOptions {
  /** Target spoken-character rate for cues that are clearly too fast. */
  targetCharsPerSecond?: number;
  /** Do not alter cues at or below this rate. */
  maximumCharsPerSecond?: number;
  /** Avoid extreme time stretching on very short or noisy cues. */
  minimumTempoFactor?: number;
}

export interface VoiceTempoNormalizationResult {
  audio: Uint8Array;
  cues: SubtitleCueInput[];
  changed: boolean;
  repairedCueCount: number;
}

interface TempoSegment {
  startMs: number;
  endMs: number;
  tempo: number;
  cueIndex?: number;
  outputStartMs?: number;
  outputEndMs?: number;
}

function cueCharacterCount(text: string): number {
  return Array.from(text.replace(/\s+/gu, "").trim()).length;
}

export function cueCharsPerSecond(cue: SubtitleCueInput): number {
  const durationMs = Math.max(1, cue.endMs - cue.startMs);
  return cueCharacterCount(cue.text) / (durationMs / 1_000);
}

export function tempoFactorForCue(
  cue: SubtitleCueInput,
  options: VoiceTempoNormalizerOptions = {},
): number {
  const target = Math.max(1, options.targetCharsPerSecond ?? 6);
  const maximum = Math.max(
    target,
    options.maximumCharsPerSecond ?? 6.4,
  );
  const minimumFactor = Math.max(
    0.5,
    Math.min(1, options.minimumTempoFactor ?? 0.7),
  );
  const rate = cueCharsPerSecond(cue);
  if (!Number.isFinite(rate) || rate <= maximum) return 1;
  return Math.max(minimumFactor, Math.min(1, target / rate));
}

function seconds(ms: number): string {
  return (Math.max(0, ms) / 1_000).toFixed(6);
}

function buildTempoSegments(
  durationMs: number,
  cues: readonly SubtitleCueInput[],
  options: VoiceTempoNormalizerOptions,
): TempoSegment[] {
  const segments: TempoSegment[] = [];
  let cursorMs = 0;
  cues.forEach((cue, cueIndex) => {
    const startMs = Math.max(cursorMs, Math.min(durationMs, Math.round(cue.startMs)));
    const endMs = Math.max(
      startMs,
      Math.min(durationMs, Math.round(cue.endMs)),
    );
    if (startMs > cursorMs) {
      segments.push({ startMs: cursorMs, endMs: startMs, tempo: 1 });
    }
    if (endMs > startMs) {
      segments.push({
        startMs,
        endMs,
        tempo: tempoFactorForCue(cue, options),
        cueIndex,
      });
      cursorMs = endMs;
    }
  });
  if (cursorMs < durationMs) {
    segments.push({ startMs: cursorMs, endMs: durationMs, tempo: 1 });
  }
  return segments;
}

function tempoFilter(segments: readonly TempoSegment[]): string {
  const filters = segments.map((segment, index) => {
    const tempo = segment.tempo === 1 ? "" : `,atempo=${segment.tempo.toFixed(6)}`;
    return `[0:a]atrim=start=${seconds(segment.startMs)}:end=${seconds(segment.endMs)},` +
      `asetpts=PTS-STARTPTS${tempo}[tempo${index}]`;
  });
  const inputs = segments.map((_, index) => `[tempo${index}]`).join("");
  return `${filters.join(";")};${inputs}concat=n=${segments.length}:v=0:a=1[out]`;
}

/**
 * Slows only subtitle spans whose measured character rate is abnormally high.
 * Quiet gaps and already-natural spans remain sample-for-sample unchanged.
 */
export async function normalizeCueTempoPcmWav(
  audio: Uint8Array,
  cues: readonly SubtitleCueInput[],
  options: VoiceTempoNormalizerOptions = {},
): Promise<VoiceTempoNormalizationResult> {
  const durationMs = wavDurationMs(audio);
  if (!durationMs || durationMs <= 0 || cues.length === 0) {
    return {
      audio,
      cues: cues.map((cue) => ({ ...cue })),
      changed: false,
      repairedCueCount: 0,
    };
  }
  const segments = buildTempoSegments(durationMs, cues, options);
  const repairedCueCount = segments.filter(
    (segment) => segment.cueIndex !== undefined && segment.tempo !== 1,
  ).length;
  if (repairedCueCount === 0) {
    return {
      audio,
      cues: cues.map((cue) => ({ ...cue })),
      changed: false,
      repairedCueCount: 0,
    };
  }

  const workspace = await mkdtemp(path.join(tmpdir(), "stickmotion-voice-tempo-"));
  const inputPath = path.join(workspace, "input.wav");
  const outputPath = path.join(workspace, "output.wav");
  try {
    await writeFile(inputPath, audio);
    await execFileAsync(
      process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-filter_complex",
        tempoFilter(segments),
        "-map",
        "[out]",
        "-ac",
        "1",
        "-ar",
        "22050",
        "-c:a",
        "pcm_s16le",
        outputPath,
      ],
      {
        windowsHide: true,
        timeout: VOICE_TEMPO_NORMALIZER_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const normalizedAudio = new Uint8Array(await readFile(outputPath));
    if (normalizedAudio.byteLength < 44) {
      throw new Error("VOICE_AUDIO_INVALID");
    }

    let outputCursorMs = 0;
    const mappedSegments = segments.map((segment) => {
      const outputStartMs = outputCursorMs;
      outputCursorMs += (segment.endMs - segment.startMs) / segment.tempo;
      return {
        ...segment,
        outputStartMs,
        outputEndMs: outputCursorMs,
      };
    });
    const shiftedCues = cues.map((cue, cueIndex) => {
      const cueSegments = mappedSegments.filter(
        (segment) => segment.cueIndex === cueIndex,
      );
      const first = cueSegments[0];
      const last = cueSegments.at(-1);
      if (!first || !last) return { ...cue };
      const startMs = first.outputStartMs ?? cue.startMs;
      const endMs = last.outputEndMs ?? cue.endMs;
      return {
        ...cue,
        startMs: Math.round(startMs),
        endMs: Math.max(Math.round(startMs + 1), Math.round(endMs)),
      };
    });
    return {
      audio: normalizedAudio,
      cues: shiftedCues,
      changed: true,
      repairedCueCount,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "VOICE_AUDIO_INVALID") {
      throw error;
    }
    throw new Error("VOICE_TEMPO_NORMALIZATION_FAILED", { cause: error });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
