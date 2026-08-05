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

export function splitSubtitleText(text: string, maxCharacters = 12): string[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 4) {
    throw new Error("SUBTITLE_MAX_CHARACTERS_INVALID");
  }
  return splitTextAtPunctuation(text)
    .map((chunk) => stripSubtitlePunctuation(chunk))
    .filter(Boolean);
}

export function alignTextToDuration(
  text: string,
  durationMs: number,
  maxCharacters = 12,
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
