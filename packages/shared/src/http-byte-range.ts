import { z } from "zod";

const byteRangeHeaderSchema = z
  .string()
  .trim()
  .regex(/^bytes=(?:\d+-\d*|-\d+)$/u);

const mediaSizeSchema = z.number().int().nonnegative().safe();

export interface HttpByteRange {
  start: number;
  end: number;
}

export function parseHttpByteRange(
  header: string | null,
  mediaSize: number,
): HttpByteRange | undefined {
  const size = mediaSizeSchema.parse(mediaSize);
  if (header === null) return undefined;

  const parsedHeader = byteRangeHeaderSchema.safeParse(header);
  if (!parsedHeader.success || size === 0) {
    throw new Error("MEDIA_RANGE_NOT_SATISFIABLE");
  }

  const [startText, endText] = parsedHeader.data
    .slice("bytes=".length)
    .split("-");
  if (startText === undefined || endText === undefined) {
    throw new Error("MEDIA_RANGE_NOT_SATISFIABLE");
  }

  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new Error("MEDIA_RANGE_NOT_SATISFIABLE");
    }
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText === "" ? size - 1 : Number(endText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    throw new Error("MEDIA_RANGE_NOT_SATISFIABLE");
  }

  return { start, end: Math.min(requestedEnd, size - 1) };
}
