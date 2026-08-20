export type ImpactCaptionTone = "RED" | "YELLOW" | "WHITE";

export type TimedImpactCaptionLine = {
  text: string;
  startMs: number;
  sequence: number;
};

const strongImpactPattern =
  /但你知道吗|其实|原来|真相|关键|核心|重点|千万|必须|根本|本质|真正|不是|别再|为什么|怎么会|记住|最重要|天生|结果/iu;
const redWarningPattern = /找不到|不是|别再|千万|错误|危险|失败|错过/iu;

function normalizedCaptionParts(values: readonly string[]): string[] {
  return values
    .map((value) => value.trim().replace(/\s+/gu, ""))
    .filter(Boolean);
}

export function buildImpactCaptionText(values: readonly string[]): string {
  return normalizedCaptionParts(values).join("，");
}

export function splitImpactCaptionLines(
  value: string,
  maxCharacters = 12,
  maxLines = 3,
): string[] {
  if (maxCharacters < 2 || maxLines < 1) return [];
  const maximumLength = maxCharacters * maxLines;
  const normalized = value
    .trim()
    .replace(/\s+/gu, "")
    .replace(/[。.!！?？；;：:]+$/gu, "");
  if (!normalized) return [];

  const characters = Array.from(normalized);
  const clipped =
    characters.length > maximumLength
      ? `${characters.slice(0, maximumLength - 1).join("")}…`
      : normalized;
  const segments = clipped
    .split(/[，,。.!！?？；;：:\n]+/gu)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const lines: string[] = [];
  let pending = "";

  const flush = () => {
    if (!pending || lines.length >= maxLines) return;
    lines.push(pending);
    pending = "";
  };

  for (const segment of segments) {
    let remaining = Array.from(segment);
    while (remaining.length > maxCharacters && lines.length < maxLines) {
      flush();
      lines.push(remaining.slice(0, maxCharacters).join(""));
      remaining = remaining.slice(maxCharacters);
    }
    if (lines.length >= maxLines) break;
    const rest = remaining.join("");
    if (!rest) continue;
    if (Array.from(pending + rest).length <= maxCharacters) {
      pending += rest;
    } else {
      flush();
      pending = rest;
    }
  }
  flush();
  return lines.slice(0, maxLines);
}

export function buildVisibleImpactCaptionLines(
  cues: readonly { startMs: number; text: string }[],
  currentMs: number,
  maxVisibleLines = 4,
): TimedImpactCaptionLine[] {
  if (maxVisibleLines < 1) return [];
  let sequence = 0;
  const timeline = cues.flatMap((cue) =>
    splitImpactCaptionLines(cue.text, 14, 3).map((text, lineIndex) => ({
      text,
      startMs: cue.startMs + lineIndex * 90,
      sequence: sequence++,
    })),
  );
  return timeline
    .filter((line) => line.startMs <= currentMs)
    .slice(-maxVisibleLines);
}

export function impactCaptionTone(
  line: string,
  lineIndex: number,
): ImpactCaptionTone {
  if (
    (lineIndex === 0 && strongImpactPattern.test(line)) ||
    redWarningPattern.test(line)
  ) {
    return "RED";
  }
  if (lineIndex === 0) return "YELLOW";
  return lineIndex % 2 === 0 ? "WHITE" : "YELLOW";
}
