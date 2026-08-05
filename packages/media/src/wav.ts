interface ParsedPcmWav {
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  data: Uint8Array;
}

export interface WavPart {
  audio: Uint8Array;
  pauseAfterMs: number;
}

const ascii = new TextDecoder("ascii");

function chunkName(audio: Uint8Array, offset: number): string {
  return ascii.decode(audio.subarray(offset, offset + 4));
}

function parsePcmWav(audio: Uint8Array): ParsedPcmWav {
  if (
    audio.byteLength < 44 ||
    chunkName(audio, 0) !== "RIFF" ||
    chunkName(audio, 8) !== "WAVE"
  ) {
    throw new Error("WAV_PCM_REQUIRED");
  }
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  let format: Omit<ParsedPcmWav, "data"> | undefined;
  let data: Uint8Array | undefined;
  let offset = 12;
  while (offset + 8 <= audio.byteLength) {
    const name = chunkName(audio, offset);
    const size = view.getUint32(offset + 4, true);
    const contentOffset = offset + 8;
    if (contentOffset + size > audio.byteLength) {
      throw new Error("WAV_CHUNK_INVALID");
    }
    if (name === "fmt " && size >= 16) {
      const audioFormat = view.getUint16(contentOffset, true);
      if (audioFormat !== 1) throw new Error("WAV_PCM_REQUIRED");
      format = {
        channels: view.getUint16(contentOffset + 2, true),
        sampleRate: view.getUint32(contentOffset + 4, true),
        byteRate: view.getUint32(contentOffset + 8, true),
        blockAlign: view.getUint16(contentOffset + 12, true),
        bitsPerSample: view.getUint16(contentOffset + 14, true),
      };
    } else if (name === "data") {
      data = audio.slice(contentOffset, contentOffset + size);
    }
    offset = contentOffset + size + (size % 2);
  }
  if (!format || !data || format.byteRate <= 0 || format.blockAlign <= 0) {
    throw new Error("WAV_DATA_REQUIRED");
  }
  return { ...format, data };
}

function assertSameFormat(expected: ParsedPcmWav, actual: ParsedPcmWav): void {
  if (
    expected.channels !== actual.channels ||
    expected.sampleRate !== actual.sampleRate ||
    expected.byteRate !== actual.byteRate ||
    expected.blockAlign !== actual.blockAlign ||
    expected.bitsPerSample !== actual.bitsPerSample
  ) {
    throw new Error("WAV_FORMAT_MISMATCH");
  }
}

export function concatenatePcmWav(parts: readonly WavPart[]): Uint8Array {
  if (parts.length === 0) throw new Error("WAV_PARTS_REQUIRED");
  if (parts.length === 1 && parts[0]!.pauseAfterMs <= 0) return parts[0]!.audio;
  const parsed = parts.map((part) => parsePcmWav(part.audio));
  const format = parsed[0]!;
  for (const item of parsed.slice(1)) assertSameFormat(format, item);
  const silenceLengths = parts.map((part) => {
    const sampleFrames = Math.max(
      0,
      Math.round((format.sampleRate * part.pauseAfterMs) / 1_000),
    );
    return sampleFrames * format.blockAlign;
  });
  const dataLength = parsed.reduce(
    (sum, item, index) => sum + item.data.byteLength + silenceLengths[index]!,
    0,
  );
  if (dataLength > 500 * 1024 * 1024) throw new Error("WAV_OUTPUT_TOO_LARGE");
  const output = new Uint8Array(44 + dataLength);
  const view = new DataView(output.buffer);
  const encoder = new TextEncoder();
  output.set(encoder.encode("RIFF"), 0);
  view.setUint32(4, 36 + dataLength, true);
  output.set(encoder.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, format.channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.byteRate, true);
  view.setUint16(32, format.blockAlign, true);
  view.setUint16(34, format.bitsPerSample, true);
  output.set(encoder.encode("data"), 36);
  view.setUint32(40, dataLength, true);
  let offset = 44;
  parsed.forEach((item, index) => {
    output.set(item.data, offset);
    offset += item.data.byteLength + silenceLengths[index]!;
  });
  return output;
}

export function wavDurationMs(audio: Uint8Array): number | undefined {
  try {
    const parsed = parsePcmWav(audio);
    return Math.round((parsed.data.byteLength / parsed.byteRate) * 1_000);
  } catch {
    return undefined;
  }
}
