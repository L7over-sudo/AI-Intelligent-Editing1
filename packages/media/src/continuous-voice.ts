import type { SubtitleCueInput } from "./subtitles";

export interface ContinuousNarrationPart {
  startMs: number;
  endMs: number;
  cues: SubtitleCueInput[];
}

export function leadingSilenceToTrim(
  cueStartMs: number,
  availableMs: number,
  retainedMs = 80,
): number {
  const safeCueStart = Math.max(0, Math.min(cueStartMs, availableMs));
  return Math.max(0, safeCueStart - Math.max(0, retainedMs));
}

function comparableText(value: string): string {
  return value.replace(/[\p{P}\p{Z}\s]+/gu, "").trim();
}

function sourceSceneEndChars(
  sourceText: string,
  sceneTexts: readonly string[],
): number[] {
  const normalizedSource = comparableText(sourceText);
  const sceneEndChars: number[] = [];
  let sourceIndex = 0;

  for (const sceneText of sceneTexts) {
    const expected = comparableText(sceneText);
    if (!expected) continue;
    const start = normalizedSource.indexOf(expected, sourceIndex);
    if (start < 0) {
      throw new Error(
        "SCENE_TEXT_NOT_FOUND_IN_SOURCE_TEXT:" + sceneText.slice(0, 60),
      );
    }
    const end = start + expected.length;
    sceneEndChars.push(end);
    sourceIndex = end;
  }
  return sceneEndChars;
}

function rawOffsetForComparableLength(
  value: string,
  targetLength: number,
): number {
  if (targetLength <= 0) return 0;
  let comparableLength = 0;
  let rawOffset = 0;
  for (const character of value) {
    rawOffset += character.length;
    comparableLength += comparableText(character).length;
    if (comparableLength >= targetLength) {
      // Keep punctuation and whitespace attached to the preceding fragment.
      for (const trailingCharacter of value.slice(rawOffset)) {
        if (comparableText(trailingCharacter)) break;
        rawOffset += trailingCharacter.length;
      }
      return rawOffset;
    }
  }
  return value.length;
}

function splitCueAtComparableOffsets(
  cue: SubtitleCueInput,
  offsets: readonly number[],
): SubtitleCueInput[] {
  const normalizedLength = comparableText(cue.text).length;
  const splitOffsets = [...new Set(offsets)]
    .filter((offset) => offset > 0 && offset < normalizedLength)
    .sort((left, right) => left - right);
  if (splitOffsets.length === 0 || normalizedLength === 0) {
    return [{ ...cue }];
  }

  const rawOffsets = splitOffsets.map((offset) =>
    rawOffsetForComparableLength(cue.text, offset),
  );
  const rawBoundaries = [0, ...rawOffsets, cue.text.length];
  const safeStartMs = Math.round(cue.startMs);
  const safeEndMs = Math.max(
    safeStartMs + rawBoundaries.length - 1,
    Math.round(cue.endMs),
  );
  const durationMs = safeEndMs - safeStartMs;

  return rawBoundaries.slice(0, -1).map((rawStart, index) => {
    const rawEnd = rawBoundaries[index + 1]!;
    const startMs =
      index === 0
        ? safeStartMs
        : Math.round(
            safeStartMs +
              (durationMs * splitOffsets[index - 1]!) / normalizedLength,
          );
    const endMs =
      index === rawBoundaries.length - 2
        ? safeEndMs
        : Math.round(
            safeStartMs +
              (durationMs * splitOffsets[index]!) / normalizedLength,
          );
    const text = cue.text.slice(rawStart, rawEnd);
    const highlighted = cue.highlighted?.filter((word) =>
      comparableText(text).includes(comparableText(word)),
    );
    const splitCue: SubtitleCueInput = {
      ...cue,
      text,
      startMs,
      endMs: Math.max(startMs + 1, endMs),
    };
    if (cue.highlighted) splitCue.highlighted = highlighted ?? [];
    return splitCue;
  });
}

function splitCuesAtSceneBoundaries(
  sourceText: string,
  sceneTexts: readonly string[],
  cues: readonly SubtitleCueInput[],
): SubtitleCueInput[] {
  const sceneEndChars = sourceSceneEndChars(sourceText, sceneTexts);
  const splitCues: SubtitleCueInput[] = [];
  let cueStartChar = 0;
  let nextBoundaryIndex = 0;

  for (const cue of cues) {
    const cueLength = comparableText(cue.text).length;
    const cueEndChar = cueStartChar + cueLength;
    const localOffsets: number[] = [];
    while (
      nextBoundaryIndex < sceneEndChars.length &&
      sceneEndChars[nextBoundaryIndex]! > cueStartChar &&
      sceneEndChars[nextBoundaryIndex]! < cueEndChar
    ) {
      localOffsets.push(sceneEndChars[nextBoundaryIndex]! - cueStartChar);
      nextBoundaryIndex += 1;
    }
    splitCues.push(...splitCueAtComparableOffsets(cue, localOffsets));
    cueStartChar = cueEndChar;
    while (
      nextBoundaryIndex < sceneEndChars.length &&
      sceneEndChars[nextBoundaryIndex]! <= cueStartChar
    ) {
      nextBoundaryIndex += 1;
    }
  }

  return splitCues;
}

