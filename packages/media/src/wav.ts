import type { SubtitleCueInput } from "./subtitles";

interface ParsedPcmWav {
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  data: Uint8Array;
}

export interface WavPart {
  audio: Uint8Array;
  pauseAfterMs: number;
}

const ascii = new TextDecoder("ascii");
const encoder = new TextEncoder();

function createPcmWav(
  format: Omit<ParsedPcmWav, "data">,
  data: Uint8Array,
): Uint8Array {
  const output = new Uint8Array(44 + data.byteLength);
  const view = new DataView(output.buffer);
  output.set(encoder.encode("RIFF"), 0);
  view.setUint32(4, 36 + data.byteLength, true);
  output.set(encoder.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, format.channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.byteRate, true);
  view.setUint16(32, format.blockAlign, true);
  view.setUint16(34, format.bitsPerSample, true);
  output.set(encoder.encode("data"), 36);
  view.setUint32(40, data.byteLength, true);
  output.set(data, 44);
  return output;
}

function chunkName(audio: Uint8Array, offset: number): string {
  return ascii.decode(audio.subarray(offset, offset + 4));
}

function parsePcmWav(audio: Uint8Array): ParsedPcmWav {
  if (
    audio.byteLength < 44 ||
    chunkName(audio, 0) !== "RIFF" ||
    chunkName(audio, 8) !== "WAVE"
  ) {
    throw new Error("WAV_PCM_REQUIRED");
  }
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  let format: Omit<ParsedPcmWav, "data"> | undefined;
  let data: Uint8Array | undefined;
  let offset = 12;
  while (offset + 8 <= audio.byteLength) {
    const name = chunkName(audio, offset);
    const size = view.getUint32(offset + 4, true);
    const contentOffset = offset + 8;
    if (contentOffset + size > audio.byteLength) {
      throw new Error("WAV_CHUNK_INVALID");
    }
    if (name === "fmt " && size >= 16) {
      const audioFormat = view.getUint16(contentOffset, true);
      if (audioFormat !== 1) throw new Error("WAV_PCM_REQUIRED");
      format = {
        channels: view.getUint16(contentOffset + 2, true),
        sampleRate: view.getUint32(contentOffset + 4, true),
        byteRate: view.getUint32(contentOffset + 8, true),
        blockAlign: view.getUint16(contentOffset + 12, true),
        bitsPerSample: view.getUint16(contentOffset + 14, true),
      };
    } else if (name === "data") {
      data = audio.slice(contentOffset, contentOffset + size);
    }
    offset = contentOffset + size + (size % 2);
  }
  if (!format || !data || format.byteRate <= 0 || format.blockAlign <= 0) {
    throw new Error("WAV_DATA_REQUIRED");
  }
  return { ...format, data };
}

function assertSameFormat(expected: ParsedPcmWav, actual: ParsedPcmWav): void {
  if (
    expected.channels !== actual.channels ||
    expected.sampleRate !== actual.sampleRate ||
    expected.byteRate !== actual.byteRate ||
    expected.blockAlign !== actual.blockAlign ||
    expected.bitsPerSample !== actual.bitsPerSample
  ) {
    throw new Error("WAV_FORMAT_MISMATCH");
  }
}

export function concatenatePcmWav(parts: readonly WavPart[]): Uint8Array {
  if (parts.length === 0) throw new Error("WAV_PARTS_REQUIRED");
  if (parts.length === 1 && parts[0]!.pauseAfterMs <= 0) return parts[0]!.audio;
  const parsed = parts.map((part) => parsePcmWav(part.audio));
  const format = parsed[0]!;
  for (const item of parsed.slice(1)) assertSameFormat(format, item);
  const silenceLengths = parts.map((part) => {
    const sampleFrames = Math.max(
      0,
      Math.round((format.sampleRate * part.pauseAfterMs) / 1_000),
    );
    return sampleFrames * format.blockAlign;
  });
  const dataLength = parsed.reduce(
    (sum, item, index) => sum + item.data.byteLength + silenceLengths[index]!,
    0,
  );
  if (dataLength > 500 * 1024 * 1024) throw new Error("WAV_OUTPUT_TOO_LARGE");
  const data = new Uint8Array(dataLength);
  let offset = 0;
  parsed.forEach((item, index) => {
    data.set(item.data, offset);
    offset += item.data.byteLength + silenceLengths[index]!;
  });
  return createPcmWav(format, data);
}

/**
 * Shortens every quiet gap inside the clip (excluding the trailing tail) to
 * at most `maximumPauseMs`, so comma-level breaks never grow longer than a
 * controlled sentence tail. The trailing tail is left for the caller to cap.
 */
