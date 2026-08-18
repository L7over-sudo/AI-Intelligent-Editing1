import { describe, expect, it, vi } from "vitest";

import {
  VOICE_OUTPUT_CLEANUP_TIMEOUT_MS,
  cleanVoiceOutputAudio,
  voiceOutputFilterArgs,
} from "./voice-output-cleaner";

describe("voice output cleanup", () => {
  it("uses a timeline-preserving denoise, gate, and safe output level", () => {
    const args = voiceOutputFilterArgs("input.wav", "output.wav");

    expect(args).toContain(
      "highpass=f=70,lowpass=f=8000,afftdn=nr=16:nf=-45:tn=1,agate=threshold=0.008:ratio=8:attack=5:release=100:makeup=1,volume=0.8",
    );
    expect(args).toContain("-ac");
    expect(args[args.indexOf("-ac") + 1]).toBe("1");
    expect(args).toContain("-ar");
    expect(args[args.indexOf("-ar") + 1]).toBe("22050");
    expect(args).toContain("-c:a");
    expect(args[args.indexOf("-c:a") + 1]).toBe("pcm_s16le");
  });

  it("allows the FFmpeg runner to be injected", async () => {
    const run = vi.fn(() => Promise.resolve());
    await expect(
      cleanVoiceOutputAudio(new Uint8Array([1, 2, 3]), { run }),
    ).rejects.toThrow("INDEXTTS_AUDIO_CLEANUP_FAILED");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps cleanup bounded", () => {
    expect(VOICE_OUTPUT_CLEANUP_TIMEOUT_MS).toBe(120_000);
  });
});
