import { describe, expect, it } from "vitest";

import { remotionRenderInputSchema } from "./remotion-render";

const validInput = {
  width: 1920,
  height: 1080,
  fps: 30,
  scenes: [
    {
      imageFile: "scene-0.png",
      durationMs: 2_000,
      animation: { type: "ZOOM", direction: "IN", intensity: 0.5 },
      transition: { type: "FADE", duration: 0.4 },
      subtitleCues: [{ startMs: 0, endMs: 2_000, text: "开始工作" }],
      soundEffects: [],
    },
  ],
  subtitleStyle: {
    fontSize: 60,
    position: "BOTTOM",
    outline: true,
    shadow: true,
    accentColor: "#19B9C6",
  },
};

describe("remotion render input", () => {
  it("accepts a safe local-media render plan", () => {
    expect(remotionRenderInputSchema.parse(validInput).fps).toBe(30);
  });

  it("rejects traversal paths and odd render dimensions", () => {
    expect(() =>
      remotionRenderInputSchema.parse({
        ...validInput,
        width: 1919,
        scenes: [
          {
            ...validInput.scenes[0],
            imageFile: "../secret.png",
          },
        ],
      }),
    ).toThrow();
  });
});
