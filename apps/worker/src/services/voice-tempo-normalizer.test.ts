import { describe, expect, it } from "vitest";

import {
  cueCharsPerSecond,
  normalizeCueTempoPcmWav,
  tempoFactorForCue,
} from "./voice-tempo-normalizer";

describe("voice tempo normalizer", () => {
  it("measures Chinese cue rate from the displayed text", () => {
    expect(
      cueCharsPerSecond({ startMs: 0, endMs: 1_000, text: "你 每次 找人办事" }),
    ).toBe(7);
  });

  it("only slows cues above the natural-rate ceiling", () => {
    expect(
      tempoFactorForCue({ startMs: 0, endMs: 1_400, text: "你每次找人办事" }),
    ).toBe(1);
    expect(
      tempoFactorForCue({ startMs: 0, endMs: 800, text: "你每次找人办事" }),
    ).toBeLessThan(1);
  });

  it("leaves an already-natural clip untouched", async () => {
    const audio = new Uint8Array(44 + 16_000);
    audio.set(new TextEncoder().encode("RIFF"), 0);
    const view = new DataView(audio.buffer);
    audio.set(new TextEncoder().encode("WAVEfmt "), 8);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8_000, true);
    view.setUint32(28, 16_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    audio.set(new TextEncoder().encode("data"), 36);
    view.setUint32(40, 16_000, true);
    expect(
      await normalizeCueTempoPcmWav(audio, [
        { startMs: 0, endMs: 2_000, text: "自然的一句话" },
      ]),
    ).toMatchObject({ changed: false, repairedCueCount: 0 });
  });
});
