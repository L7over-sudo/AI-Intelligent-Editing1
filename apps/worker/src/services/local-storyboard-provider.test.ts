import { describe, expect, it } from "vitest";

import { storyboardSchema } from "@stickmotion/shared";

import { LocalStoryboardProvider } from "./local-storyboard-provider";

const request = {
  sourceKind: "FULL_TEXT" as const,
  aspectRatio: "PORTRAIT" as const,
  language: "zh-CN",
  accentColor: "#FF5C35",
  imagePrompt: "黑白极简火柴人插画，统一角色，干净背景",
};

describe("LocalStoryboardProvider", () => {
  it("creates one visual scene per complete sentence", async () => {
    const sentences = [
      "先把复杂问题写下来。",
      "再找出最关键的一步！",
      "完成以后，马上检查结果。",
    ];
    const provider = new LocalStoryboardProvider();

    const storyboard = await provider.generate({
      ...request,
      sourceText: sentences.join(""),
    });

    expect(() => storyboardSchema.parse(storyboard)).not.toThrow();
    expect(storyboard.scenes.map((scene) => scene.narration)).toEqual(
      sentences,
    );
    expect(storyboard.scenes.map((scene) => scene.visualPrompt)).toHaveLength(
      sentences.length,
    );
    expect(storyboard.scenes[2]?.subtitle).toBe("完成以后，马上检查结果。");
    expect(
      storyboard.scenes.every(
        (scene) =>
          scene.visualPrompt.includes(request.imagePrompt) &&
          scene.visualPrompt.includes("9:16"),
      ),
    ).toBe(true);
    expect(
      storyboard.scenes.every((scene) => scene.estimatedDuration >= 1.5),
    ).toBe(true);
    expect(
      storyboard.scenes.every(
        (scene) =>
          scene.animation.type !== "ZOOM" &&
          scene.transition.type !== "ZOOM" &&
          scene.transition.type !== "PUSH",
      ),
    ).toBe(true);
  });

  it("uses only the fixed 21:9 ratio for knowledge-board prompts", async () => {
    const provider = new LocalStoryboardProvider();
    const storyboard = await provider.generate({
      ...request,
      sourceText: "知识板分镜。",
      aspectRatio: "LANDSCAPE",
      videoTemplate: "KNOWLEDGE_BOARD",
    });

    const prompt = storyboard.scenes[0]?.visualPrompt ?? "";
    expect(prompt).toContain("21:9");
    expect(prompt).not.toContain("16:9");
  });

  it("does not merge short sentences to reduce the scene count", async () => {
    const sentences = [
      "第一句。",
      "第二句。",
      "第三句？",
      "第四句！",
      "第五句；",
    ];
    const provider = new LocalStoryboardProvider();

    const storyboard = await provider.generate({
      ...request,
      sourceText: sentences.join(""),
    });

    expect(storyboard.scenes.map((scene) => scene.narration)).toEqual(
      sentences,
    );
  });

  it("treats line breaks as sentence boundaries", async () => {
    const provider = new LocalStoryboardProvider();
    const storyboard = await provider.generate({
      ...request,
      sourceText: "第一行没有句号\n第二行也没有句号",
    });

    expect(storyboard.scenes.map((scene) => scene.narration)).toEqual([
      "第一行没有句号",
      "第二行也没有句号",
    ]);
  });

  it("keeps a single short input as one scene", async () => {
    const provider = new LocalStoryboardProvider();
    const storyboard = await provider.generate({
      sourceText: "行动",
      sourceKind: "TOPIC",
      aspectRatio: "LANDSCAPE",
      language: "zh-CN",
      accentColor: "#00B8C4",
      imagePrompt: "黑白极简火柴人插画，统一角色，干净背景",
    });

    expect(storyboard.scenes).toHaveLength(1);
    expect(storyboard.scenes[0]?.narration).toBe("行动");
  });
  it("splits a dense sentence at natural clause boundaries", async () => {
    const provider = new LocalStoryboardProvider();
    const sourceText =
      "很多人遇到问题的时候，总想立刻找到答案，却忽略了真正需要解决的核心矛盾，于是反复尝试也没有结果。";
    const storyboard = await provider.generate({
      ...request,
      sourceText,
    });

    expect(storyboard.scenes.length).toBeGreaterThan(1);
    expect(storyboard.scenes.map((scene) => scene.narration).join("")).toBe(
      sourceText,
    );
    expect(
      storyboard.scenes.every(
        (scene) => Array.from(scene.narration).length <= 28,
      ),
    ).toBe(true);
    expect(storyboard.scenes[0]?.subtitle).toBe(
      storyboard.scenes[0]?.narration,
    );
    expect(storyboard.scenes[0]?.visualPrompt).toContain(
      storyboard.scenes[0]?.narration ?? "",
    );
    expect(storyboard.scenes[0]?.visualPrompt).toContain(
      "不要把分镜原文直接显示在画面中",
    );
  });

  it("hard-splits an unpunctuated oversized sentence", async () => {
    const provider = new LocalStoryboardProvider();
    const sourceText = "一".repeat(80);
    const storyboard = await provider.generate({
      ...request,
      sourceText,
    });

    expect(storyboard.scenes).toHaveLength(3);
    expect(storyboard.scenes.map((scene) => scene.narration).join("")).toBe(
      sourceText,
    );
    expect(
      storyboard.scenes.every(
        (scene) => Array.from(scene.narration).length <= 28,
      ),
    ).toBe(true);
  });

  it("uses scene content only as context without copying it into the image", async () => {
    const provider = new LocalStoryboardProvider();
    const storyboard = await provider.generate({
      ...request,
      imagePrompt: "cinematic city at night",
      sourceText: "第一句。",
    });

    const prompt = storyboard.scenes[0]?.visualPrompt ?? "";
    expect(prompt).toContain("cinematic city at night");
    expect(prompt).toContain("9:16");
    expect(prompt).toContain("第一句。");
    expect(prompt).toContain("场景内容仅用于理解画面");
    expect(prompt).toContain("不要把分镜原文直接显示在画面中");
    expect(prompt).toContain("不要添加 Logo 或水印");
    expect(prompt).not.toContain("只生成画面");
    expect(prompt).not.toContain("无关文字");
  });

  it("keeps the scene content even when the global image prompt is very long", async () => {
    const provider = new LocalStoryboardProvider();
    const storyboard = await provider.generate({
      ...request,
      imagePrompt: "长".repeat(3_000),
      sourceText: "把复杂问题写下来。",
    });

    const prompt = storyboard.scenes[0]?.visualPrompt ?? "";
    expect(prompt).toContain("把复杂问题写下来");
    expect(prompt).toContain("场景内容仅用于理解画面");
    expect(prompt).toContain("不要把分镜原文直接显示在画面中");
    expect(prompt).toContain("长".repeat(3_000));
    // Scene content comes first so it can never be truncated away.
    expect(prompt.startsWith("场景内容")).toBe(true);
  });
});
