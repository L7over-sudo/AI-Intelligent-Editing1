import { describe, expect, it } from "vitest";

import { concatenatePcmWav, wavDurationMs } from "./wav";

function makePcmWav(durationMs: number, sampleRate = 8_000): Uint8Array {
  const dataLength = Math.round((sampleRate * durationMs) / 1_000) * 2;
  const output = new Uint8Array(44 + dataLength);
  const view = new DataView(output.buffer);
  const encoder = new TextEncoder();
  output.set(encoder.encode("RIFF"), 0);
  view.setUint32(4, 36 + dataLength, true);
  output.set(encoder.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  output.set(encoder.encode("data"), 36);
  view.setUint32(40, dataLength, true);
  output.fill(1, 44);
  return output;
}

describe("concatenatePcmWav", () => {
  it("joins PCM audio and inserts sample-aligned silence", () => {
    const output = concatenatePcmWav([
      { audio: makePcmWav(100), pauseAfterMs: 220 },
      { audio: makePcmWav(150), pauseAfterMs: 0 },
    ]);

    expect(wavDurationMs(output)).toBe(470);
    expect(output.slice(44 + 1_600, 44 + 1_600 + 3_520)).toEqual(
      new Uint8Array(3_520),
    );
  });

  it("rejects mismatched PCM formats", () => {
    expect(() =>
      concatenatePcmWav([
        { audio: makePcmWav(100, 8_000), pauseAfterMs: 1 },
        { audio: makePcmWav(100, 16_000), pauseAfterMs: 0 },
      ]),
    ).toThrow("WAV_FORMAT_MISMATCH");
  });
});
