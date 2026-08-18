import { describe, expect, it } from "vitest";

import {
  VOICE_REFERENCE_CLEANUP_TIMEOUT_MS,
  voiceReferenceFilterArgs,
} from "./voice-reference-cleaner";

describe("voice reference cleanup", () => {
  it("uses a non-shell denoise and mono PCM filter", () => {
    const args = voiceReferenceFilterArgs("input.mp3", "output.wav");

    expect(args).toContain("input.mp3");
    expect(args).toContain("output.wav");
    expect(args).toContain(
      "highpass=f=70,lowpass=f=12000,afftdn=nr=12:nf=-35:tn=1",
    );
    expect(args).toContain("-ac");
    expect(args[args.indexOf("-ac") + 1]).toBe("1");
    expect(args).toContain("-c:a");
    expect(args[args.indexOf("-c:a") + 1]).toBe("pcm_s16le");
  });

  it("keeps the cleanup bounded", () => {
    expect(VOICE_REFERENCE_CLEANUP_TIMEOUT_MS).toBe(120_000);
  });
});
