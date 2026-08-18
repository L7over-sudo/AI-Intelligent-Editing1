import { describe, expect, it } from "vitest";

import {
  alignSubtitleCueStartsToPcmWav,
  capInternalSilencePcmWav,
  concatenatePcmWav,
  ensureMinimumTrailingSilencePcmWav,
  fadeInPcmWav,
  fadeOutPcmWav,
  findQuietestPcmWavPointMs,
  hasAbruptWavEnding,
  interSceneNarrationPauseMs,
  mutePcmWavBeforeMs,
  narrationPauseAfterMs,
  normalizeNarrationPcmWav,
  pcmWavTrailingSilenceMs,
  repairAbruptWavBoundaries,
  repairIntraSentencePausesPcmWav,
  slicePcmWav,
  wavDurationMs,
} from "./wav";

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

function makePcmWavWithHeadAndSpeech(): Uint8Array {
  const audio = makePcmWav(300, 8_000);
  const view = new DataView(audio.buffer);
  for (let offset = 44; offset < audio.byteLength; offset += 2) {
    view.setInt16(offset, offset < 44 + 800 ? 2_000 : 12_000, true);
  }
  return audio;
}

describe("mutePcmWavBeforeMs", () => {
  it("mutes only the noisy head and preserves duration", () => {
    const audio = makePcmWavWithHeadAndSpeech();
    const muted = mutePcmWavBeforeMs(audio, 100, 12);
    const view = new DataView(muted.buffer);

    expect(wavDurationMs(muted)).toBe(wavDurationMs(audio));
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(44 + 800, true)).toBe(0);
    expect(view.getInt16(44 + 2_000, true)).toBeGreaterThan(0);
  });
});

function makePcmWavWithAmplitude(
  durationMs: number,
  amplitude: number,
  sampleRate = 8_000,
): Uint8Array {
  const output = makePcmWav(durationMs, sampleRate);
  const view = new DataView(output.buffer);
  const sampleCount = Math.round((sampleRate * durationMs) / 1_000);
  for (let index = 0; index < sampleCount; index += 1) {
    view.setInt16(44 + index * 2, amplitude, true);
  }
  return output;
}

