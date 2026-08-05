import { describe, expect, it } from "vitest";

import type {
  StoryboardProvider,
  StoryboardRequest,
} from "./storyboard-provider";

const request: StoryboardRequest = {
  sourceText: "如何克服拖延",
  sourceKind: "TOPIC",
  aspectRatio: "PORTRAIT",
  language: "zh-CN",
  accentColor: "#FF5C35",
  imagePrompt: "黑白极简火柴人插画，统一角色，干净背景",
};

describe("StoryboardProvider contract", () => {
  it("does not require a user supplied target duration", async () => {
    const provider: StoryboardProvider = {
      generate: () =>
        Promise.resolve({
          title: "拖延",
          summary: "行动比等待更重要",
          scenes: [],
        }),
    };
    await expect(provider.generate(request)).resolves.toMatchObject({
      title: "拖延",
    });
  });
});
