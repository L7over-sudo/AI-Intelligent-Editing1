import {
  extendFinalCueToDuration,
  type SubtitleCueInput,
} from "@stickmotion/media";

/**
 * Keeps the provider/PCM-aligned cue boundaries intact for rendering.
 * Those boundaries were already synchronized while generating the voice;
 * applying an additional visual lead here makes every later card appear early.
 */
export function prepareStoredSubtitleCues(
  cues: readonly SubtitleCueInput[],
  durationMs: number,
): SubtitleCueInput[] {
  return extendFinalCueToDuration(cues, durationMs);
}

const comparableText = (value: string) =>
  value.normalize("NFKC").replace(/[\p{P}\p{Z}\s]+/gu, "");

export function reconcileSubtitleCueTimings(
  primary: readonly SubtitleCueInput[],
  secondary: readonly SubtitleCueInput[] | undefined,
  outputDelayMs: number,
): SubtitleCueInput[] {
  const delayMs = Math.max(0, Math.round(outputDelayMs));
  return primary.map((cue, index) => {
    const candidate = secondary?.[index];
    const matchingCandidate =
      candidate && comparableText(candidate.text) === comparableText(cue.text)
        ? candidate
        : undefined;
    return {
      ...cue,
      startMs:
        Math.max(cue.startMs, matchingCandidate?.startMs ?? cue.startMs) +
        delayMs,
      endMs:
        Math.max(cue.endMs, matchingCandidate?.endMs ?? cue.endMs) + delayMs,
    };
  });
}
