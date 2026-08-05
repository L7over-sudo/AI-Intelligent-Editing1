import { describe, expect, it } from "vitest";

import {
  applyTransitionPreference,
  applyNarrationTiming,
  createStoryboardPrompt,
  estimateNarrationDuration,
  formatTextOpening,
  getStoryboardDuration,
  splitFirstSentence,
  storyboardSchema,
} from "./storyboard";

describe("scene transition preference", () => {
  it("keeps generated transitions when enabled", () => {
    expect(
      applyTransitionPreference({ type: "DISSOLVE", duration: 0.45 }, true),
    ).toEqual({ type: "DISSOLVE", duration: 0.45 });
  });

  it("uses a zero-duration cut when transitions are disabled", () => {
    expect(
      applyTransitionPreference({ type: "PUSH", duration: 0.6 }, false),
    ).toEqual({ type: "CUT", duration: 0 });
  });
});

const scene = {
  narration: "先放下手机，然后专心完成眼前的一件事。",
  subtitle: "一次只做一件事",
  estimatedDuration: 99,
  visualPrompt: "A minimalist stick figure focuses on one document.",
  templateElements: [
    {
      assetId: "person-thinking" as const,
      x: 0.4,
      y: 0.55,
      scale: 1,
      rotation: 0,
      emphasis: false,
      label: "",
    },
  ],
  animation: {
    type: "ZOOM" as const,
    direction: "IN" as const,
    intensity: 0.35,
  },
  transition: { type: "DISSOLVE" as const, duration: 0.4 },
  soundEffects: [],
};

const storyboard = storyboardSchema.parse({
  title: "专注",
  summary: "用行动找回专注",
  scenes: [scene, { ...scene, narration: "完成以后，再开始下一件事。" }],
});

describe("narration driven timing", () => {
  it("derives duration from narration length instead of model estimates", () => {
    const timed = applyNarrationTiming(storyboard);
    expect(timed.scenes[0]?.estimatedDuration).toBe(
      estimateNarrationDuration(scene.narration),
    );
    expect(timed.scenes[0]?.estimatedDuration).not.toBe(99);
    expect(getStoryboardDuration(timed)).toBeGreaterThan(3);
  });

  it("assigns more time to longer copy", () => {
    expect(estimateNarrationDuration("这是一句短文案。")).toBeLessThan(
      estimateNarrationDuration(
        "这是一段明显更长的旁白文案，它包含更多信息，也需要更多朗读时间。",
      ),
    );
  });
});

describe("first sentence split", () => {
  it("splits the opening sentence from the remaining copy", () => {
    expect(
      splitFirstSentence("第一句开场。第二句正文。第三句收尾。"),
    ).toEqual({
      firstSentence: "第一句开场。",
      remainingText: "第二句正文。第三句收尾。",
    });
  });

  it("returns the whole text when there is only one sentence", () => {
    expect(splitFirstSentence("只有一句文案")).toEqual({
      firstSentence: "只有一句文案",
      remainingText: "",
    });
  });
});

describe("text opening scene", () => {
  it("accepts a text-only opening scene without visual content", () => {
    const opening = {
      ...scene,
      narration: "第一句开场。",
      visualPrompt: "",
      templateElements: [],
      isTextOpening: true,
    };
    expect(() =>
      storyboardSchema.parse({
        title: "开场",
        summary: "开场摘要",
        scenes: [opening],
      }),
    ).not.toThrow();
  });

  it("rejects visual scenes that are missing a prompt or elements", () => {
    expect(() =>
      storyboardSchema.parse({
        title: "开场",
        summary: "开场摘要",
        scenes: [{ ...scene, visualPrompt: "", templateElements: [] }],
      }),
    ).toThrow();
  });
});

describe("text opening formatting", () => {
  it("strips punctuation and keeps at most two lines", () => {
    const formatted = formatTextOpening(
      "很多人一遇到问题，第一反应不是去解决问题，而是先解决自己。",
    );
    expect(formatted.singleLine).not.toContain("，");
    expect(formatted.singleLine).not.toContain("。");
    expect(formatted.lines.length).toBeLessThanOrEqual(2);
  });

  it("keeps a short opening on one line", () => {
    expect(formatTextOpening("开工。").displayText).toBe("开工");
  });
});

describe("storyboard prompt", () => {
  it("asks for natural copy-driven length without a target duration", () => {
    const prompt = createStoryboardPrompt({
      sourceText: "为什么番茄钟有效？",
      sourceKind: "TOPIC",
      aspectRatio: "PORTRAIT",
      language: "zh-CN",
      accentColor: "#FF5C35",
      imagePrompt: "黑白极简火柴人插画，统一角色，干净背景",
    });
    expect(prompt).toContain("natural video length");
    expect(prompt).toContain("exceeds about 32 CJK characters");
    expect(prompt).toContain("semantic clause boundaries");
    expect(prompt).toContain(
      "Subtitle text must preserve narration punctuation",
    );
    expect(prompt).toContain("roughly 12 to 32 CJK characters per scene");
    expect(prompt).toContain("User image prompt");
    expect(prompt).not.toContain("Target duration");
    expect(prompt).toContain("为什么番茄钟有效？");
  });
});
