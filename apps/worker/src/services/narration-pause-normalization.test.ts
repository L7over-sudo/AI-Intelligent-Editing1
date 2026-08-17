import { describe, expect, it } from "vitest";

import { wavDurationMs } from "@stickmotion/media";

import {
  findNarrationStalls,
  trimSilenceRanges,
  trimmedBeforeMs,
} from "./narration-pause-normalization";

function makeWav(
  regions: ReadonlyArray<{ durationMs: number; amplitude: number }>,
  sampleRate = 8_000,
): Uint8Array {
  const durationMs = regions.reduce(
    (sum, region) => sum + region.durationMs,
    0,
  );
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
  let frame = 0;
  for (const region of regions) {
    const frames = Math.round((sampleRate * region.durationMs) / 1_000);
    for (let index = 0; index < frames; index += 1) {
      view.setInt16(44 + (frame + index) * 2, region.amplitude, true);
    }
    frame += frames;
  }
  return output;
}

const audio = makeWav([
  { durationMs: 500, amplitude: 2_000 },
  { durationMs: 400, amplitude: 1 },
  { durationMs: 500, amplitude: 2_000 },
  { durationMs: 400, amplitude: 1 },
  { durationMs: 500, amplitude: 2_000 },
]);

describe("findNarrationStalls", () => {
  it("trims a comma-position pause but keeps a sentence-end pause", () => {
    const stalls = findNarrationStalls({
      audio,
      sceneStartsMs: [0],
      sceneEndsMs: [2_300],
      cueEndsMs: [
        { endMs: 500, text: "你好，" },
        { endMs: 1_400, text: "再见。" },
      ],
    });
    expect(stalls).toEqual([
      { startMs: 500, endMs: 900, trimMs: 200, targetGapMs: 200 },
    ]);
  });

  it("keeps pauses near scene boundaries", () => {
    const stalls = findNarrationStalls({
      audio,
      sceneStartsMs: [0, 900],
      sceneEndsMs: [900, 2_300],
      cueEndsMs: [
        { endMs: 500, text: "你好，" },
        { endMs: 1_400, text: "再见。" },
      ],
    });
    expect(stalls).toEqual([]);
  });
});

describe("trimSilenceRanges", () => {
  it("removes only the excess silence and keeps timestamps consistent", () => {
    const stalls = findNarrationStalls({
      audio,
      sceneStartsMs: [0],
      sceneEndsMs: [2_300],
      cueEndsMs: [
        { endMs: 500, text: "你好，" },
        { endMs: 1_400, text: "再见。" },
      ],
    });
    const trimmed = trimSilenceRanges(audio, stalls);
    expect(wavDurationMs(trimmed)).toBe(2_100);
    expect(trimmedBeforeMs(stalls, 1_000)).toBe(200);
    expect(trimmedBeforeMs(stalls, 2_300)).toBe(200);
  });
});
