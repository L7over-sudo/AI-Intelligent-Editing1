import { describe, expect, it } from "vitest";

import {
  alignTextToDuration,
  cuesToAss,
  cuesToSrt,
  formatAssTime,
  formatSrtTime,
  splitSubtitleText,
  splitTextAtPunctuation,
} from "./subtitles";

describe("subtitle formats", () => {
  const cues = [
    {
      startMs: 0,
      endMs: 1_250,
      text: "现在开始",
      translation: "Start now",
      highlighted: ["开始"],
    },
    { startMs: 1_250, endMs: 3_500, text: "只做一件事" },
  ];

  it("formats SRT timing and bilingual text", () => {
    const srt = cuesToSrt(cues);
    expect(formatSrtTime(3_661_007)).toBe("01:01:01,007");
    expect(srt).toContain("00:00:00,000 --> 00:00:01,250");
    expect(srt).toContain("现在开始\nStart now");
  });

  it("formats ASS style, position, and keyword highlight", () => {
    const ass = cuesToAss(
      cues,
      {
        fontName: "Noto Sans CJK SC",
        fontSize: 64,
        primaryColor: "#FFFFFF",
        accentColor: "#FF5C35",
        outline: true,
        shadow: true,
        position: "BOTTOM",
        bilingual: true,
      },
      { width: 1080, height: 1920 },
    );
    expect(formatAssTime(1_250)).toBe("0:00:01.25");
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("WrapStyle: 2");
    expect(ass).toContain("\\c&H00355CFF");
    expect(ass).toContain("Start now");
  });

  it("applies an extracted local template style to ASS output", () => {
    const ass = cuesToAss(
      cues,
      {
        fontName: "Microsoft YaHei",
        fontSize: 48,
        fontWeight: 900,
        italic: true,
        primaryColor: "#FFEE00",
        accentColor: "#FF5C35",
        backgroundColor: "#224466",
        outlineColor: "#111111",
        outlineWidth: 3,
        shadowColor: "#000000",
        outline: true,
        shadow: true,
        position: "TOP",
        bilingual: false,
      },
      { width: 1920, height: 1080 },
    );

    expect(ass).toContain(
      "Style: Default,Microsoft YaHei,48,&H0000EEFF,&H0000EEFF,&H00111111,&H00664422,-1,-1,0,0,100,100,0,0,3,3,2,8",
    );
  });
});

describe("alignTextToDuration", () => {
  it("creates contiguous cues that fill the duration", () => {
    const cues = alignTextToDuration("先关通知。再开始工作！", 4_000);
    expect(cues).toHaveLength(2);
    expect(cues[0]?.startMs).toBe(0);
    expect(cues[0]?.endMs).toBe(cues[1]?.startMs);
    expect(cues[1]?.endMs).toBe(4_000);
  });
});
describe("splitSubtitleText", () => {
  it("creates one punctuation-free cue for every punctuation-delimited clause", () => {
    expect(
      splitSubtitleText(
        "这是一段特别长的字幕，需要在逗号附近拆开，并且不能让单条字幕占满整个画面。",
        12,
      ),
    ).toEqual([
      "这是一段特别长的字幕",
      "需要在逗号附近拆开",
      "并且不能让单条字幕占满整个画面",
    ]);
  });

  it("does not hard-wrap text that has no punctuation", () => {
    expect(splitSubtitleText("一二三四五六七八九十", 4)).toEqual([
      "一二三四五六七八九十",
    ]);
  });

  it("recognizes Chinese and English punctuation plus line breaks", () => {
    expect(splitTextAtPunctuation("真的吗？！当然;继续：完成\n下一行")).toEqual(
      ["真的吗？！", "当然;", "继续：", "完成", "下一行"],
    );
  });

  it("removes punctuation after splitting", () => {
    const cues = alignTextToDuration(
      "字幕不要太长，而且不要保留标点符号。这样观看更清楚！",
      5_000,
    );

    expect(cues.map((cue) => cue.text)).toEqual([
      "字幕不要太长",
      "而且不要保留标点符号",
      "这样观看更清楚",
    ]);
    expect(cues.every((cue) => !/[\p{P}]/u.test(cue.text))).toBe(true);
  });
});