function makePcmWavWithRegions(
  regions: ReadonlyArray<{ durationMs: number; amplitude: number }>,
  sampleRate = 8_000,
): Uint8Array {
  const durationMs = regions.reduce(
    (sum, region) => sum + region.durationMs,
    0,
  );
  const output = makePcmWav(durationMs, sampleRate);
  const view = new DataView(output.buffer);
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

describe("narrationPauseAfterMs", () => {
  it("gives sentence endings the longest pause", () => {
    expect(narrationPauseAfterMs("先把复杂问题写下来。")).toBe(420);
    expect(narrationPauseAfterMs("再找出最关键的一步！")).toBe(420);
    expect(narrationPauseAfterMs("完成以后，马上检查结果？")).toBe(420);
  });

  it("gives clause endings a shorter pause", () => {
    expect(narrationPauseAfterMs("今天我们先讲方法，")).toBe(140);
    expect(narrationPauseAfterMs("然后看具体案例：")).toBe(140);
  });

  it("uses a small default for unpunctuated chunks", () => {
    expect(narrationPauseAfterMs("把任务拆成小动作")).toBe(120);
  });
});

describe("interSceneNarrationPauseMs", () => {
  it("adds a moderate pause only after true sentence endings", () => {
    expect(interSceneNarrationPauseMs("先把复杂问题写下来。")).toBe(60);
    expect(interSceneNarrationPauseMs("再找出最关键的一步！")).toBe(60);
    expect(interSceneNarrationPauseMs("马上检查结果？")).toBe(60);
    expect(interSceneNarrationPauseMs("话还没说完……")).toBe(60);
  });

  it("keeps comma clause breaks flowing without an extra pause", () => {
    expect(interSceneNarrationPauseMs("今天我们先讲方法，")).toBe(0);
    expect(interSceneNarrationPauseMs("然后看具体案例：")).toBe(0);
    expect(interSceneNarrationPauseMs("把任务拆成小动作")).toBe(0);
  });
});

describe("voice tail protection", () => {
  it("finds a low-energy point between two spoken regions", () => {
    const source = makePcmWavWithRegions([
      { durationMs: 500, amplitude: 4_000 },
      { durationMs: 100, amplitude: 0 },
      { durationMs: 500, amplitude: 4_000 },
    ]);
    const result = findQuietestPcmWavPointMs(source, 450, 650);

    expect(result?.pointMs).toBeGreaterThanOrEqual(500);
    expect(result?.pointMs).toBeLessThanOrEqual(600);
    expect(result?.rms).toBe(0);
  });

  it("pads every sentence clip to the required trailing silence", () => {
    const source = makePcmWavWithRegions([
      { durationMs: 500, amplitude: 4_000 },
      { durationMs: 120, amplitude: 0 },
    ]);
    const padded = ensureMinimumTrailingSilencePcmWav(source, 420);

    expect(pcmWavTrailingSilenceMs(padded)).toBeGreaterThanOrEqual(420);
    expect(wavDurationMs(padded)).toBe(920);
  });

  it("does not add a second pause when the required tail already exists", () => {
    const source = makePcmWavWithRegions([
      { durationMs: 500, amplitude: 4_000 },
      { durationMs: 500, amplitude: 0 },
    ]);

    expect(wavDurationMs(ensureMinimumTrailingSilencePcmWav(source, 420))).toBe(
      1_000,
    );
  });

  it("detects an audio clip that ends without trailing silence", () => {
    expect(hasAbruptWavEnding(makePcmWavWithAmplitude(500, 5_000))).toBe(true);
  });

  it("accepts a clip that fades to silence", () => {
    expect(hasAbruptWavEnding(makePcmWav(500))).toBe(false);
  });

  it("fades out the tail without changing duration", () => {
    const source = makePcmWavWithAmplitude(200, 10_000);
    const faded = fadeOutPcmWav(source, 100);
    const view = new DataView(faded.buffer, faded.byteOffset, faded.byteLength);

    expect(wavDurationMs(faded)).toBe(200);
    expect(Math.abs(view.getInt16(44, true))).toBeGreaterThan(
      Math.abs(view.getInt16(faded.byteLength - 2, true)),
    );
  });

  it("fades in the head without changing duration", () => {
    const source = makePcmWavWithAmplitude(200, 10_000);
    const faded = fadeInPcmWav(source, 100);
    const view = new DataView(faded.buffer, faded.byteOffset, faded.byteLength);

    expect(wavDurationMs(faded)).toBe(200);
    expect(Math.abs(view.getInt16(44, true))).toBeLessThan(
      Math.abs(view.getInt16(faded.byteLength - 2, true)),
    );
  });

  it("smooths active audio at both sides of a scene boundary", () => {
    const parts = repairAbruptWavBoundaries([
      makePcmWavWithAmplitude(500, 10_000),
      makePcmWavWithAmplitude(500, 10_000),
    ]);
    const firstView = new DataView(
      parts[0]!.buffer,
      parts[0]!.byteOffset,
      parts[0]!.byteLength,
    );
    const secondView = new DataView(
      parts[1]!.buffer,
      parts[1]!.byteOffset,
      parts[1]!.byteLength,
    );

    expect(wavDurationMs(parts[0]!)).toBe(500);
    expect(wavDurationMs(parts[1]!)).toBe(500);
    expect(firstView.getInt16(parts[0]!.byteLength - 2, true)).toBe(0);
    expect(secondView.getInt16(44, true)).toBe(0);
  });
});

describe("capInternalSilencePcmWav", () => {
  it("shortens an overlong internal pause while keeping the tail", () => {
    const source = makePcmWavWithRegions([
      { durationMs: 200, amplitude: 4_000 },
      { durationMs: 300, amplitude: 0 },
      { durationMs: 200, amplitude: 4_000 },
      { durationMs: 100, amplitude: 0 },
    ]);
    const capped = capInternalSilencePcmWav(source, {
      maximumPauseMs: 160,
    });
    expect(wavDurationMs(capped)).toBe(660); // 200 + 160 + 200 + 100
  });

  it("leaves pauses within the limit unchanged", () => {
    const source = makePcmWavWithRegions([
      { durationMs: 200, amplitude: 4_000 },
      { durationMs: 100, amplitude: 0 },
      { durationMs: 200, amplitude: 4_000 },
    ]);
    expect(wavDurationMs(capInternalSilencePcmWav(source))).toBe(500);
  });

  it("does not touch the trailing tail", () => {
    const source = makePcmWavWithRegions([
      { durationMs: 200, amplitude: 4_000 },
      { durationMs: 300, amplitude: 0 },
    ]);
    expect(
      wavDurationMs(capInternalSilencePcmWav(source, { maximumPauseMs: 100 })),
    ).toBe(500);
  });
});

describe("subtitle acoustic alignment", () => {
  it("moves the first subtitle to the first sustained audible onset", () => {
    const audio = makePcmWavWithRegions([
      { durationMs: 200, amplitude: 0 },
      { durationMs: 800, amplitude: 4_000 },
    ]);
    const cues = alignSubtitleCueStartsToPcmWav(audio, [
      { startMs: 0, endMs: 1_000, text: "first" },
    ]);

    expect(cues[0]?.startMs).toBeGreaterThanOrEqual(180);
    expect(cues[0]?.startMs).toBeLessThanOrEqual(220);
  });

  it("can use a wider search only for a long first-scene pre-roll", () => {
    const audio = makePcmWavWithRegions([
      { durationMs: 600, amplitude: 0 },
      { durationMs: 800, amplitude: 4_000 },
    ]);
    const cues = alignSubtitleCueStartsToPcmWav(
      audio,
      [{ startMs: 0, endMs: 1_400, text: "first" }],
      { firstSearchRadiusMs: 800 },
    );

    expect(cues[0]?.startMs).toBeGreaterThanOrEqual(580);
    expect(cues[0]?.startMs).toBeLessThanOrEqual(620);
  });

  it("ignores a loud pre-roll click followed by a noisy gap", () => {
    const audio = makePcmWavWithRegions([
      { durationMs: 40, amplitude: 12_000 },
      { durationMs: 280, amplitude: 300 },
      { durationMs: 800, amplitude: 4_000 },
    ]);
    const cues = alignSubtitleCueStartsToPcmWav(
      audio,
      [{ startMs: 0, endMs: 1_120, text: "first" }],
      { firstCueStrategy: "acoustic", firstSearchRadiusMs: 500 },
    );

    expect(cues[0]?.startMs).toBeGreaterThanOrEqual(300);
    expect(cues[0]?.startMs).toBeLessThanOrEqual(340);
  });

  it("can correct a provider first cue that is later than the acoustic onset", () => {
    const audio = makePcmWavWithRegions([
      { durationMs: 200, amplitude: 0 },
      { durationMs: 800, amplitude: 4_000 },
    ]);
    const cues = alignSubtitleCueStartsToPcmWav(
      audio,
      [{ startMs: 500, endMs: 1_000, text: "first" }],
      { firstCueStrategy: "acoustic" },
    );

    expect(cues[0]?.startMs).toBeGreaterThanOrEqual(180);
    expect(cues[0]?.startMs).toBeLessThanOrEqual(220);
  });

  it("moves a provider timestamp to the real onset after a pause", () => {
    const audio = makePcmWavWithRegions([
      { durationMs: 800, amplitude: 4_000 },
      { durationMs: 180, amplitude: 0 },
      { durationMs: 1_020, amplitude: 4_000 },
    ]);
    const cues = alignSubtitleCueStartsToPcmWav(audio, [
      { startMs: 0, endMs: 800, text: "上一句" },
      { startMs: 1_100, endMs: 2_000, text: "下一句" },
    ]);
    expect(cues[0]?.endMs).toBeGreaterThanOrEqual(960);
    expect(cues[0]?.endMs).toBeLessThanOrEqual(1_000);
    expect(cues[1]?.startMs).toBe(cues[0]?.endMs);
  });

  it("keeps fallback cue starts strictly ordered", () => {
    const audio = makePcmWavWithAmplitude(500, 4_000);
    const cues = alignSubtitleCueStartsToPcmWav(audio, [
      { startMs: 0, endMs: 100, text: "一" },
      { startMs: 0, endMs: 200, text: "二" },
    ]);
    expect(cues[0]?.startMs).toBe(0);
    expect(cues[1]?.startMs).toBeGreaterThan(cues[0]!.startMs);
    expect(cues[0]?.endMs).toBe(cues[1]?.startMs);
  });

  it("can preserve provider cue ends for audio partitioning", () => {
    const audio = makePcmWavWithRegions([
      { durationMs: 800, amplitude: 4_000 },
      { durationMs: 180, amplitude: 0 },
      { durationMs: 1_020, amplitude: 4_000 },
    ]);
    const cues = alignSubtitleCueStartsToPcmWav(
      audio,
      [
        { startMs: 0, endMs: 800, text: "上一句" },
        { startMs: 1_100, endMs: 2_000, text: "下一句" },
      ],
      { preserveCueEnds: true },
    );

    expect(cues[0]?.endMs).toBe(800);
    expect(cues[1]?.startMs).toBeGreaterThan(800);
  });

  it("ignores a quiet dip that is not followed by a sustained onset", () => {
    const audio = makePcmWavWithRegions([
      { durationMs: 700, amplitude: 4_000 },
      { durationMs: 20, amplitude: 0 },
      { durationMs: 280, amplitude: 4_000 },
      { durationMs: 200, amplitude: 0 },
      { durationMs: 800, amplitude: 4_000 },
    ]);
    const cues = alignSubtitleCueStartsToPcmWav(audio, [
      { startMs: 0, endMs: 900, text: "上一句" },
      { startMs: 1_100, endMs: 2_000, text: "下一句" },
    ]);
    expect(cues[1]?.startMs).toBeGreaterThanOrEqual(1_180);
    expect(cues[1]?.startMs).toBeLessThanOrEqual(1_240);
  });
});

describe("narration audio cleanup", () => {
  it("slices PCM audio on sample boundaries", () => {
    const sliced = slicePcmWav(makePcmWav(2_000), 540, 1_760);

    expect(wavDurationMs(sliced)).toBe(1_220);
  });

  it("removes dirty pre-roll and tail while keeping a stable comma pause", () => {
    const result = normalizeNarrationPcmWav({
      audio: makePcmWavWithAmplitude(2_000, 4_000),
      cues: [{ startMs: 600, endMs: 1_700, text: "下一句话" }],
      narration: "上一句话，",
    });

    expect(result.trimStartMs).toBe(540);
    expect(result.trimEndMs).toBe(1_760);
    expect(result.cues).toEqual([
      { startMs: 60, endMs: 1_160, text: "下一句话" },
    ]);
    expect(result.pauseAfterMs).toBe(140);
    expect(result.durationMs).toBe(1_360);
  });

  it("uses a longer pause after a complete sentence", () => {
    const result = normalizeNarrationPcmWav({
      audio: makePcmWav(2_000),
      cues: [{ startMs: 600, endMs: 1_700, text: "一句话" }],
      narration: "一句话。",
    });

    expect(result.pauseAfterMs).toBe(420);
    expect(result.durationMs).toBe(1_640);
  });

  it("can preserve continuous speech without appending a scene pause", () => {
    const result = normalizeNarrationPcmWav({
      audio: makePcmWav(2_000),
      cues: [{ startMs: 600, endMs: 1_700, text: "连续语句" }],
      narration: "连续语句，",
      trailingPauseMs: 0,
    });

    expect(result.pauseAfterMs).toBe(0);
    expect(result.durationMs).toBe(1_220);
  });

  it("compresses only a quiet unpunctuated gap and shifts later cues with the audio", () => {
    const audio = makePcmWavWithRegions([
      { durationMs: 800, amplitude: 4_000 },
      { durationMs: 180, amplitude: 0 },
      { durationMs: 1_020, amplitude: 4_000 },
    ]);
    const result = repairIntraSentencePausesPcmWav(audio, [
      { startMs: 0, endMs: 800, text: "上一句没有说完" },
      { startMs: 980, endMs: 2_000, text: "下一句继续" },
    ]);

    expect(result.repairedPauseCount).toBe(1);
    expect(result.removedMs).toBe(120);
    expect(wavDurationMs(result.audio)).toBe(1_880);
    expect(result.cues).toEqual([
      { startMs: 0, endMs: 800, text: "上一句没有说完" },
      { startMs: 860, endMs: 1_880, text: "下一句继续" },
    ]);
  });

  it("keeps a quiet gap when the previous cue ends with punctuation", () => {
    const audio = makePcmWavWithRegions([
      { durationMs: 800, amplitude: 4_000 },
      { durationMs: 180, amplitude: 0 },
      { durationMs: 1_020, amplitude: 4_000 },
    ]);
    const result = repairIntraSentencePausesPcmWav(audio, [
      { startMs: 0, endMs: 800, text: "上一句。" },
      { startMs: 980, endMs: 2_000, text: "下一句。" },
    ]);

    expect(result.repairedPauseCount).toBe(0);
    expect(result.removedMs).toBe(0);
    expect(result.audio).toBe(audio);
    expect(result.cues).toEqual([
      { startMs: 0, endMs: 800, text: "上一句。" },
      { startMs: 980, endMs: 2_000, text: "下一句。" },
    ]);
  });

  it("uses fine-grained pause cues without splitting the displayed subtitle cue", () => {
    const result = normalizeNarrationPcmWav({
      audio: makePcmWavWithRegions([
        { durationMs: 800, amplitude: 4_000 },
        { durationMs: 180, amplitude: 0 },
        { durationMs: 1_020, amplitude: 4_000 },
      ]),
      cues: [{ startMs: 0, endMs: 2_000, text: "上一句没有说完下一句继续" }],
      pauseCues: [
        { startMs: 0, endMs: 800, text: "上一句没有说完" },
        { startMs: 980, endMs: 2_000, text: "下一句继续" },
      ],
      narration: "上一句没有说完下一句继续",
      edgePaddingMs: 0,
      trailingPauseMs: 0,
    });

    expect(result.durationMs).toBe(1_880);
    expect(result.cues).toEqual([
      { startMs: 0, endMs: 1_880, text: "上一句没有说完下一句继续" },
    ]);
  });
});
