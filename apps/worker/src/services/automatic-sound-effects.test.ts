import { describe, expect, it } from "vitest";

import { storyboardSchema } from "@stickmotion/shared";

import {
  applyAutomaticSoundEffects,
  soundEffectOffsetMs,
} from "./automatic-sound-effects";

function storyboard(narrations: string[]) {
  return storyboardSchema.parse({
    title: "测试",
    summary: "自动音效测试",
    scenes: narrations.map((narration) => ({
      narration,
      subtitle: narration,
      estimatedDuration: 3,
      visualPrompt: "A clear visual scene for testing.",
      templateElements: [
        {
          assetId: "person-standing",
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
          emphasis: true,
          label: "",
        },
      ],
      animation: { type: "FADE", direction: "IN", intensity: 0.3 },
      transition: { type: "FADE", duration: 0.4 },
      soundEffects: [],
    })),
  });
}

describe("automatic sound effects", () => {
  it("adds sparse semantic effects without adding one to every scene", () => {
    const result = applyAutomaticSoundEffects(
      storyboard([
        "欢迎开始。",
        "这是一段普通说明。",
        "点击保存按钮。",
        "继续介绍内容。",
        "最后成功完成。",
      ]),
    );

    expect(result.scenes[0]?.soundEffects[0]?.tag).toBe("pop");
    expect(result.scenes[1]?.soundEffects).toEqual([]);
    expect(result.scenes[2]?.soundEffects[0]?.tag).toBe("click");
    expect(result.scenes[3]?.soundEffects).toEqual([]);
    expect(result.scenes[4]?.soundEffects[0]?.tag).toBe("success");
  });

  it("preserves effects already selected by the storyboard", () => {
    const input = storyboard(["第一幕。", "第二幕。"]);
    input.scenes[0]!.soundEffects = [
      { tag: "impact", offsetRatio: 0.5, gainDb: -11 },
    ];

    const result = applyAutomaticSoundEffects(input);

    expect(result.scenes[0]?.soundEffects).toEqual(
      input.scenes[0]?.soundEffects,
    );
    expect(result.scenes[1]?.soundEffects).toEqual([]);
  });

  it.each([
    ["糟糕，网络连接突然中断了。", "error"],
    ["任务终于搞定并顺利交付。", "success"],
    ["请回复邮件并填写这份表格。", "typing"],
    ["距离截止时间只剩十分钟。", "clock"],
    ["勾选以后点击提交按钮。", "click"],
    ["记住，这才是最重要的核心结论。", "impact"],
    ["你真的知道答案吗？", "pop"],
    ["镜头一转，我们来到下一个场景。", "whoosh"],
  ] as const)("matches %s to %s", (narration, expectedTag) => {
    const result = applyAutomaticSoundEffects(
      storyboard(["开场。", "普通说明。", narration]),
    );

    expect(result.scenes[2]?.soundEffects[0]?.tag).toBe(expectedTag);
  });

  it("uses punctuation as a fallback for questions and exclamations", () => {
    const question = applyAutomaticSoundEffects(
      storyboard(["开场。", "普通说明。", "这究竟意味着什么？"]),
    );
    const exclamation = applyAutomaticSoundEffects(
      storyboard(["开场。", "普通说明。", "这也太意外了！"]),
    );

    expect(question.scenes[2]?.soundEffects[0]?.tag).toBe("question");
    expect(exclamation.scenes[2]?.soundEffects[0]?.tag).toBe("surprise");
  });

  it("adds a transition effect when a plain sequence has no semantic match", () => {
    const result = applyAutomaticSoundEffects(
      storyboard(["开场。", "普通说明。", "继续说明。", "补充说明。"]),
    );

    expect(result.scenes[0]?.soundEffects[0]?.tag).toBe("pop");
    expect(result.scenes[2]?.soundEffects[0]?.tag).toBe("whoosh");
  });

  it("keeps placements inside the visual scene duration", () => {
    expect(
      soundEffectOffsetMs({ tag: "success", offsetRatio: 1, gainDb: -12 }, 2),
    ).toBe(1_950);
  });

  it.each([
    ["观众响起热烈掌声", "applause"],
    ["他说完以后大家都哈哈大笑", "laughter"],
    ["手机突然收到一条新消息通知", "notification"],
    ["先把食材切菜下锅翻炒", "cooking"],
    ["他紧张得能听见自己的心跳", "tension"],
    ["镜头来到未来世界的机器人飞船", "sci_fi"],
  ] as const)("matches expanded local-library rule %s to %s", (text, tag) => {
    const result = applyAutomaticSoundEffects(
      storyboard(["普通开场", "普通说明", text]),
    );
    expect(result.scenes[2]?.soundEffects[0]?.tag).toBe(tag);
  });
});
