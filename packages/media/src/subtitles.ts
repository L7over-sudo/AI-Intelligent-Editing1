export interface SubtitleCueInput {
  startMs: number;
  endMs: number;
  text: string;
  translation?: string;
  highlighted?: string[];
}

export interface AssStyle {
  fontName: string;
  fontSize: number;
  primaryColor: string;
  accentColor: string;
  outline: boolean;
  shadow: boolean;
  position: "TOP" | "CENTER" | "BOTTOM";
  bilingual: boolean;
  fontWeight?: number;
  italic?: boolean;
  backgroundColor?: string | null;
  outlineColor?: string;
  outlineWidth?: number;
  shadowColor?: string;
}

const pad = (value: number, width: number) =>
  Math.floor(value).toString().padStart(width, "0");

export function formatSrtTime(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

export function formatAssTime(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds / 10) * 10);
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const centiseconds = Math.floor((safe % 1_000) / 10);
  return `${hours}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(centiseconds, 2)}`;
}

export function cuesToSrt(cues: readonly SubtitleCueInput[]): string {
  return cues
    .map((cue, index) => {
      const text = cue.translation
        ? `${cue.text}\n${cue.translation}`
        : cue.text;
      return [
        index + 1,
        `${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}`,
        text,
        "",
      ].join("\n");
    })
    .join("\n");
}

function rgbToAss(color: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) throw new Error("ASS_COLOR_INVALID");
  return `&H00${match[3]}${match[2]}${match[1]}`.toUpperCase();
}

function escapeAss(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("\n", "\\N");
}

function applyHighlight(
  text: string,
  highlighted: readonly string[],
  accentColor: string,
  primaryColor: string,
): string {
  let result = escapeAss(text);
  const accent = rgbToAss(accentColor);
  const primary = rgbToAss(primaryColor);
  for (const word of [...highlighted].sort((a, b) => b.length - a.length)) {
    if (!word) continue;
    result = result.replaceAll(
      escapeAss(word),
      `{\\c${accent}}${escapeAss(word)}{\\c${primary}}`,
    );
  }
  return result;
}

