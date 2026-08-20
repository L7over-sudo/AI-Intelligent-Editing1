import { describe, expect, it } from "vitest";

import {
  buildImpactCaptionText,
  buildVisibleImpactCaptionLines,
  impactCaptionTone,
  splitImpactCaptionLines,
} from "./impact-captions";

describe("impact caption template", () => {
  it("builds concise multi-line copy from subtitle cues", () => {
    expect(
      splitImpactCaptionLines(
        buildImpactCaptionText(["但你知道吗", "很多答案其实你早就知道了"]),
      ),
    ).toEqual(["但你知道吗", "很多答案其实你早就知道了"]);
  });

  it("clips dense copy to three readable lines", () => {
    const lines = splitImpactCaptionLines(
      "这是一段非常长而且需要被限制的大字字幕内容用于测试并且还要继续补充更多文字",
    );
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => Array.from(line).length <= 12)).toBe(true);
    expect(lines.at(-1)?.endsWith("…")).toBe(true);
  });

  it("reveals every cue in order and keeps earlier lines on screen", () => {
    const cues = [
      { startMs: 0, text: "你有没有发现" },
      { startMs: 1_150, text: "越是拼命想找工作的人" },
      { startMs: 2_300, text: "越找不到方向" },
    ];

    expect(buildVisibleImpactCaptionLines(cues, 900).map((line) => line.text)).toEqual([
      "你有没有发现",
    ]);
    expect(
      buildVisibleImpactCaptionLines(cues, 1_800).map((line) => line.text),
    ).toEqual(["你有没有发现", "越是拼命想找工作的人"]);
    expect(
      buildVisibleImpactCaptionLines(cues, 2_600).map((line) => line.text),
    ).toEqual(["你有没有发现", "越是拼命想找工作的人", "越找不到方向"]);
  });

  it("keeps the latest four lines while still giving every line a reveal time", () => {
    const lines = buildVisibleImpactCaptionLines(
      [
        { startMs: 0, text: "第一句" },
        { startMs: 500, text: "第二句" },
        { startMs: 1_000, text: "第三句" },
        { startMs: 1_500, text: "第四句" },
        { startMs: 2_000, text: "第五句" },
      ],
      2_500,
    );
    expect(lines.map((line) => line.text)).toEqual([
      "第二句",
      "第三句",
      "第四句",
      "第五句",
    ]);
    expect(lines.map((line) => line.startMs)).toEqual([500, 1_000, 1_500, 2_000]);
  });

  it("uses red for hook lines and yellow or white for supporting lines", () => {
    expect(impactCaptionTone("但你知道吗", 0)).toBe("RED");
    expect(impactCaptionTone("很多答案", 0)).toBe("YELLOW");
    expect(impactCaptionTone("真正的答案早就在你身上", 1)).toBe("YELLOW");
    expect(impactCaptionTone("越努力越找不到方向", 1)).toBe("RED");
    expect(impactCaptionTone("补充说明", 2)).toBe("WHITE");
  });
});
