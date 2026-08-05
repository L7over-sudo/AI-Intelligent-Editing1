import { describe, expect, it } from "vitest";

import { createProjectSchema } from "./project";

const projectInput = {
  title: "自动时长测试",
  sourceText: "系统应当根据完整旁白自动计算视频时长",
  sourceKind: "FULL_TEXT" as const,
  aspectRatio: "PORTRAIT" as const,
  language: "zh-CN",
  voiceStyle: "alloy",
  subtitleStyle: {
    mode: "CHINESE" as const,
    fontSize: 60,
    position: "BOTTOM" as const,
    outline: true,
    shadow: true,
    keywordHighlight: true,
  },
  accentColor: "#FF5C35",
  visualMode: "AI_IMAGE" as const,
  imagePrompt: "黑白极简火柴人插画，干净背景，主体清晰，统一角色形象",
};

describe("createProjectSchema duration policy", () => {
  it("creates a project without a user supplied duration", () => {
    expect(createProjectSchema.parse(projectInput)).toEqual({
      ...projectInput,
      subtitleStyle: {
        ...projectInput.subtitleStyle,
        templateId: "BUILTIN",
        videoTemplate: "FULL_BLEED",
        headerText: "",
        leftVerticalText: "",
        rightVerticalText: "",
        transitionsEnabled: true,
      },
      includeNarration: true,
      includeSubtitles: true,
      includeSoundEffects: true,
      useTextOpeningTemplate: false,
      backgroundMusic: "NONE",
    });
  });

  it("supports opting into the text opening template", () => {
    expect(
      createProjectSchema.parse({
        ...projectInput,
        useTextOpeningTemplate: true,
      }).useTextOpeningTemplate,
    ).toBe(true);
  });

  it("supports choosing the built-in background music", () => {
    expect(
      createProjectSchema.parse({
        ...projectInput,
        backgroundMusic: "BUILTIN",
      }).backgroundMusic,
    ).toBe("BUILTIN");
  });

  it("supports disabling all scene transitions", () => {
    expect(
      createProjectSchema.parse({
        ...projectInput,
        subtitleStyle: {
          ...projectInput.subtitleStyle,
          transitionsEnabled: false,
        },
      }).subtitleStyle.transitionsEnabled,
    ).toBe(false);
  });

  it("supports custom vertical side text", () => {
    expect(
      createProjectSchema.parse({
        ...projectInput,
        subtitleStyle: {
          ...projectInput.subtitleStyle,
          leftVerticalText: "@杰研社进化论",
          rightVerticalText: "个人观点\n\n无不良引导",
        },
      }).subtitleStyle,
    ).toMatchObject({
      leftVerticalText: "@杰研社进化论",
      rightVerticalText: "个人观点\n\n无不良引导",
    });
  });

  it("ignores removed visual-effect settings from existing projects", () => {
    const parsed = createProjectSchema.parse({
      ...projectInput,
      subtitleStyle: {
        ...projectInput.subtitleStyle,
        colorLutId: "AUTO",
        transitionMaskId: "AUTO",
      },
    });
    expect(parsed.subtitleStyle).not.toHaveProperty("colorLutId");
    expect(parsed.subtitleStyle).not.toHaveProperty("transitionMaskId");
  });

  it("supports a visual-only video without narration or subtitles", () => {
    expect(
      createProjectSchema.parse({
        ...projectInput,
        includeNarration: false,
        includeSubtitles: false,
      }),
    ).toMatchObject({
      includeNarration: false,
      includeSubtitles: false,
    });
  });

  it("rejects legacy targetDuration input", () => {
    expect(() =>
      createProjectSchema.parse({ ...projectInput, targetDuration: 60 }),
    ).toThrow();
  });

  it("requires a usable image prompt", () => {
    expect(() =>
      createProjectSchema.parse({ ...projectInput, imagePrompt: "" }),
    ).toThrow();
  });
});