export function cuesToAss(
  cues: readonly SubtitleCueInput[],
  style: AssStyle,
  resolution: { width: number; height: number },
): string {
  const alignment =
    style.position === "TOP" ? 8 : style.position === "CENTER" ? 5 : 2;
  const marginV =
    style.position === "CENTER" ? 0 : Math.round(resolution.height * 0.07);
  const primary = rgbToAss(style.primaryColor);
  const outlineColor = rgbToAss(style.outlineColor ?? "#171717");
  const backgroundColor = rgbToAss(
    style.backgroundColor ?? style.shadowColor ?? "#000000",
  );
  const outline = style.outline ? (style.outlineWidth ?? 4) : 0;
  const shadow = style.shadow ? 2 : 0;
  const bold = (style.fontWeight ?? 800) >= 700 ? -1 : 0;
  const italic = style.italic ? -1 : 0;
  const borderStyle = style.backgroundColor ? 3 : 1;
  const events = cues.map((cue) => {
    const main = applyHighlight(
      cue.text,
      cue.highlighted ?? [],
      style.accentColor,
      style.primaryColor,
    );
    const text =
      style.bilingual && cue.translation
        ? `${main}\\N{\\fs${Math.round(style.fontSize * 0.64)}}${escapeAss(cue.translation)}`
        : main;
    return `Dialogue: 0,${formatAssTime(cue.startMs)},${formatAssTime(cue.endMs)},Default,,0,0,0,,${text}`;
  });

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    `PlayResX: ${resolution.width}`,
    `PlayResY: ${resolution.height}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${style.fontName},${style.fontSize},${primary},${primary},${outlineColor},${backgroundColor},${bold},${italic},0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},60,60,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

export function stripSubtitlePunctuation(text: string): string {
  return text
    .replace(/[\p{P}]+/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

const punctuationBoundaryPattern = /[，,。.!！？?；;：:、…]/u;
const closingMarkPattern = /[”’"'）)\]】》〉]/u;

export function splitTextAtPunctuation(text: string): string[] {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return [];

  const characters = Array.from(normalized);
  const result: string[] = [];
  let buffer = "";
  const flush = () => {
    const chunk = buffer.trim();
    if (chunk) result.push(chunk);
    buffer = "";
  };

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (character === "\n") {
      flush();
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

export function splitSubtitleText(
  text: string,
  maxCharacters: number | null = 12,
): string[] {
  if (
    maxCharacters !== null &&
    (!Number.isInteger(maxCharacters) || maxCharacters < 4)
  ) {
    throw new Error("SUBTITLE_MAX_CHARACTERS_INVALID");
  }
  const characterLimit = maxCharacters;

  const splitLongClause = (clause: string): string[] => {
    if (characterLimit === null) return [clause];
    const segmentedWords = Array.from(
      new Intl.Segmenter("zh-CN", { granularity: "word" }).segment(clause),
      ({ segment }) => segment,
    );
    const suffixes = new Set(["了", "着", "过"]);
    const leadingBreaks = new Set([
      "但",
      "但是",
      "不过",
      "却",
      "然而",
      "而",
      "而且",
      "并且",
      "所以",
      "因此",
      "如果",
      "虽然",
      "同时",
      "另外",
      "此外",
    ]);
    const words: string[] = [];
    for (const word of segmentedWords) {
      if (suffixes.has(word) && words.length > 0) {
        words[words.length - 1] += word;
      } else {
        words.push(word);
      }
    }
    const cues: string[] = [];
    let cue = "";

    const flush = () => {
      if (cue) cues.push(cue);
      cue = "";
    };

    for (const word of words) {
      const wordCharacters = Array.from(word);
      if (
        leadingBreaks.has(word) &&
        Array.from(cue).length >= Math.ceil(characterLimit / 2)
      ) {
        flush();
      }
      if (wordCharacters.length > characterLimit) {
        flush();
        for (
          let index = 0;
          index < wordCharacters.length;
          index += characterLimit
        ) {
          cues.push(
            wordCharacters.slice(index, index + characterLimit).join(""),
          );
        }
        continue;
      }
      if (Array.from(cue).length + wordCharacters.length > characterLimit) {
        flush();
      }
      cue += word;
    }
    flush();
    return cues;
  };

  const chunks = splitTextAtPunctuation(text)
    .map((chunk) => stripSubtitlePunctuation(chunk))
    .filter(Boolean)
    .flatMap(splitLongClause);

  const minimumCharacters = Math.min(4, characterLimit ?? 4);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    if (Array.from(chunk).length >= minimumCharacters) continue;

    const previous = chunks[index - 1];
    if (
      previous &&
      (characterLimit === null ||
        Array.from(previous).length + Array.from(chunk).length <= characterLimit)
    ) {
      chunks.splice(index - 1, 2, previous + chunk);
      index = Math.max(-1, index - 2);
      continue;
    }

    const next = chunks[index + 1];
    if (
      next &&
      (characterLimit === null ||
        Array.from(chunk).length + Array.from(next).length <= characterLimit)
    ) {
      chunks.splice(index, 2, chunk + next);
      index -= 1;
      continue;
    }

    if (characterLimit === null) continue;

    if (
      next &&
      Array.from(chunk + next).length >= minimumCharacters * 2
    ) {
      const combined = Array.from(chunk + next);
      const splitAt = Math.max(
        minimumCharacters,
        combined.length - characterLimit,
        Math.min(
          characterLimit,
          combined.length - minimumCharacters,
          Math.ceil(combined.length / 2),
        ),
      );
      chunks.splice(
        index,
        2,
        combined.slice(0, splitAt).join(""),
        combined.slice(splitAt).join(""),
      );
      index -= 1;
      continue;
    }

    if (
      previous &&
      Array.from(previous + chunk).length >= minimumCharacters * 2
    ) {
      const combined = Array.from(previous + chunk);
      const splitAt = Math.max(
        minimumCharacters,
        combined.length - characterLimit,
        Math.min(
          characterLimit,
          combined.length - minimumCharacters,
          Math.ceil(combined.length / 2),
        ),
      );
      chunks.splice(
        index - 1,
        2,
        combined.slice(0, splitAt).join(""),
        combined.slice(splitAt).join(""),
      );
      index = Math.max(-1, index - 2);
    }
  }

  return chunks;
}

export function alignTextToDuration(
  text: string,
  durationMs: number,
  maxCharacters: number | null = 12,
): SubtitleCueInput[] {
  if (durationMs <= 0) throw new Error("SUBTITLE_DURATION_INVALID");
  const chunks = splitSubtitleText(text, maxCharacters);
  if (chunks.length === 0) return [];
  const weight = chunks.reduce((sum, chunk) => sum + [...chunk].length, 0);
  let cursor = 0;

  return chunks.map((chunk, index) => {
    const isLast = index === chunks.length - 1;
    const share = weight > 0 ? [...chunk].length / weight : 1 / chunks.length;
    const endMs = isLast ? durationMs : Math.round(cursor + durationMs * share);
    const cue = { startMs: cursor, endMs, text: chunk };
    cursor = endMs;
    return cue;
  });
}

/**
 * Extends the final cue of a cue list so it stays on screen until the end of
 * the spoken audio. TTS word timestamps usually stop at the last pronounced
 * character while the audio file still carries trailing breath/tail sound, so
 * without this the subtitle disappears a few hundred milliseconds before the
 * narration actually finishes. Earlier cues are left untouched and existing
 * end times are never shortened.
 */
export function extendFinalCueToDuration(
  cues: readonly SubtitleCueInput[],
  durationMs: number,
): SubtitleCueInput[] {
  if (cues.length === 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
    return cues.map((cue) => ({ ...cue }));
  }
  const lastIndex = cues.length - 1;
  return cues.map((cue, index) =>
    index === lastIndex
      ? { ...cue, endMs: Math.max(cue.endMs, durationMs) }
      : { ...cue },
  );
}

/**
 * Keeps provider-timed subtitles visible through the final syllable. Word
 * timestamps can end slightly before the audible tail; extensions are capped
 * by the next cue so two subtitle cards never overlap.
 */
export function extendCueTails(
  cues: readonly SubtitleCueInput[],
  durationMs: number,
): SubtitleCueInput[] {
  const safeDurationMs = Math.max(1, Math.round(durationMs));
  return cues.map((cue, index) => {
    const nextCue = cues[index + 1];
    const protectedEndMs = nextCue
      ? Math.min(safeDurationMs, nextCue.startMs)
      : safeDurationMs;
    return {
      ...cue,
      endMs: Math.max(cue.endMs, protectedEndMs),
    };
  });
}

/**
 * Shows each following subtitle card a little before its measured speech
 * boundary. TTS timestamps commonly land on the consonant onset, while video
 * frames and subtitle rendering are quantized; that can make the voice feel
 * one beat ahead of the text. The first card remains at zero and every prior
 * card ends exactly when the anticipated card starts, so there are no gaps or
 * overlaps.
 */
export function anticipateSubtitleCueStarts(
  cues: readonly SubtitleCueInput[],
  durationMs: number,
  leadMs = 420,
): SubtitleCueInput[] {
  if (cues.length === 0) return [];
  const safeDurationMs = Math.max(1, Math.round(durationMs));
  const safeLeadMs = Math.max(0, Math.round(leadMs));
  const starts = cues.map((cue, index) => {
    if (index === 0) return 0;
    const previousStartMs = Math.max(0, Math.round(cues[index - 1]!.startMs));
    const originalStartMs = Math.max(previousStartMs + 1, Math.round(cue.startMs));
    // Very short cards must not be replaced almost immediately. Longer cards
    // can use the full safety lead so the next text is visibly ready before
    // the first consonant is heard.
    const adaptiveLeadMs = Math.min(
      safeLeadMs,
      Math.max(220, Math.round((originalStartMs - previousStartMs) * 0.4)),
    );
    return Math.max(
      (cues[index - 1]?.startMs ?? 0) + 1,
      Math.min(safeDurationMs - 1, originalStartMs - adaptiveLeadMs),
    );
  });

  return cues.map((cue, index) => ({
    ...cue,
    startMs: starts[index]!,
    endMs:
      starts[index + 1] ??
      Math.max(starts[index]! + 1, safeDurationMs, Math.round(cue.endMs)),
  }));
}
