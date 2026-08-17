import { describe, expect, it } from "vitest";

import {
  leadingSilenceToTrim,
  partitionContinuousNarration,
  sourceCueRanges,
} from "./continuous-voice";

describe("leadingSilenceToTrim", () => {
  it("keeps a short, consistent breath before each visual scene", () => {
    expect(leadingSilenceToTrim(260, 1_000)).toBe(180);
    expect(leadingSilenceToTrim(50, 1_000)).toBe(0);
    expect(leadingSilenceToTrim(1_200, 1_000)).toBe(920);
  });
});

describe("partitionContinuousNarration", () => {
  it("partitions one continuous recording without adding gaps", () => {
    const parts = partitionContinuousNarration({
      durationMs: 2_000,
      sceneTexts: ["这是第一段，", "这是第二段。"],
      cues: [
        { startMs: 100, endMs: 700, text: "这是第一段" },
        { startMs: 900, endMs: 1_700, text: "这是第二段" },
      ],
    });

    expect(parts.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 900],
      [900, 2_000],
    ]);
    expect(parts[1]?.cues).toEqual([
      { startMs: 0, endMs: 800, text: "这是第二段" },
    ]);
  });

  it("keeps leading quiet audio before the next phrase when requested", () => {
    const parts = partitionContinuousNarration({
      durationMs: 2_000,
      sceneTexts: ["first,", "second."],
      cues: [
        { startMs: 100, endMs: 700, text: "first" },
        { startMs: 900, endMs: 1_700, text: "second" },
      ],
      retainedLeadingMs: 80,
    });

    expect(parts.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 820],
      [820, 2_000],
    ]);
    expect(parts[1]?.cues[0]?.startMs).toBe(80);
  });

  it("does not cut the previous cue when the inter-phrase gap is shorter than the retained lead", () => {
    const parts = partitionContinuousNarration({
      durationMs: 2_000,
      sceneTexts: ["first,", "second."],
      cues: [
        { startMs: 100, endMs: 870, text: "first" },
        { startMs: 900, endMs: 1_700, text: "second" },
      ],
      retainedLeadingMs: 80,
    });

    expect(parts.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 870],
      [870, 2_000],
    ]);
    expect(parts[1]?.cues[0]?.startMs).toBe(30);
  });

  it("keeps multiple subtitle cues assigned to their visual scene", () => {
    const parts = partitionContinuousNarration({
      durationMs: 2_400,
      sceneTexts: ["先准备，再开始，", "最后完成。"],
      cues: [
        { startMs: 100, endMs: 500, text: "先准备" },
        { startMs: 600, endMs: 1_100, text: "再开始" },
        { startMs: 1_300, endMs: 2_100, text: "最后完成" },
      ],
    });

    expect(parts[0]?.cues.map((cue) => cue.text)).toEqual(["先准备", "再开始"]);
    expect(parts[1]?.cues.map((cue) => cue.text)).toEqual(["最后完成"]);
    expect(parts[0]?.endMs).toBe(parts[1]?.startMs);
  });

  it("partitions from the original source text instead of a joined copy", () => {
    const parts = partitionContinuousNarration({
      durationMs: 2_400,
      sceneTexts: ["先准备，", "再开始，", "最后完成。"],
      cues: [
        { startMs: 100, endMs: 500, text: "先准备" },
        { startMs: 600, endMs: 1_100, text: "再开始" },
        { startMs: 1_300, endMs: 2_100, text: "最后完成" },
      ],
      sourceText: "先准备，再开始，最后完成。",
    });

    expect(parts.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 600],
      [600, 1_300],
      [1_300, 2_400],
    ]);
  });

  it("splits a subtitle cue that crosses a visual scene boundary", () => {
    const parts = partitionContinuousNarration({
      durationMs: 1_000,
      sceneTexts: ["first", "second"],
      cues: [{ startMs: 0, endMs: 1_000, text: "firstsecond" }],
      sourceText: "firstsecond",
    });

    expect(parts.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 455],
      [455, 1_000],
    ]);
    expect(parts.flatMap(({ cues }) => cues.map((cue) => cue.text))).toEqual([
      "first",
      "second",
    ]);
    expect(
      parts.flatMap(({ cues }) => cues).every((cue) => cue.endMs > cue.startMs),
    ).toBe(true);
  });

  it("rejects scene text that is not present in the original source", () => {
    expect(() =>
      partitionContinuousNarration({
        durationMs: 1_000,
        sceneTexts: ["第一段。"],
        cues: [{ startMs: 0, endMs: 500, text: "第一段" }],
        sourceText: "另一段内容。",
      }),
    ).toThrow("SCENE_TEXT_NOT_FOUND_IN_SOURCE_TEXT");
  });

  it("maps original-text scene boundaries to subtitle cue ranges", () => {
    expect(
      sourceCueRanges(
        "先准备，再开始，最后完成。",
        ["先准备，", "再开始，", "最后完成。"],
        [
          { startMs: 100, endMs: 500, text: "先准备" },
          { startMs: 600, endMs: 1_100, text: "再开始" },
          { startMs: 1_300, endMs: 2_100, text: "最后完成" },
        ],
      ),
    ).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ]);
  });

  it("rejects a subtitle cue that crosses a visual scene boundary", () => {
    expect(() =>
      sourceCueRanges(
        "甲乙丙丁",
        ["甲乙", "丙丁"],
        [{ startMs: 0, endMs: 1_000, text: "甲乙丙丁" }],
      ),
    ).toThrow("VOICE_CUE_SCENE_BOUNDARY_MISMATCH");
  });

  it("spreads trailing scenes without cues across the remaining audio", () => {
    const parts = partitionContinuousNarration({
      durationMs: 10_000,
      sceneTexts: ["第一段。", "第二段。", "第三段。", "第四段。", "第五段。"],
      cues: [
        { startMs: 0, endMs: 1_000, text: "第一段" },
        { startMs: 1_200, endMs: 2_200, text: "第二段" },
        { startMs: 2_400, endMs: 3_400, text: "第三段" },
      ],
    });

    expect(parts.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 1_200],
      [1_200, 2_400],
      [2_400, 4_933],
      [4_933, 7_467],
      [7_467, 10_000],
    ]);
    expect(parts.slice(3).every((part) => part.endMs - part.startMs >= 1)).toBe(
      true,
    );
  });
});
