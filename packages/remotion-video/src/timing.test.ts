import { describe, expect, it } from "vitest";

import type { RemotionRenderInput } from "@stickmotion/shared";

import {
  calculateRemotionDurationInFrames,
  calculateSceneStartFrame,
  calculateSceneTimelineDurationInFrames,
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
  narrationVolume: 1,
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

  it("starts every subtitle scene on the same cumulative frame as its audio", () => {
    expect(calculateSceneStartFrame(input.scenes, 0, input.fps)).toBe(0);
    expect(calculateSceneStartFrame(input.scenes, 1, input.fps)).toBe(60);
  });

  it("does not accumulate per-scene frame rounding drift", () => {
    const shortScenes = Array.from({ length: 100 }, (_, index) => ({
      ...input.scenes[0]!,
      imageFile: `scene-${index}.png`,
      durationMs: 105,
      transition: { type: "CUT" as const, duration: 0 },
    }));
    expect(calculateSceneStartFrame(shortScenes, 100, 60)).toBe(630);
    expect(
      shortScenes.reduce(
        (total, _scene, index) =>
          total + calculateSceneTimelineDurationInFrames(shortScenes, index, 60),
        0,
      ),
    ).toBe(630);
    expect(
      calculateRemotionDurationInFrames({
        ...input,
        fps: 60,
        scenes: shortScenes,
      }),
    ).toBe(630);
  });
});
