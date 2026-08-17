import { describe, expect, it } from "vitest";

import { wavDurationMs } from "@stickmotion/media";

import { sanitizeNarrationArtifactTails } from "./narration-artifact-guard";

function makePcmWav(durationMs: number, sampleRate = 8_000): Uint8Array {
  const frames = Math.round((sampleRate * durationMs) / 1_000);
  const dataLength = frames * 2;
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
  for (let frame = 0; frame < frames; frame += 1) {
    view.setInt16(44 + frame * 2, Math.round(Math.sin(frame / 8) * 4_000), true);
  }
  return output;
}

function makePcmWavWithRegions(
  regions: ReadonlyArray<{ durationMs: number; amplitude: number }>,
  sampleRate = 8_000,
): Uint8Array {
  const durationMs = regions.reduce((sum, region) => sum + region.durationMs, 0);
  const output = makePcmWav(durationMs, sampleRate);
  const view = new DataView(output.buffer);
  let frame = 0;
  for (const region of regions) {
    const frames = Math.round((sampleRate * region.durationMs) / 1_000);
    for (let index = 0; index < frames; index += 1) {
      view.setInt16(
        44 + (frame + index) * 2,
        Math.round(Math.sin((frame + index) / 8) * region.amplitude),
        true,
      );
    }
    frame += frames;
  }
  return output;
}

describe("narration artifact guard", () => {
  it("removes only a long unrecognized tail after the expected narration", async () => {
    const result = await sanitizeNarrationArtifactTails({
      parts: [makePcmWav(4_620)],
      texts: ["话少一点，不是装深沉，是给自己留余地。"],
      transcribe: () => Promise.resolve([
        [
          {
            start: 0,
            end: 2.8,
            word: "话少一点不是装生辰是给自己留余地",
            probability: 0.98,
          },
        ],
      ]),
    });

    expect(result.repairs).toEqual([
      {
        index: 0,
        originalDurationMs: 4_620,
        repairedDurationMs: 3_020,
        removedMs: 1_600,
      },
    ]);
    expect(wavDurationMs(result.parts[0]!)).toBe(3_020);
  });

  it("keeps normal punctuation breathing room unchanged", async () => {
    const audio = makePcmWav(3_250);
    const result = await sanitizeNarrationArtifactTails({
      parts: [audio],
      texts: ["正常的一句话。"],
      transcribe: () => Promise.resolve([
        [
          {
            start: 0.1,
            end: 2.8,
            word: "正常的一句话",
            probability: 0.99,
          },
        ],
      ]),
    });

    expect(result.parts[0]).toBe(audio);
    expect(result.repairs).toEqual([]);
  });

  it("cuts at a quiet point before an active non-text sound", async () => {
    const result = await sanitizeNarrationArtifactTails({
      parts: [
        makePcmWavWithRegions([
          { durationMs: 2_700, amplitude: 4_000 },
          { durationMs: 180, amplitude: 0 },
          { durationMs: 1_320, amplitude: 4_000 },
        ]),
      ],
      texts: ["完整文案"],
      transcribe: () =>
        Promise.resolve([
          [{ start: 0, end: 2.65, word: "完整文案", probability: 0.99 }],
        ]),
    });

    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0]!.repairedDurationMs).toBeGreaterThanOrEqual(2_700);
    expect(result.repairs[0]!.repairedDurationMs).toBeLessThanOrEqual(2_880);
  });

  it("transcribes a multi-scene narration once in the normal path", async () => {
    const calls: number[] = [];
    const result = await sanitizeNarrationArtifactTails({
      parts: [makePcmWav(2_000), makePcmWav(3_000)],
      texts: ["第一句。", "第二句。"],
      transcribe: (audioInputs) => {
        calls.push(audioInputs.length);
        return Promise.resolve([
          [
            { start: 0.1, end: 1.5, word: "第一句", probability: 0.99 },
            { start: 2.1, end: 3.2, word: "第二句", probability: 0.99 },
          ],
        ]);
      },
    });

    expect(calls).toEqual([1]);
    expect(result.parts).toHaveLength(2);
    expect(result.repairs.map((repair) => repair.index)).toEqual([1]);
  });

  it("fails safe when recognition cannot cover the expected text", async () => {
    const audio = makePcmWav(4_000);
    const result = await sanitizeNarrationArtifactTails({
      parts: [audio],
      texts: ["这句话必须完整保留。"],
      transcribe: () => Promise.resolve([
        [{ start: 0, end: 1, word: "完全不同", probability: 0.99 }],
      ]),
    });

    expect(result.parts[0]).toBe(audio);
    expect(result.repairs).toEqual([]);
  });
});
