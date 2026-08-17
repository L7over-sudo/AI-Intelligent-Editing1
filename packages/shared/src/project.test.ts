import { describe, expect, it } from "vitest";

import { createProjectSchema, shortProjectTitle } from "./project";

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
      narrationVolume: 1,
      backgroundMusicVolume: 0.1,
      subtitleStyle: {
        ...projectInput.subtitleStyle,
        templateId: "BUILTIN",
        videoTemplate: "FULL_BLEED",
        headerText: "",
        mainTitle: "",
        leftVerticalText: "",
        rightVerticalText: "",
        transitionsEnabled: true,
        customTitle: true,
        imageSize: "AUTO",
      },
      includeNarration: true,
      includeSubtitles: true,
      includeSoundEffects: true,
      backgroundMusic: "NONE",
    });
  });

  it("rejects the removed text opening option", () => {
    expect(() =>
      createProjectSchema.parse({
        ...projectInput,
        useTextOpeningTemplate: true,
      }),
    ).toThrow();
  });

  it("supports choosing the built-in background music", () => {
    expect(
      createProjectSchema.parse({
        ...projectInput,
        backgroundMusic: "BUILTIN",
      }).backgroundMusic,
    ).toBe("BUILTIN");
  });

  it("supports auto-matching background music from the music library", () => {
    expect(
      createProjectSchema.parse({
        ...projectInput,
        backgroundMusic: "AUTO_MATCH",
      }).backgroundMusic,
    ).toBe("AUTO_MATCH");
  });

  it("supports a specific music library track selection", () => {
    expect(
      createProjectSchema.parse({
        ...projectInput,
        backgroundMusic: "AUTO_MATCH:轻快-开头.mp3",
      }).backgroundMusic,
    ).toBe("AUTO_MATCH:轻快-开头.mp3");
  });

  it("rejects music library selections that escape the library", () => {
    expect(() =>
      createProjectSchema.parse({
        ...projectInput,
        backgroundMusic: "AUTO_MATCH:../secret.mp3",
      }),
    ).toThrow();
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

  it("accepts safe project audio mix levels", () => {
    const parsed = createProjectSchema.parse({
      ...projectInput,
      narrationVolume: 1.35,
      backgroundMusicVolume: 0.25,
    });

    expect(parsed.narrationVolume).toBe(1.35);
    expect(parsed.backgroundMusicVolume).toBe(0.25);
    expect(() =>
      createProjectSchema.parse({
        ...projectInput,
        narrationVolume: 2.1,
      }),
    ).toThrow();
  });

  it("supports choosing an exact image generation size", () => {
    expect(
      createProjectSchema.parse({
        ...projectInput,
        subtitleStyle: {
          ...projectInput.subtitleStyle,
          imageSize: "1040x832",
        },
      }).subtitleStyle.imageSize,
    ).toBe("1040x832");
  });

  it("supports custom vertical side text", () => {
    expect(
      createProjectSchema.parse({
        ...projectInput,
        subtitleStyle: {
          ...projectInput.subtitleStyle,
        leftVerticalText: "无限进化的Jay",
          rightVerticalText: "个人观点\n\n无不良引导",
          mainTitle: "自我突破",
        },
      }).subtitleStyle,
    ).toMatchObject({
      leftVerticalText: "无限进化的Jay",
      rightVerticalText: "个人观点\n\n无不良引导",
      mainTitle: "自我突破",
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

  it("accepts a landscape knowledge-board project", () => {
    expect(() =>
      createProjectSchema.parse({
        ...projectInput,
        aspectRatio: "LANDSCAPE",
        subtitleStyle: {
          ...projectInput.subtitleStyle,
          videoTemplate: "KNOWLEDGE_BOARD",
        },
      }),
    ).not.toThrow();
  });

  it("rejects a portrait knowledge-board project", () => {
    expect(() =>
      createProjectSchema.parse({
        ...projectInput,
        subtitleStyle: {
          ...projectInput.subtitleStyle,
          videoTemplate: "KNOWLEDGE_BOARD",
        },
      }),
    ).toThrow();
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

describe("shortProjectTitle", () => {
  it("uses the first clause of the copy", () => {
    expect(
      shortProjectTitle("你有没有发现，越重要的事情，我们越容易拖延？"),
    ).toBe("你有没有发现");
  });

  it("truncates a long clause without punctuation", () => {
    expect(shortProjectTitle("这是一个非常非常长的没有标点符号的项目文案内容")).toBe(
      "这是一个非常非常长的没有…",
    );
  });

  it("falls back for empty copy", () => {
    expect(shortProjectTitle("   ")).toBe("未命名视频");
  });
});
