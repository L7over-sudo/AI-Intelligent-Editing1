import { describe, expect, it } from "vitest";

import { forceAlignSubtitleCues } from "./forced-subtitle-alignment";

describe("forceAlignSubtitleCues", () => {
  it("uses recognized audio boundaries even when provider cues drift", () => {
    const words = [
      { word: "饭桌上也是一样，", start: 78.82, end: 79.72, probability: 0.99 },
      { word: "酒过三巡，", start: 80, end: 80.7, probability: 0.99 },
    ];
    expect(forceAlignSubtitleCues("饭桌上也是一样，酒过三巡，", words)).toEqual([
      { text: "饭桌上也是一样", startMs: 78_820, endMs: 79_720 },
      { text: "酒过三巡", startMs: 80_000, endMs: 80_700 },
    ]);
  });

  it("keeps cue boundaries inside their visual scenes", () => {
    const sourceText = "甲乙丙丁戊己。庚辛壬癸子丑。";
    const words = [
      { word: sourceText, start: 0.1, end: 1.5, probability: 0.99 },
    ];

    const cues = forceAlignSubtitleCues(sourceText, words, [
      "甲乙丙丁戊己。",
      "庚辛壬癸子丑。",
    ]);

    expect(cues.map((cue) => cue.text)).toEqual([
      "甲乙丙丁戊己",
      "庚辛壬癸子丑",
    ]);
  });

  it("rejects scene text that does not reconstruct the source narration", () => {
    expect(() =>
      forceAlignSubtitleCues(
        "甲乙丙丁。",
        [{ word: "甲乙丙丁", start: 0, end: 1, probability: 0.99 }],
        ["甲乙。", "戊己。"],
      ),
    ).toThrow("WHISPER_ALIGNMENT_SCENE_TEXT_MISMATCH");
  });

  it("rejects a same-length recognition with mostly different text", () => {
    expect(() =>
      forceAlignSubtitleCues(
        "甲乙丙丁戊己庚辛壬癸",
        [
          {
            word: "一二三四五六七八九十",
            start: 0,
            end: 1,
            probability: 0.99,
          },
        ],
      ),
    ).toThrow("WHISPER_ALIGNMENT_COVERAGE_LOW");
  });

  it("rejects a recognition that duplicates a large part of the source", () => {
    const source = "甲乙丙丁戊己庚辛壬癸";
    expect(() =>
      forceAlignSubtitleCues(source, [
        { word: source + source, start: 0, end: 2, probability: 0.99 },
      ]),
    ).toThrow("WHISPER_ALIGNMENT_COVERAGE_LOW");
  });

  it("accepts a small number of recognition substitutions", () => {
    const source = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地";
    const recognized = source.replace("地", "弟");

    expect(
      forceAlignSubtitleCues(source, [
        { word: recognized, start: 0, end: 2.4, probability: 0.99 },
      ]),
    ).toHaveLength(1);
  });
});
