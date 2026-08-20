import {
  extendFinalCueToDuration,
  type SubtitleCueInput,
} from "@stickmotion/media";

/**
 * Keeps subtitle cards from appearing before the encoded narration becomes
 * perceptibly audible. The stored cue remains the acoustic source of truth;
 * this small delay is applied only to rendered/exported subtitle presentation.
 */
export const subtitlePresentationDelayMs = 160;

/**
 * Delays PCM-aligned cue boundaries slightly for presentation while keeping
 * the final cue visible through the end of the scene.
 */
export function prepareStoredSubtitleCues(
  cues: readonly SubtitleCueInput[],
  durationMs: number,
): SubtitleCueInput[] {
  if (cues.length === 0 || durationMs <= 0) return [];
  const delayed = extendFinalCueToDuration(cues, durationMs).map(
    (cue, index, allCues) => {
      const startMs = Math.min(
        Math.max(0, durationMs - 1),
        Math.max(0, cue.startMs + subtitlePresentationDelayMs),
      );
      const delayedEndMs = cue.endMs + subtitlePresentationDelayMs;
      return {
        ...cue,
        startMs,
        endMs:
          index === allCues.length - 1
            ? durationMs
            : Math.min(
                durationMs,
                Math.max(startMs + 1, delayedEndMs),
              ),
      };
    },
  );
  return delayed;
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