export function capInternalSilencePcmWav(
  audio: Uint8Array,
  options: {
    maximumPauseMs?: number;
    windowMs?: number;
    minimumGapMs?: number;
    crossfadeMs?: number;
  } = {},
): Uint8Array {
  const maximumPauseMs = Math.max(
    40,
    Math.round(options.maximumPauseMs ?? 160),
  );
  const windowMs = Math.max(10, Math.round(options.windowMs ?? 20));
  const minimumGapMs = Math.max(40, Math.round(options.minimumGapMs ?? 80));
  const crossfadeMs = Math.max(0, Math.round(options.crossfadeMs ?? 0));
  try {
    const parsed = parsePcmWav(audio);
    if (parsed.bitsPerSample !== 16) return audio;
    const durationMs = Math.round(
      (parsed.data.byteLength / parsed.byteRate) * 1_000,
    );
    const overallRms = pcmWavOverallRms(audio) ?? 0;
    const quietThreshold = Math.max(90, overallRms * 0.055);

    const gaps: Array<{ startMs: number; endMs: number }> = [];
    let inGap = false;
    let gapStartMs = 0;
    for (let atMs = 0; atMs <= durationMs; atMs += windowMs) {
      const quiet =
        pcm16WindowRms(parsed, atMs, Math.min(durationMs, atMs + windowMs)) <=
        quietThreshold;
      if (quiet && !inGap) {
        inGap = true;
        gapStartMs = atMs;
      } else if (!quiet && inGap) {
        inGap = false;
        if (atMs - gapStartMs >= minimumGapMs) {
          gaps.push({ startMs: gapStartMs, endMs: atMs });
        }
      }
    }
    if (inGap) gaps.push({ startMs: gapStartMs, endMs: durationMs });

    const overlong = gaps.filter(
      (gap) =>
        gap.endMs < durationMs && gap.endMs - gap.startMs > maximumPauseMs,
    );
    if (overlong.length === 0) return audio;

    if (crossfadeMs > 0) {
      let repaired = audio;
      for (const gap of [...overlong].reverse()) {
        const result = repairIntraSentencePausesPcmWav(
          repaired,
          [
            { startMs: 0, endMs: gap.startMs, text: "speech" },
            {
              startMs: gap.endMs,
              endMs: Math.max(gap.endMs + 1, durationMs),
              text: "speech",
            },
          ],
          {
            minimumGapMs,
            targetGapMs: maximumPauseMs,
            maximumGapMs: Math.max(durationMs, gap.endMs - gap.startMs),
            crossfadeMs,
            repairPauseBoundaries: true,
          },
        );
        repaired = result.audio;
      }
      return repaired;
    }

    const keepRanges: Array<{ startMs: number; endMs: number }> = [];
    let cursorMs = 0;
    for (const gap of overlong) {
      if (gap.startMs + maximumPauseMs > cursorMs) {
        keepRanges.push({
          startMs: cursorMs,
          endMs: gap.startMs + maximumPauseMs,
        });
      }
      cursorMs = gap.endMs;
    }
    if (cursorMs < durationMs) {
      keepRanges.push({ startMs: cursorMs, endMs: durationMs });
    }
    if (keepRanges.length === 0) return audio;
    return concatenatePcmWav(
      keepRanges.map((range) => ({
        audio: slicePcmWav(audio, range.startMs, range.endMs),
        pauseAfterMs: 0,
      })),
    );
  } catch {
    return audio;
  }
}

export function slicePcmWav(
  audio: Uint8Array,
  startMs: number,
  endMs: number,
): Uint8Array {
  const parsed = parsePcmWav(audio);
  const totalFrames = Math.floor(parsed.data.byteLength / parsed.blockAlign);
  const startFrame = Math.min(
    totalFrames,
    Math.max(0, Math.round((parsed.sampleRate * startMs) / 1_000)),
  );
  const endFrame = Math.min(
    totalFrames,
    Math.max(startFrame, Math.round((parsed.sampleRate * endMs) / 1_000)),
  );
  if (endFrame <= startFrame) throw new Error("WAV_SLICE_EMPTY");
  const data = parsed.data.slice(
    startFrame * parsed.blockAlign,
    endFrame * parsed.blockAlign,
  );
  return createPcmWav(parsed, data);
}

export function narrationPauseAfterMs(narration: string): number {
  const text = narration.trim();
  if (/(?:……|\.{3,})$/u.test(text)) return 220;
  if (/[。！？!?]$/u.test(text)) return 420;
  if (/[，,、；;：:]$/u.test(text)) return 140;
  return 120;
}

/**
 * Pause inserted at render time between separately synthesized scene clips.
 * Each clip already carries a short tail, so only true sentence
 * endings get extra room; comma clause breaks keep their natural flow and
 * never stall mid-sentence.
 */
