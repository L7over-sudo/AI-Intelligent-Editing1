import { describe, expect, it } from "vitest";

import type { RemotionRenderInput } from "@stickmotion/shared";

import {
  calculateRemotionDurationInFrames,
  calculateTransitionDurationInFrames,
} from "./timing";

const input: RemotionRenderInput = {
  width: 1920,
  height: 1080,
  fps: 30,
  scenes: [
    {
      imageFile: "one.png",
      durationMs: 2_000,
      animation: { type: "ZOOM", direction: "IN", intensity: 0.5 },
      transition: { type: "FADE", duration: 0.5 },
      subtitleCues: [],
      soundEffects: [],
    },
    {
      imageFile: "two.png",
      durationMs: 3_000,
      animation: { type: "PAN", direction: "LEFT", intensity: 0.5 },
      transition: { type: "CUT", duration: 0 },
      subtitleCues: [],
      soundEffects: [],
    },
  ],
  backgroundMusicVolume: 0.18,
  videoTemplate: "FULL_BLEED",
  headerText: "",
  subtitleStyle: {
    fontSize: 60,
    position: "BOTTOM",
    outline: true,
    shadow: true,
    accentColor: "#19B9C6",
  },
  watermark: "",
};

describe("Remotion timing", () => {
  it("keeps the total video duration equal to the narration timeline", () => {
    expect(calculateRemotionDurationInFrames(input)).toBe(150);
    expect(calculateTransitionDurationInFrames(input.scenes[0]!, 30)).toBe(15);
    expect(calculateTransitionDurationInFrames(input.scenes[1]!, 30)).toBe(0);
  });
});