export function sourceCueRanges(
  sourceText: string,
  sceneTexts: readonly string[],
  cues: readonly SubtitleCueInput[],
): Array<{ start: number; end: number }> {
  const normalizedCues = cues.map((cue) => comparableText(cue.text));
  const sceneEndChars = sourceSceneEndChars(sourceText, sceneTexts);

  const ranges: Array<{ start: number; end: number }> = [];
  let cueIndex = 0;
  let cueChars = 0;
  for (const endChar of sceneEndChars) {
    const start = cueIndex;
    while (cueIndex < normalizedCues.length && cueChars < endChar) {
      cueChars += normalizedCues[cueIndex]!.length;
      cueIndex += 1;
    }
    if (cueChars !== endChar) {
      throw new Error("VOICE_CUE_SCENE_BOUNDARY_MISMATCH");
    }
    ranges.push({ start, end: cueIndex });
  }
  return ranges;
}

function cueRangesForScenes(
  sceneTexts: readonly string[],
  cues: readonly SubtitleCueInput[],
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let cueIndex = 0;

  for (const sceneText of sceneTexts) {
    const expected = comparableText(sceneText);
    const start = cueIndex;
    let collected = "";
    while (cueIndex < cues.length && collected.length < expected.length) {
      collected += comparableText(cues[cueIndex]!.text);
      cueIndex += 1;
      if (collected === expected) break;
    }
    ranges.push({ start, end: cueIndex });
  }

  if (cueIndex < cues.length && ranges.length > 0) {
    ranges[ranges.length - 1]!.end = cues.length;
  }
  return ranges;
}

export function partitionContinuousNarration(input: {
  durationMs: number;
  sceneTexts: readonly string[];
  cues: readonly SubtitleCueInput[];
  sourceText?: string;
  retainedLeadingMs?: number;
}): ContinuousNarrationPart[] {
  const durationMs = Math.max(1, Math.round(input.durationMs));
  if (input.sceneTexts.length === 0) return [];

  const cues =
    input.sourceText !== undefined
      ? splitCuesAtSceneBoundaries(
          input.sourceText,
          input.sceneTexts,
          input.cues,
        )
      : input.cues;
  const ranges =
    input.sourceText !== undefined
      ? sourceCueRanges(input.sourceText, input.sceneTexts, cues)
      : cueRangesForScenes(input.sceneTexts, cues);
  const lastCuedIndex = ranges.reduce(
    (last, range, index) => (range.end > range.start ? index : last),
    -1,
  );
  const boundaries = [0];
  for (let index = 0; index < ranges.length - 1; index += 1) {
    const currentRange = ranges[index]!;
    const nextRange = ranges[index + 1]!;
    const currentCue = cues[currentRange.end - 1];
    const nextCue = cues[nextRange.start];
    const fallback = Math.round(
      (durationMs * (index + 1)) / input.sceneTexts.length,
    );
    let boundary: number;
    if (currentCue && nextCue) {
      // When cues have been snapped to an acoustic onset, keep a short piece
      // of the preceding quiet region with the next scene. This prevents a
      // split from landing on the first consonant of the next phrase. Never
      // move the boundary into the current cue, though: a short inter-cue gap
      // must not be paid for by cutting off the previous word's tail.
      boundary = Math.round(
        Math.max(
          currentCue.endMs,
          nextCue.startMs - Math.max(0, input.retainedLeadingMs ?? 0),
        ),
      );
    } else if (index >= lastCuedIndex && lastCuedIndex >= 0) {
      const base = boundaries[lastCuedIndex] ?? 0;
      const tailScenes = input.sceneTexts.length - lastCuedIndex - 1;
      boundary =
        base +
        Math.round(
          ((durationMs - base) * (index - lastCuedIndex + 1)) /
            (tailScenes + 1),
        );
    } else {
      boundary = fallback;
    }
    boundaries.push(
      Math.max(boundaries[index]! + 1, Math.min(durationMs - 1, boundary)),
    );
  }
  boundaries.push(durationMs);

  return ranges.map((range, index) => {
    const startMs = boundaries[index]!;
    const endMs = boundaries[index + 1]!;
    return {
      startMs,
      endMs,
      cues: cues.slice(range.start, range.end).map((cue) => ({
        ...cue,
        startMs: Math.max(0, cue.startMs - startMs),
        endMs: Math.max(
          Math.max(0, cue.startMs - startMs) + 1,
          Math.min(endMs - startMs, Math.max(1, cue.endMs - startMs)),
        ),
      })),
    };
  });
}
