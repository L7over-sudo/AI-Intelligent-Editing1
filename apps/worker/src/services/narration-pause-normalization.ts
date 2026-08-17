import {
  concatenatePcmWav,
  slicePcmWav,
} from "@stickmotion/media";

export interface NarrationStall {
  startMs: number;
  endMs: number;
  trimMs: number;
  targetGapMs: number;
}

interface PcmWavView {
  channels: number;
  sampleRate: number;
  blockAlign: number;
  dataOff: number;
  durationMs: number;
  rmsMs(startMs: number, endMs: number): number;
}

function parsePcmWavView(audio: Uint8Array): PcmWavView {
  const buffer = Buffer.from(audio);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const fmtOff = buffer.indexOf(Buffer.from("fmt ")) + 8;
  const channels = view.getUint16(fmtOff, true);
  const sampleRate = view.getUint32(fmtOff + 4, true);
  const blockAlign = view.getUint16(fmtOff + 12, true);
  const dataOff = buffer.indexOf(Buffer.from("data")) + 8;
  const totalFrames = Math.floor((buffer.length - dataOff) / blockAlign);
  return {
    channels,
    sampleRate,
    blockAlign,
    dataOff,
    durationMs: Math.round((totalFrames / sampleRate) * 1_000),
    rmsMs(startMs: number, endMs: number): number {
      let sum = 0;
      let count = 0;
      const start =
        Math.max(0, Math.round((sampleRate * startMs) / 1_000)) * channels;
      const end =
        Math.min(totalFrames, Math.round((sampleRate * endMs) / 1_000)) *
        channels;
      for (let index = start; index < end; index += channels) {
        const value = view.getInt16(dataOff + index * 2, true);
        sum += value * value;
        count += 1;
      }
      return count > 0 ? Math.sqrt(sum / count) : 0;
    },
  };
}

const sentenceEndPattern = /[。！？!?…]$/u;

export function findNarrationStalls(options: {
  audio: Uint8Array;
  sceneStartsMs: readonly number[];
  sceneEndsMs: readonly number[];
  cueEndsMs: readonly { endMs: number; text: string }[];
  minimumGapMs?: number;
  targetGapMs?: number;
  boundaryMarginMs?: number;
}): NarrationStall[] {
  const minimumGapMs = options.minimumGapMs ?? 280;
  const targetGapMs = options.targetGapMs ?? 200;
  const boundaryMarginMs = options.boundaryMarginMs ?? 250;
  const wav = parsePcmWavView(options.audio);
  const windowMs = 20;
  const gaps: Array<{ startMs: number; endMs: number }> = [];
  let inGap = false;
  let gapStart = 0;
  for (let atMs = 0; atMs <= wav.durationMs; atMs += windowMs) {
    const quiet =
      wav.rmsMs(atMs, Math.min(wav.durationMs, atMs + windowMs)) < 90;
    if (quiet && !inGap) {
      inGap = true;
      gapStart = atMs;
    } else if (!quiet && inGap) {
      inGap = false;
      if (atMs - gapStart >= minimumGapMs) {
        gaps.push({ startMs: gapStart, endMs: atMs });
      }
    }
  }

  const sortedCueEnds = [...options.cueEndsMs].sort(
    (left, right) => left.endMs - right.endMs,
  );
  const stalls: NarrationStall[] = [];
  for (const gap of gaps) {
    const nearBoundary = options.sceneStartsMs.some(
      (start) =>
        Math.abs(start - gap.startMs) < boundaryMarginMs ||
        Math.abs(start - gap.endMs) < boundaryMarginMs,
    );
    if (nearBoundary) continue;
    const previousCue = [...sortedCueEnds]
      .reverse()
      .find((cue) => cue.endMs <= gap.startMs + 40);
    if (previousCue && sentenceEndPattern.test(previousCue.text.trim())) {
      continue;
    }
    const trimMs = gap.endMs - gap.startMs - targetGapMs;
    if (trimMs > 0) {
      stalls.push({
        startMs: gap.startMs,
        endMs: gap.endMs,
        trimMs,
        targetGapMs,
      });
    }
  }
  return stalls;
}

/** Removes the trailing part of each stall so the pause keeps targetGapMs. */
export function trimSilenceRanges(
  audio: Uint8Array,
  stalls: readonly NarrationStall[],
): Uint8Array {
  if (stalls.length === 0) return audio;
  const parts: Array<{ startMs: number; endMs: number }> = [];
  let cursor = 0;
  for (const stall of stalls) {
    if (stall.startMs > cursor) {
      parts.push({ startMs: cursor, endMs: stall.startMs });
    }
    parts.push({
      startMs: stall.startMs,
      endMs: stall.startMs + stall.targetGapMs,
    });
    cursor = stall.endMs;
  }
  parts.push({ startMs: cursor, endMs: Number.MAX_SAFE_INTEGER });
  return concatenatePcmWav(
    parts.map((part) => ({
      audio: slicePcmWav(audio, part.startMs, part.endMs),
      pauseAfterMs: 0,
    })),
  );
}

export function trimmedBeforeMs(
  stalls: readonly NarrationStall[],
  atMs: number,
): number {
  let total = 0;
  for (const stall of stalls) {
    const keptEndMs = stall.startMs + stall.targetGapMs;
    if (atMs > keptEndMs) total += stall.trimMs;
  }
  return total;
}
