import { describe, expect, it } from "vitest";

import { storyboardSchema } from "@stickmotion/shared";

import { applyTemplateSoundEffects, buildReadyProjectUpdate } from "./script";

describe("script project update", () => {
  it("keeps the user-entered project title out of storyboard updates", () => {
    expect(buildReadyProjectUpdate(42)).toEqual({
      targetDuration: 42,
      status: "READY",
    });
  });

  it("adds sparse text-beat sound effects only for the impact template", () => {
    const storyboard = storyboardSchema.parse({
      title: "测试",
      summary: "测试模板音效",
      scenes: [0, 1, 2].map((index) => ({
        narration: index === 2 ? "最后给出关键答案" : `普通说明${index}`,
        subtitle: index === 2 ? "最后给出关键答案" : `普通说明${index}`,
        estimatedDuration: 2,
        visualPrompt: "办公室中的人物正在思考职业方向",
        templateElements: [
          {
            assetId: "person-thinking",
            x: 0.5,
            y: 0.5,
            scale: 1,
            rotation: 0,
            emphasis: false,
            label: "人物",
          },
        ],
        animation: { type: "NONE", direction: "NONE", intensity: 0 },
        transition: { type: "CUT", duration: 0 },
        soundEffects: [],
      })),
    });

    expect(
      applyTemplateSoundEffects(storyboard, "FULL_BLEED").scenes.every(
        (scene) => scene.soundEffects.length === 0,
      ),
    ).toBe(true);
    const impact = applyTemplateSoundEffects(storyboard, "IMPACT_CAPTIONS");
    expect(impact.scenes[0]?.soundEffects[0]?.tag).toBe("pop");
    expect(impact.scenes[2]?.soundEffects[0]?.tag).toBe("impact");
  });
});