export function interSceneNarrationPauseMs(narration: string): number {
  const text = narration.trim().replace(/[”’"'）)\]】》〉]+$/u, "");
  if (/[。！？!?…]$/u.test(text)) return 60;
  return 0;
}

export interface NormalizeNarrationPcmWavInput {
  audio: Uint8Array;
  cues: readonly SubtitleCueInput[];
  /** Optional fine-grained provider word boundaries used only for pause repair. */
  pauseCues?: readonly SubtitleCueInput[];
  narration: string;
  edgePaddingMs?: number;
  trailingPauseMs?: number;
  /** Tiny boundary smoothing fade; long voice fades are intentionally avoided. */
  fadeOutMs?: number;
  /** Keep voiced samples when cue alignment ends before the acoustic tail. */
  preserveAcousticTail?: boolean;
}

export interface NormalizedNarrationPcmWav {
  audio: Uint8Array;
  cues: SubtitleCueInput[];
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  pauseAfterMs: number;
}

export interface IntraSentencePauseRepairOptions {
  /** Do not touch short gaps that can be ordinary consonant transitions. */
  minimumGapMs?: number;
  /** The target gap after removing an abnormal quiet middle section. */
  targetGapMs?: number;
  /** Longer gaps are treated as intentional pauses unless punctuation says otherwise. */
  maximumGapMs?: number;
  /** Fade length used at the repaired seam. */
  crossfadeMs?: number;
  /** Window size used when checking whether a gap is actually quiet. */
  quietWindowMs?: number;
  /** Maximum quiet-window RMS as a fraction of the narration RMS. */
  quietRatio?: number;
  /** Allow repairing long comma/clause pauses when the caller has trusted cues. */
  repairPauseBoundaries?: boolean;
}

export interface IntraSentencePauseRepairResult {
  audio: Uint8Array;
  cues: SubtitleCueInput[];
  repairedPauseCount: number;
  removedMs: number;
  edits: IntraSentencePauseRepairEdit[];
}

export interface IntraSentencePauseRepairEdit {
  cutStartMs: number;
  cutEndMs: number;
  removedMs: number;
}

const pauseBoundaryPattern = /[。！？!?；;：:，,、…]/u;
const closingPunctuationPattern = /[”’》）】〕〉」』"')\]]+$/u;

function endsWithPauseBoundary(text: string): boolean {
  const withoutClosingMarks = text
    .trim()
    .replace(closingPunctuationPattern, "");
  const lastCharacter = Array.from(withoutClosingMarks).at(-1);
  return (
    lastCharacter !== undefined && pauseBoundaryPattern.test(lastCharacter)
  );
}

function pcm16GapIsQuiet(
  parsed: ParsedPcmWav,
  startMs: number,
  endMs: number,
  quietWindowMs: number,
  quietRatio: number,
): boolean {
  if (endMs <= startMs) return false;
  const overallRms = rmsOfPcm16(parsed.data);
  if (overallRms === undefined || overallRms <= 0) return false;
  const threshold = Math.max(100, overallRms * quietRatio);
  const windowMs = Math.max(5, Math.round(quietWindowMs));
  for (let atMs = startMs; atMs < endMs; atMs += windowMs) {
    const windowEndMs = Math.min(endMs, atMs + windowMs);
    if (pcm16WindowRms(parsed, atMs, windowEndMs) > threshold) return false;
  }
  return true;
}

/**
 * Compresses only an unusually long, quiet gap inside a sentence. This is a
 * local pause repair, not tempo normalization: voiced samples are copied at
 * their original rate and only the quiet middle of the gap is removed.
 */
export function repairIntraSentencePausesPcmWav(
  audio: Uint8Array,
  cues: readonly SubtitleCueInput[],
  options: IntraSentencePauseRepairOptions = {},
): IntraSentencePauseRepairResult {
  const minimumGapMs = Math.max(1, Math.round(options.minimumGapMs ?? 120));
  const targetGapMs = Math.max(
    20,
    Math.min(minimumGapMs - 1, Math.round(options.targetGapMs ?? 60)),
  );
  const maximumGapMs = Math.max(
    minimumGapMs,
    Math.round(options.maximumGapMs ?? 420),
  );
  const crossfadeMs = Math.max(0, Math.round(options.crossfadeMs ?? 12));
  const quietWindowMs = Math.max(5, Math.round(options.quietWindowMs ?? 10));
  const quietRatio = Math.max(0.01, Math.min(1, options.quietRatio ?? 0.18));
  const repairPauseBoundaries = options.repairPauseBoundaries ?? false;

  try {
    let parsed = parsePcmWav(audio);
    if (parsed.bitsPerSample !== 16 || cues.length < 2) {
      return {
        audio,
        cues: cues.map((cue) => ({ ...cue })),
        repairedPauseCount: 0,
        removedMs: 0,
        edits: [],
      };
    }

    let repairedAudio = audio;
    let repairedCues = cues.map((cue) => ({ ...cue }));
    let timelineShiftMs = 0;
    let repairedPauseCount = 0;
    const edits: IntraSentencePauseRepairEdit[] = [];

    for (let index = 0; index < cues.length - 1; index += 1) {
      const previous = cues[index]!;
      const next = cues[index + 1]!;
      const sourceGapMs = next.startMs - previous.endMs;
      if (
        sourceGapMs < minimumGapMs ||
        sourceGapMs > maximumGapMs ||
        (!repairPauseBoundaries && endsWithPauseBoundary(previous.text))
      ) {
        continue;
      }

      const gapStartMs = previous.endMs - timelineShiftMs;
      const gapEndMs = next.startMs - timelineShiftMs;
      const gapMs = gapEndMs - gapStartMs;
      if (
        gapMs < minimumGapMs ||
        !pcm16GapIsQuiet(
          parsed,
          gapStartMs,
          gapEndMs,
          quietWindowMs,
          quietRatio,
        )
      ) {
        continue;
      }

      const sampleRate = parsed.sampleRate;
      const gapFrames = Math.max(1, Math.round((gapMs * sampleRate) / 1_000));
      const targetFrames = Math.max(
        1,
        Math.round((targetGapMs * sampleRate) / 1_000),
      );
      const requestedCrossfadeFrames = Math.max(
        0,
        Math.round((crossfadeMs * sampleRate) / 1_000),
      );
      const crossfadeFrames = Math.min(
        requestedCrossfadeFrames,
        Math.max(0, Math.floor(gapFrames / 4)),
      );
      const middleRemoveFrames = gapFrames - targetFrames - crossfadeFrames;
      if (middleRemoveFrames <= 0) continue;

      const cutStartMs =
        gapStartMs +
        ((gapFrames - middleRemoveFrames) * 1_000) / sampleRate / 2;
      const cutEndMs = cutStartMs + (middleRemoveFrames * 1_000) / sampleRate;
      const beforeDurationMs = wavDurationMs(repairedAudio) ?? 0;
      repairedAudio = removePcmRangeWithCrossfade(
        repairedAudio,
        cutStartMs,
        cutEndMs,
        crossfadeFrames,
      );
      parsed = parsePcmWav(repairedAudio);
      const afterDurationMs = wavDurationMs(repairedAudio) ?? beforeDurationMs;
      const removedMs = Math.max(0, beforeDurationMs - afterDurationMs);
      if (removedMs <= 0) continue;

      repairedCues = repairedCues.map((cue) => {
        const startMs = shiftCueTime(
          cue.startMs,
          cutStartMs,
          cutEndMs,
          removedMs,
        );
        const endMs = shiftCueTime(cue.endMs, cutStartMs, cutEndMs, removedMs);
        return {
          ...cue,
          startMs: Math.max(0, startMs),
          endMs: Math.max(startMs + 1, endMs),
        };
      });
      timelineShiftMs += removedMs;
      repairedPauseCount += 1;
      edits.push({ cutStartMs, cutEndMs, removedMs });
    }

    return {
      audio: repairedAudio,
      cues: repairedCues,
      repairedPauseCount,
      removedMs: timelineShiftMs,
      edits,
    };
  } catch {
    return {
      audio,
      cues: cues.map((cue) => ({ ...cue })),
      repairedPauseCount: 0,
      removedMs: 0,
      edits: [],
    };
  }
}

function shiftCueTime(
  timeMs: number,
  cutStartMs: number,
  cutEndMs: number,
  removedMs: number,
): number {
  if (timeMs >= cutEndMs) return timeMs - removedMs;
  if (timeMs > cutStartMs) return cutStartMs;
  return timeMs;
}

function removePcmRangeWithCrossfade(
  audio: Uint8Array,
  startMs: number,
  endMs: number,
  requestedCrossfadeFrames: number,
): Uint8Array {
  const parsed = parsePcmWav(audio);
  const totalFrames = Math.floor(parsed.data.byteLength / parsed.blockAlign);
  const startFrame = Math.max(
    0,
    Math.min(
      totalFrames - 1,
      Math.round((startMs * parsed.sampleRate) / 1_000),
    ),
  );
  const endFrame = Math.max(
    startFrame + 1,
    Math.min(totalFrames, Math.round((endMs * parsed.sampleRate) / 1_000)),
  );
  const crossfadeFrames = Math.min(
    Math.max(0, requestedCrossfadeFrames),
    startFrame,
    totalFrames - endFrame,
  );
  const leftStartFrame = startFrame - crossfadeFrames;
  const rightStartFrame = endFrame + crossfadeFrames;
  const outputData = new Uint8Array(
    parsed.data.byteLength -
      (endFrame - startFrame + crossfadeFrames) * parsed.blockAlign,
  );
  const leftPrefixBytes = leftStartFrame * parsed.blockAlign;
  outputData.set(parsed.data.subarray(0, leftPrefixBytes), 0);
  let outputOffset = leftPrefixBytes;

  if (crossfadeFrames > 0) {
    const sourceView = new DataView(
      parsed.data.buffer,
      parsed.data.byteOffset,
      parsed.data.byteLength,
    );
    const outputView = new DataView(
      outputData.buffer,
      outputData.byteOffset,
      outputData.byteLength,
    );
    for (let frame = 0; frame < crossfadeFrames; frame += 1) {
      const leftGain = (crossfadeFrames - 1 - frame) / crossfadeFrames;
      const rightGain = (frame + 1) / crossfadeFrames;
      for (let channel = 0; channel < parsed.channels; channel += 1) {
        const leftOffset =
          (leftStartFrame + frame) * parsed.blockAlign + channel * 2;
        const rightOffset =
          (endFrame + frame) * parsed.blockAlign + channel * 2;
        const value = Math.max(
          -32_768,
          Math.min(
            32_767,
            Math.round(
              sourceView.getInt16(leftOffset, true) * leftGain +
                sourceView.getInt16(rightOffset, true) * rightGain,
            ),
          ),
        );
        outputView.setInt16(outputOffset + channel * 2, value, true);
      }
      outputOffset += parsed.blockAlign;
    }
  }

  outputData.set(
    parsed.data.subarray(rightStartFrame * parsed.blockAlign),
    outputOffset,
  );
  return createPcmWav(parsed, outputData);
}

/**
 * Uses the provider's word/cue timestamps as the trusted speech boundary.
 * This removes TTS pre-roll glitches and inconsistent tail silence without
 * guessing at an amplitude threshold, then adds a stable punctuation pause.
 */
export function normalizeNarrationPcmWav({
  audio,
  cues,
  pauseCues,
  narration,
  edgePaddingMs = 60,
  trailingPauseMs,
  fadeOutMs = 8,
  preserveAcousticTail = false,
}: NormalizeNarrationPcmWavInput): NormalizedNarrationPcmWav {
  const sourceDurationMs = wavDurationMs(audio);
  const validCues = cues.filter(
    (cue) =>
      Number.isFinite(cue.startMs) &&
      Number.isFinite(cue.endMs) &&
      cue.startMs >= 0 &&
      cue.endMs > cue.startMs,
  );
  if (!sourceDurationMs || validCues.length === 0) {
    return {
      audio,
      cues: [...cues],
      durationMs: sourceDurationMs ?? 0,
      trimStartMs: 0,
      trimEndMs: sourceDurationMs ?? 0,
      pauseAfterMs: 0,
    };
  }

  const firstCueMs = Math.min(...validCues.map((cue) => cue.startMs));
  const lastCueMs = Math.max(...validCues.map((cue) => cue.endMs));
  const trimStartMs = Math.max(0, firstCueMs - edgePaddingMs);
  // Subtitle alignment can end early when the last phrase has no clean
  // acoustic boundary. Callers that trust the audio boundary can opt into
  // preserving voiced samples instead of trimming at the last cue.
  const acousticEndMs = preserveAcousticTail
    ? Math.max(
        lastCueMs,
        sourceDurationMs -
          Math.max(0, pcmWavTrailingSilenceMs(audio) ?? 0),
      )
    : lastCueMs;
  const trimEndMs = Math.min(sourceDurationMs, acousticEndMs + edgePaddingMs);
  if (trimEndMs <= trimStartMs) {
    return {
      audio,
      cues: [...cues],
      durationMs: sourceDurationMs,
      trimStartMs: 0,
      trimEndMs: sourceDurationMs,
      pauseAfterMs: 0,
    };
  }

  const content = fadeOutPcmWav(
    slicePcmWav(audio, trimStartMs, trimEndMs),
    Math.min(Math.max(0, fadeOutMs), edgePaddingMs),
  );
  const contentDurationMs = wavDurationMs(content) ?? trimEndMs - trimStartMs;
  const trimmedCues = validCues.map((cue) => {
    const startMs = Math.max(0, cue.startMs - trimStartMs);
    return {
      ...cue,
      startMs,
      endMs: Math.min(
        contentDurationMs,
        Math.max(startMs + 1, cue.endMs - trimStartMs),
      ),
    };
  });
  const repairBoundaries = (pauseCues ?? trimmedCues).map((cue) => {
    const startMs = Math.max(0, cue.startMs - trimStartMs);
    return {
      ...cue,
      startMs,
      endMs: Math.min(
        contentDurationMs,
        Math.max(startMs + 1, cue.endMs - trimStartMs),
      ),
    };
  });
  const repaired = repairIntraSentencePausesPcmWav(content, repairBoundaries);
  const pauseAfterMs = trailingPauseMs ?? narrationPauseAfterMs(narration);
  const normalizedAudio = concatenatePcmWav([
    { audio: repaired.audio, pauseAfterMs },
  ]);
  const normalizedCues = trimmedCues.map((cue) => {
    let startMs = cue.startMs;
    let endMs = cue.endMs;
    for (const edit of repaired.edits) {
      startMs = shiftCueTime(
        startMs,
        edit.cutStartMs,
        edit.cutEndMs,
        edit.removedMs,
      );
      endMs = shiftCueTime(
        endMs,
        edit.cutStartMs,
        edit.cutEndMs,
        edit.removedMs,
      );
    }
    return {
      ...cue,
      startMs: Math.max(0, startMs),
      endMs: Math.max(startMs + 1, endMs),
    };
  });

  return {
    audio: normalizedAudio,
    cues: normalizedCues,
    durationMs:
      wavDurationMs(normalizedAudio) ?? contentDurationMs + pauseAfterMs,
    trimStartMs,
    trimEndMs,
    pauseAfterMs,
  };
}

export function wavDurationMs(audio: Uint8Array): number | undefined {
  try {
    const parsed = parsePcmWav(audio);
    return Math.round((parsed.data.byteLength / parsed.byteRate) * 1_000);
  } catch {
    return undefined;
  }
}

function rmsOfPcm16(data: Uint8Array): number | undefined {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let sum = 0;
  let count = 0;
  for (let offset = 0; offset + 1 < data.byteLength; offset += 2) {
    const sample = view.getInt16(offset, true);
    sum += sample * sample;
    count += 1;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

export function pcmWavOverallRms(audio: Uint8Array): number | undefined {
  try {
    const parsed = parsePcmWav(audio);
    if (parsed.bitsPerSample !== 16) return undefined;
    return rmsOfPcm16(parsed.data);
  } catch {
    return undefined;
  }
}

export function pcmWavTailRms(
  audio: Uint8Array,
  tailMs: number,
): number | undefined {
  try {
    const parsed = parsePcmWav(audio);
    if (parsed.bitsPerSample !== 16) return undefined;
    const tailFrames = Math.min(
      Math.max(1, Math.round((parsed.sampleRate * tailMs) / 1_000)),
      Math.floor(parsed.data.byteLength / parsed.blockAlign),
    );
    const startOffset = parsed.data.byteLength - tailFrames * parsed.blockAlign;
    return rmsOfPcm16(parsed.data.subarray(startOffset));
  } catch {
    return undefined;
  }
}

/** Returns the first sustained speech onset, ignoring a short provider click. */
export function pcmWavLeadingSilenceMs(
  audio: Uint8Array,
  options: { windowMs?: number; sustainedWindows?: number } = {},
): number | undefined {
  try {
    const parsed = parsePcmWav(audio);
    if (parsed.bitsPerSample !== 16) return undefined;
    const durationMs = Math.round(
      (parsed.data.byteLength / parsed.byteRate) * 1_000,
    );
    const windowMs = Math.max(5, options.windowMs ?? 10);
    const sustainedWindows = Math.max(2, options.sustainedWindows ?? 4);
    const overallRms = pcmWavOverallRms(audio) ?? 0;
    const activeThreshold = Math.max(90, overallRms * 0.055);
    const values: number[] = [];
    for (let atMs = 0; atMs < durationMs; atMs += windowMs) {
      values.push(
        pcm16WindowRms(parsed, atMs, Math.min(durationMs, atMs + windowMs)),
      );
    }
    for (let index = 0; index <= values.length - sustainedWindows; index += 1) {
      if (
        values
          .slice(index, index + sustainedWindows)
          .every((value) => value > activeThreshold)
      ) {
        return index * windowMs;
      }
    }
    return durationMs;
  } catch {
    return undefined;
  }
}

/** Returns the sustained quiet tail of 16-bit PCM audio. */
export function pcmWavTrailingSilenceMs(
  audio: Uint8Array,
  options: { windowMs?: number } = {},
): number | undefined {
  try {
    const parsed = parsePcmWav(audio);
    if (parsed.bitsPerSample !== 16) return undefined;
    const durationMs = Math.round(
      (parsed.data.byteLength / parsed.byteRate) * 1_000,
    );
    const windowMs = Math.max(5, options.windowMs ?? 10);
    const overallRms = pcmWavOverallRms(audio) ?? 0;
    const activeThreshold = Math.max(90, overallRms * 0.055);
    for (let endMs = durationMs; endMs > 0; endMs -= windowMs) {
      const startMs = Math.max(0, endMs - windowMs);
      if (pcm16WindowRms(parsed, startMs, endMs) > activeThreshold) {
        return Math.max(0, durationMs - endMs);
      }
    }
    return durationMs;
  } catch {
    return undefined;
  }
}

/** Appends only the silence missing from a required sentence-end pause. */
export function ensureMinimumTrailingSilencePcmWav(
  audio: Uint8Array,
  minimumMs: number,
): Uint8Array {
  if (minimumMs <= 0) return audio;
  const existingMs = pcmWavTrailingSilenceMs(audio);
  if (existingMs === undefined || existingMs >= minimumMs) return audio;
  return concatenatePcmWav([{ audio, pauseAfterMs: minimumMs - existingMs }]);
}

function pcm16WindowRms(
  parsed: ParsedPcmWav,
  startMs: number,
  endMs: number,
): number {
  const frameCount = Math.floor(parsed.data.byteLength / parsed.blockAlign);
  const startFrame = Math.max(
    0,
    Math.min(frameCount, Math.round((startMs * parsed.sampleRate) / 1_000)),
  );
  const endFrame = Math.max(
    startFrame + 1,
    Math.min(frameCount, Math.round((endMs * parsed.sampleRate) / 1_000)),
  );
  return (
    rmsOfPcm16(
      parsed.data.subarray(
        startFrame * parsed.blockAlign,
        endFrame * parsed.blockAlign,
      ),
    ) ?? 0
  );
}

export interface QuietestPcmWavPoint {
  pointMs: number;
  rms: number;
  overallRms: number;
}

/** Finds the lowest-energy sample window inside a trusted semantic boundary. */
export function findQuietestPcmWavPointMs(
  audio: Uint8Array,
  startMs: number,
  endMs: number,
  options: { windowMs?: number; stepMs?: number } = {},
): QuietestPcmWavPoint | undefined {
  try {
    const parsed = parsePcmWav(audio);
    if (parsed.bitsPerSample !== 16) return undefined;
    const durationMs = Math.round(
      (parsed.data.byteLength / parsed.byteRate) * 1_000,
    );
    const windowMs = Math.max(4, options.windowMs ?? 20);
    const stepMs = Math.max(1, options.stepMs ?? 5);
    const safeStartMs = Math.max(windowMs / 2, Math.min(durationMs, startMs));
    const safeEndMs = Math.max(
      safeStartMs,
      Math.min(durationMs - windowMs / 2, endMs),
    );
    let pointMs = Math.round(safeStartMs);
    let minimumRms = Number.POSITIVE_INFINITY;
    for (let atMs = safeStartMs; atMs <= safeEndMs; atMs += stepMs) {
      const value = pcm16WindowRms(
        parsed,
        atMs - windowMs / 2,
        atMs + windowMs / 2,
      );
      if (value < minimumRms) {
        minimumRms = value;
        pointMs = Math.round(atMs);
      }
    }
    return {
      pointMs,
      rms: Number.isFinite(minimumRms) ? minimumRms : 0,
      overallRms: pcmWavOverallRms(audio) ?? 0,
    };
  } catch {
    return undefined;
  }
}

/**
 * Refines provider subtitle starts against audible PCM onsets. Around each
 * timestamp, the lowest-energy window is treated as the inter-phrase pause;
 * the subtitle changes on the first sustained rise after that pause.
 */
export function alignSubtitleCueStartsToPcmWav(
  audio: Uint8Array,
  cues: readonly SubtitleCueInput[],
  options: {
    searchRadiusMs?: number;
    firstSearchRadiusMs?: number;
    firstCueStrategy?: "not-before" | "acoustic";
    windowMs?: number;
    preserveCueEnds?: boolean;
  } = {},
): SubtitleCueInput[] {
  if (cues.length === 0) return [];
  try {
    const parsed = parsePcmWav(audio);
    if (parsed.bitsPerSample !== 16) return cues.map((cue) => ({ ...cue }));
    const durationMs = Math.round(
      (parsed.data.byteLength / parsed.byteRate) * 1_000,
    );
    const radiusMs = Math.max(80, options.searchRadiusMs ?? 350);
    const windowMs = Math.max(10, options.windowMs ?? 20);
    const overallRms = pcmWavOverallRms(audio) ?? 0;
    // Local voice providers can emit a short, loud pre-roll click before the actual voice.
    // A threshold derived only from the whole clip treats that click as the
    // onset, which makes the first subtitle lead the spoken words. Estimate a
    // noise floor from the quietest windows and require a clear rise above it.
    const windowRmsValues: number[] = [];
    for (let atMs = 0; atMs < durationMs; atMs += windowMs) {
      windowRmsValues.push(
        pcm16WindowRms(parsed, atMs, Math.min(durationMs, atMs + windowMs)),
      );
    }
    const sortedWindowRms = [...windowRmsValues].sort(
      (left, right) => left - right,
    );
    const noiseFloor =
      sortedWindowRms[
        Math.floor(Math.max(0, sortedWindowRms.length - 1) * 0.05)
      ] ?? 0;
    const quietThreshold = Math.max(90, noiseFloor * 1.5);
    const activeThreshold = Math.max(
      320,
      overallRms * 0.18,
      quietThreshold * 2,
    );
    const firstSustainedOnsetMs = (() => {
      const firstSearchRadiusMs = Math.max(
        radiusMs,
        options.firstSearchRadiusMs ?? radiusMs,
      );
      const searchEndMs = Math.min(
        durationMs - windowMs * 2,
        Math.max(firstSearchRadiusMs, cues[0]!.startMs + firstSearchRadiusMs),
      );
      const sustainedWindows = 5;
      const initialContinuityWindows = 10;
      const initialActiveWindows = windowRmsValues
        .slice(0, initialContinuityWindows)
        .filter((value) => value >= activeThreshold).length;
      const startsWithContinuousSpeech =
        initialActiveWindows >= initialContinuityWindows - 1;
      const quietWindowsBeforeOnset = 4;
      for (let atMs = 0; atMs <= searchEndMs; atMs += windowMs) {
        const startIndex = Math.round(atMs / windowMs);
        const endIndex = startIndex + sustainedWindows;
        const sustained = windowRmsValues
          .slice(startIndex, endIndex)
          .every((value) => value >= activeThreshold);
        if (!sustained) continue;

        // At the beginning of a clean clip there is no preceding quiet run;
        // accept a genuinely sustained onset at zero. Otherwise require a
        // short quiet run so an isolated pre-roll click cannot win.
        const quietRun = windowRmsValues.slice(
          Math.max(0, startIndex - quietWindowsBeforeOnset),
          startIndex,
        );
        const hasQuietRun =
          quietRun.filter((value) => value <= quietThreshold).length >= 2;
        if (
          (startIndex === 0 && startsWithContinuousSpeech) ||
          (startIndex > 0 && hasQuietRun)
        ) {
          return atMs;
        }
      }
      return undefined;
    })();
    const starts = cues.map((cue, index) => {
      if (index === 0) {
        if (
          options.firstCueStrategy === "acoustic" &&
          firstSustainedOnsetMs !== undefined
        ) {
          return firstSustainedOnsetMs;
        }
        return Math.max(0, cue.startMs, firstSustainedOnsetMs ?? 0);
      }
      const minimumMs = Math.max(
        cues[index - 1]!.startMs + 1,
        cue.startMs - radiusMs,
      );
      const maximumMs = Math.min(durationMs - 1, cue.startMs + radiusMs);
      if (maximumMs <= minimumMs) return cue.startMs;

      const candidates: number[] = [];
      for (
        let atMs = minimumMs + windowMs * 2;
        atMs <= maximumMs - windowMs * 2;
        atMs += windowMs
      ) {
        const quietOne = pcm16WindowRms(
          parsed,
          atMs - windowMs * 2,
          atMs - windowMs,
        );
        const quietTwo = pcm16WindowRms(parsed, atMs - windowMs, atMs);
        const activeOne = pcm16WindowRms(parsed, atMs, atMs + windowMs);
        const activeTwo = pcm16WindowRms(
          parsed,
          atMs + windowMs,
          atMs + windowMs * 2,
        );
        if (
          quietOne <= quietThreshold &&
          quietTwo <= quietThreshold &&
          activeOne >= activeThreshold &&
          activeTwo >= activeThreshold
        ) {
          candidates.push(atMs);
        }
      }
      if (candidates.length === 0) return cue.startMs;
      return Math.max(
        cues[index - 1]!.startMs + 1,
        candidates.reduce((closest, candidate) =>
          Math.abs(candidate - cue.startMs) < Math.abs(closest - cue.startMs)
            ? candidate
            : closest,
        ),
      );
    });

    const orderedStarts: number[] = [];
    for (let index = 0; index < starts.length; index += 1) {
      orderedStarts.push(
        index === 0
          ? Math.max(0, starts[index]!)
          : Math.max(orderedStarts[index - 1]! + 1, starts[index]!),
      );
    }

    return cues.map((cue, index) => ({
      ...cue,
      startMs: orderedStarts[index]!,
      endMs: options.preserveCueEnds
        ? Math.max(orderedStarts[index]! + 1, cue.endMs)
        : orderedStarts[index + 1] === undefined
          ? Math.max(orderedStarts[index]! + 1, cue.endMs)
          : orderedStarts[index + 1]!,
    }));
  } catch {
    return cues.map((cue) => ({ ...cue }));
  }
}

export function hasAbruptWavEnding(
  audio: Uint8Array,
  options: {
    tailMs?: number;
    minRms?: number;
    minRatio?: number;
    minimumDurationMs?: number;
  } = {},
): boolean {
  const tailMs = options.tailMs ?? 120;
  const minRms = options.minRms ?? 1_200;
  const minRatio = options.minRatio ?? 0.2;
  const minimumDurationMs = options.minimumDurationMs ?? 300;
  const durationMs = wavDurationMs(audio);
  if (!durationMs || durationMs < minimumDurationMs) return false;
  const tailRms = pcmWavTailRms(audio, tailMs);
  const overallRms = pcmWavOverallRms(audio);
  if (tailRms === undefined || overallRms === undefined || overallRms <= 0) {
    return false;
  }
  return tailRms >= minRms && tailRms / overallRms >= minRatio;
}

/**
 * Mutes a noisy/pre-roll head without changing the WAV duration or any cue
 * timestamps. A short fade-in keeps the first spoken sample click-free.
 */
export function mutePcmWavBeforeMs(
  audio: Uint8Array,
  endMs: number,
  fadeMs = 12,
): Uint8Array {
  if (endMs <= 0) return audio;
  try {
    const parsed = parsePcmWav(audio);
    if (parsed.bitsPerSample !== 16) return audio;
    const totalFrames = Math.floor(parsed.data.byteLength / parsed.blockAlign);
    const endFrame = Math.min(
      totalFrames,
      Math.max(0, Math.round((parsed.sampleRate * endMs) / 1_000)),
    );
    if (endFrame <= 0) return audio;
    const output = new Uint8Array(audio);
    const dataOffset = audio.byteLength - parsed.data.byteLength;
    const view = new DataView(
      output.buffer,
      output.byteOffset,
      output.byteLength,
    );
    for (let frame = 0; frame < endFrame; frame += 1) {
      const offset = dataOffset + frame * parsed.blockAlign;
      for (let channel = 0; channel < parsed.channels; channel += 1) {
        view.setInt16(offset + channel * 2, 0, true);
      }
    }
    const fadeFrames = Math.min(
      Math.max(0, Math.round((parsed.sampleRate * fadeMs) / 1_000)),
      totalFrames - endFrame,
    );
    for (let frame = 0; frame < fadeFrames; frame += 1) {
      const gain = fadeFrames <= 1 ? 1 : frame / (fadeFrames - 1);
      const offset = dataOffset + (endFrame + frame) * parsed.blockAlign;
      for (let channel = 0; channel < parsed.channels; channel += 1) {
        const sampleOffset = offset + channel * 2;
        view.setInt16(
          sampleOffset,
          Math.round(view.getInt16(sampleOffset, true) * gain),
          true,
        );
      }
    }
    return output;
  } catch {
    return audio;
  }
}

export function fadeOutPcmWav(audio: Uint8Array, fadeMs: number): Uint8Array {
  if (fadeMs <= 0) return audio;
  try {
    const parsed = parsePcmWav(audio);
    if (parsed.bitsPerSample !== 16) return audio;
    const sampleFrames = Math.min(
      Math.max(1, Math.round((parsed.sampleRate * fadeMs) / 1_000)),
      Math.floor(parsed.data.byteLength / parsed.blockAlign),
    );
    const output = new Uint8Array(audio);
    const view = new DataView(
      output.buffer,
      output.byteOffset,
      output.byteLength,
    );
    const dataOffset = audio.byteLength - parsed.data.byteLength;
    const startFrame =
      Math.floor(parsed.data.byteLength / parsed.blockAlign) - sampleFrames;
    for (let frame = 0; frame < sampleFrames; frame += 1) {
      const gain = sampleFrames === 1 ? 0 : 1 - frame / (sampleFrames - 1);
      const byteOffset = dataOffset + (startFrame + frame) * parsed.blockAlign;
      for (let channel = 0; channel < parsed.channels; channel += 1) {
        const sampleOffset = byteOffset + channel * 2;
        const sample = view.getInt16(sampleOffset, true);
        view.setInt16(sampleOffset, Math.round(sample * gain), true);
      }
    }
    return output;
  } catch {
    return audio;
  }
}

export function fadeInPcmWav(audio: Uint8Array, fadeMs: number): Uint8Array {
  if (fadeMs <= 0) return audio;
  try {
    const parsed = parsePcmWav(audio);
    if (parsed.bitsPerSample !== 16) return audio;
    const sampleFrames = Math.min(
      Math.max(1, Math.round((parsed.sampleRate * fadeMs) / 1_000)),
      Math.floor(parsed.data.byteLength / parsed.blockAlign),
    );
    const output = new Uint8Array(audio);
    const view = new DataView(
      output.buffer,
      output.byteOffset,
      output.byteLength,
    );
    const dataOffset = audio.byteLength - parsed.data.byteLength;
    for (let frame = 0; frame < sampleFrames; frame += 1) {
      const gain = sampleFrames === 1 ? 1 : frame / (sampleFrames - 1);
      const byteOffset = dataOffset + frame * parsed.blockAlign;
      for (let channel = 0; channel < parsed.channels; channel += 1) {
        const sampleOffset = byteOffset + channel * 2;
        const sample = view.getInt16(sampleOffset, true);
        view.setInt16(sampleOffset, Math.round(sample * gain), true);
      }
    }
    return output;
  } catch {
    return audio;
  }
}

/** Smooths only boundaries that end in active audio, without changing duration. */
export function repairAbruptWavBoundaries(
  audioParts: readonly Uint8Array[],
  fadeMs = 12,
): Uint8Array[] {
  const safeFadeMs = Math.max(0, Math.round(fadeMs));
  return audioParts.map((audio, index) => {
    let repaired = audio;
    if (index < audioParts.length - 1 && hasAbruptWavEnding(audio)) {
      repaired = fadeOutPcmWav(repaired, safeFadeMs);
    }
    if (index > 0 && hasAbruptWavEnding(audioParts[index - 1]!)) {
      repaired = fadeInPcmWav(repaired, safeFadeMs);
    }
    return repaired;
  });
}
