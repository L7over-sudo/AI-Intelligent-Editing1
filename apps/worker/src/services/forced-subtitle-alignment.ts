import { splitSubtitleText, type SubtitleCueInput } from "@stickmotion/media";

export interface RecognizedWord {
  start: number;
  end: number;
  word: string;
  probability: number;
}

interface TimedCharacter {
  character: string;
  startMs: number;
  endMs: number;
}

const charactersOf = (value: string) =>
  Array.from(value.normalize("NFKC").replace(/[\p{P}\p{Z}\s]+/gu, ""));

export function forceAlignSubtitleCues(
  sourceText: string,
  words: readonly RecognizedWord[],
  sceneTexts?: readonly string[],
  maximumErrorRate = 0.08,
): SubtitleCueInput[] {
  const source = charactersOf(sourceText);
  const recognized: TimedCharacter[] = words.flatMap((word) => {
    const characters = charactersOf(word.word);
    return characters.map((character, index) => ({
      character,
      startMs: Math.round(
        (word.start + ((word.end - word.start) * index) / characters.length) *
          1_000,
      ),
      endMs: Math.round(
        (word.start +
          ((word.end - word.start) * (index + 1)) / characters.length) *
          1_000,
      ),
    }));
  });
  if (source.length === 0 || recognized.length === 0) {
    throw new Error("WHISPER_ALIGNMENT_TEXT_REQUIRED");
  }

  const rows = Array.from(
    { length: source.length + 1 },
    () => new Uint16Array(recognized.length + 1),
  );
  for (let index = 0; index <= source.length; index += 1) rows[index]![0] = index;
  for (let index = 0; index <= recognized.length; index += 1)
    rows[0]![index] = index;
  for (let left = 1; left <= source.length; left += 1) {
    for (let right = 1; right <= recognized.length; right += 1) {
      rows[left]![right] = Math.min(
        rows[left - 1]![right]! + 1,
        rows[left]![right - 1]! + 1,
        rows[left - 1]![right - 1]! +
          (source[left - 1] === recognized[right - 1]!.character ? 0 : 1),
      );
    }
  }

  const mapping = new Map<number, number>();
  let left = source.length;
  let right = recognized.length;
  let exactMatches = 0;
  while (left > 0 || right > 0) {
    const substitutionCost =
      left > 0 && right > 0
        ? source[left - 1] === recognized[right - 1]!.character
          ? 0
          : 1
        : 1;
    if (
      left > 0 &&
      right > 0 &&
      rows[left]![right] === rows[left - 1]![right - 1]! + substitutionCost
    ) {
      mapping.set(left - 1, right - 1);
      if (substitutionCost === 0) exactMatches += 1;
      left -= 1;
      right -= 1;
    } else if (
      left > 0 &&
      rows[left]![right] === rows[left - 1]![right]! + 1
    ) {
      left -= 1;
    } else {
      right -= 1;
    }
  }
  const editDistance = rows[source.length]![recognized.length]!;
  const comparedLength = Math.max(source.length, recognized.length);
  if (
    exactMatches / source.length < 1 - maximumErrorRate ||
    editDistance / comparedLength > maximumErrorRate
  ) {
    throw new Error(
      `WHISPER_ALIGNMENT_COVERAGE_LOW:${exactMatches}/${source.length}:` +
        `${editDistance}/${comparedLength}`,
    );
  }

  const mappedAt = (sourceIndex: number): TimedCharacter => {
    for (let distance = 0; distance < 12; distance += 1) {
      for (const candidate of [sourceIndex + distance, sourceIndex - distance]) {
        const recognizedIndex = mapping.get(candidate);
        if (recognizedIndex !== undefined) return recognized[recognizedIndex]!;
      }
    }
    throw new Error("WHISPER_ALIGNMENT_BOUNDARY_MISSING");
  };

  const cueTexts = (sceneTexts ?? [sourceText]).flatMap((text) =>
    splitSubtitleText(text, null),
  );
  const cueCharacters = cueTexts.flatMap((text) => charactersOf(text));
  if (cueCharacters.join("") !== source.join("")) {
    throw new Error("WHISPER_ALIGNMENT_SCENE_TEXT_MISMATCH");
  }

  let cursor = 0;
  return cueTexts.map((text) => {
    const length = charactersOf(text).length;
    const first = mappedAt(cursor);
    const last = mappedAt(cursor + length - 1);
    cursor += length;
    return {
      text,
      startMs: first.startMs,
      endMs: Math.max(first.startMs + 1, last.endMs),
    };
  });
}
