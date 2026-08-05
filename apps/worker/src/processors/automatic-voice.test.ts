import { describe, expect, it } from "vitest";

import {
  automaticVoiceIdempotencyKey,
  shouldQueueAutomaticVoice,
} from "./automatic-voice";

describe("automatic voice generation", () => {
  it("queues an unvoiced scene when a reusable voice profile is selected", () => {
    expect(
      shouldQueueAutomaticVoice({
        includeNarration: true,
        voiceStyle: "voxcpm2",
        voiceProfileId: "profile-1",
        hasVoiceTrack: false,
      }),
    ).toBe(true);
  });

  it("does not queue disabled, unconfigured, or already generated audio", () => {
    expect(
      shouldQueueAutomaticVoice({
        includeNarration: true,
        voiceStyle: "none",
        voiceProfileId: "profile-1",
        hasVoiceTrack: false,
      }),
    ).toBe(false);
    expect(
      shouldQueueAutomaticVoice({
        includeNarration: true,
        voiceStyle: "voxcpm2",
        voiceProfileId: null,
        hasVoiceTrack: false,
      }),
    ).toBe(false);
    expect(
      shouldQueueAutomaticVoice({
        includeNarration: true,
        voiceStyle: "voxcpm2",
        voiceProfileId: "profile-1",
        hasVoiceTrack: true,
      }),
    ).toBe(false);
    expect(
      shouldQueueAutomaticVoice({
        includeNarration: false,
        voiceStyle: "voxcpm2",
        voiceProfileId: "profile-1",
        hasVoiceTrack: false,
      }),
    ).toBe(false);
  });

  it("uses a retry-safe key tied to the image job", () => {
    expect(automaticVoiceIdempotencyKey("scene-1", 3, "image-job-1")).toBe(
      "auto-voice:scene-1:3:image-job-1",
    );
  });
});
