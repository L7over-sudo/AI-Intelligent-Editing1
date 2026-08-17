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

  it("validates narration and background music volume independently", () => {
    const parsed = remotionRenderInputSchema.parse({
      ...validInput,
      narrationVolume: 1.4,
      backgroundMusicVolume: 0.3,
    });
    expect(parsed.narrationVolume).toBe(1.4);
    expect(parsed.backgroundMusicVolume).toBe(0.3);
    expect(() =>
      remotionRenderInputSchema.parse({
        ...validInput,
        narrationVolume: 2.1,
      }),
    ).toThrow();
  });

  it("rejects the removed text-opening scene fields", () => {
    expect(() =>
      remotionRenderInputSchema.parse({
        ...validInput,
        scenes: [
          {
            ...validInput.scenes[0],
            isTextOpening: true,
            openingText: "Opening",
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts a rise animation for the first generated scene", () => {
    const parsed = remotionRenderInputSchema.parse({
      ...validInput,
      scenes: [
        {
          ...validInput.scenes[0],
          animation: { type: "RISE", direction: "UP", intensity: 1 },
        },
      ],
    });
    expect(parsed.scenes[0]?.animation.type).toBe("RISE");
  });

  it("accepts subtitle keyword highlights produced by voice alignment", () => {
    const parsed = remotionRenderInputSchema.parse({
      ...validInput,
      scenes: [
        {
          ...validInput.scenes[0],
          subtitleCues: [
            {
              startMs: 0,
              endMs: 2_000,
              text: "职场边界需要说清楚",
              highlighted: ["职场边界"],
            },
          ],
        },
      ],
    });

    expect(parsed.scenes[0]?.subtitleCues[0]?.highlighted).toEqual([
      "职场边界",
    ]);
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
