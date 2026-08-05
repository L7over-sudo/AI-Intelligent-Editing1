import {
  splitTextAtPunctuation,
  stripSubtitlePunctuation,
  type SubtitleCueInput,
} from "./subtitles";

export interface SpeechSegment {
  text: string;
  pauseAfterMs: number;
}

const punctuationBoundaryPattern =
  /[\uFF0C,\u3002.!\uFF01\uFF1F?\uFF1B;\uFF1A:\u3001\u2026]/u;
const closingMarkPattern =
  /[\u201D\u2019"'\uFF09)\]\u3011\u300B\u3009]/u;

function pauseForBoundary(text: string, endedByLineBreak: boolean): number {
  if (endedByLineBreak) return 260;
  if (/[\u3002.!\uFF01\uFF1F?\u2026]/u.test(text)) return 220;
  if (/[\uFF1B;]/u.test(text)) return 160;
  if (/[\uFF1A:]/u.test(text)) return 120;
  if (/[\uFF0C,\u3001]/u.test(text)) return 80;
  return 0;
}

export function splitNarrationForSpeech(text: string): SpeechSegment[] {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return [];

  const characters = Array.from(normalized);
  const result: SpeechSegment[] = [];
  let buffer = "";
  const flush = (endedByLineBreak = false) => {
    const chunk = buffer.trim();
    if (chunk) {
      result.push({
        text: chunk,
        pauseAfterMs: pauseForBoundary(chunk, endedByLineBreak),
      });
    }
    buffer = "";
  };

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (character === "\n") {
      flush(true);
      continue;
    }

    buffer += character;
    if (!punctuationBoundaryPattern.test(character)) continue;

    while (
      index + 1 < characters.length &&
      (punctuationBoundaryPattern.test(characters[index + 1]!) ||
        closingMarkPattern.test(characters[index + 1]!))
    ) {
      index += 1;
      buffer += characters[index]!;
    }
    flush();
  }
  flush();
  return result;
}

export function alignTextToSpeechPauses(
  text: string,
  durationMs: number,
): SubtitleCueInput[] {
  if (durationMs <= 0) throw new Error("SUBTITLE_DURATION_INVALID");
  const speechSegments = splitNarrationForSpeech(text);
  if (speechSegments.length === 0) return [];

  const cueTexts = splitTextAtPunctuation(text)
    .map((chunk) => stripSubtitlePunctuation(chunk))
    .filter(Boolean);
  if (cueTexts.length === 0) return [];

  const desiredPauses = speechSegments.map((segment, index) =>
    index === speechSegments.length - 1 ? 0 : segment.pauseAfterMs,
  );
  const desiredPauseMs = desiredPauses.reduce(
    (sum, pause) => sum + pause,
    0,
  );
  const minimumSpeechMs = cueTexts.length * 200;
  const pauseScale =
    desiredPauseMs > 0
      ? Math.min(1, Math.max(0, durationMs - minimumSpeechMs) / desiredPauseMs)
      : 0;
  const pauses = desiredPauses.map((pause) =>
    Math.round(pause * pauseScale),
  );
  const speechDurationMs = Math.max(
    cueTexts.length,
    durationMs - pauses.reduce((sum, pause) => sum + pause, 0),
  );
  const weights = cueTexts.map((value) => Math.max(1, Array.from(value).length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;

  return cueTexts.map((cueText, index) => {
    const isLast = index === cueTexts.length - 1;
    const pause = pauses[index] ?? 0;
    const segmentDuration = isLast
      ? Math.max(1, durationMs - cursor - pause)
      : Math.max(
          1,
          Math.round((speechDurationMs * (weights[index] ?? 1)) / totalWeight),
        );
    const startMs = Math.round(cursor);
    const endMs = Math.min(durationMs, startMs + segmentDuration);
    cursor = endMs + pause;
    return { startMs, endMs, text: cueText };
  });
}
