import { describe, expect, it } from "vitest";

import {
  alignTextToDuration,
  anticipateSubtitleCueStarts,
  cuesToAss,
  cuesToSrt,
  extendCueTails,
  extendFinalCueToDuration,
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

describe("extendFinalCueToDuration", () => {
  it("extends only the final cue to the narration end", () => {
    const cues = [
      { startMs: 0, endMs: 1_000, text: "第一句" },
      { startMs: 1_200, endMs: 2_000, text: "第二句" },
    ];
    const result = extendFinalCueToDuration(cues, 2_500);
    expect(result[0]).toEqual({ startMs: 0, endMs: 1_000, text: "第一句" });
    expect(result[1]).toEqual({ startMs: 1_200, endMs: 2_500, text: "第二句" });
    expect(cues[1]?.endMs).toBe(2_000);
  });

  it("never shortens an existing end time", () => {
    const cues = [{ startMs: 0, endMs: 3_000, text: "结尾" }];
    expect(extendFinalCueToDuration(cues, 2_000)[0]?.endMs).toBe(3_000);
  });

  it("returns an empty list when there are no cues", () => {
    expect(extendFinalCueToDuration([], 1_000)).toEqual([]);
  });

  it("keeps cue copies when the duration is not usable", () => {
    const cues = [{ startMs: 0, endMs: 500, text: "短句" }];
    expect(extendFinalCueToDuration(cues, 0)).toEqual([
      { startMs: 0, endMs: 500, text: "短句" },
    ]);
  });
});

describe("extendCueTails", () => {
  it("protects audible tails without overlapping the next subtitle", () => {
    expect(
      extendCueTails(
        [
          { startMs: 0, endMs: 1_000, text: "也不是见谁都笑" },
          { startMs: 1_370, endMs: 2_700, text: "什么都说好的那个" },
        ],
        3_100,
      ),
    ).toEqual([
      { startMs: 0, endMs: 1_370, text: "也不是见谁都笑" },
      { startMs: 1_370, endMs: 3_100, text: "什么都说好的那个" },
    ]);
  });

  it("caps a protected tail at the next cue start", () => {
    expect(
      extendCueTails(
        [
          { startMs: 0, endMs: 1_000, text: "上一句" },
          { startMs: 1_100, endMs: 1_800, text: "下一句" },
        ],
        2_000,
      )[0]?.endMs,
    ).toBe(1_100);
  });
});

describe("anticipateSubtitleCueStarts", () => {
  it("shows every following card before speech and keeps the cards contiguous", () => {
    expect(
      anticipateSubtitleCueStarts(
        [
          { startMs: 0, endMs: 1_370, text: "上一句" },
          { startMs: 1_370, endMs: 2_700, text: "下一句" },
          { startMs: 2_700, endMs: 3_100, text: "结尾" },
        ],
        3_100,
      ),
    ).toEqual([
      { startMs: 0, endMs: 950, text: "上一句" },
      { startMs: 950, endMs: 2_280, text: "下一句" },
      { startMs: 2_280, endMs: 3_100, text: "结尾" },
    ]);
  });

  it("caps the lead for a short first card", () => {
    expect(
      anticipateSubtitleCueStarts(
        [
          { startMs: 0, endMs: 575, text: "饭桌上也是一样" },
          { startMs: 575, endMs: 1_575, text: "酒过三巡" },
        ],
        1_575,
      ),
    ).toEqual([
      { startMs: 0, endMs: 345, text: "饭桌上也是一样" },
      { startMs: 345, endMs: 1_575, text: "酒过三巡" },
    ]);
  });

  it("does not move the first card after zero", () => {
    expect(
      anticipateSubtitleCueStarts(
        [{ startMs: 240, endMs: 1_000, text: "开头" }],
        1_000,
      )[0],
    ).toEqual({ startMs: 0, endMs: 1_000, text: "开头" });
  });
});

describe("splitSubtitleText", () => {
  it("splits only at punctuation when the character limit is disabled", () => {
    expect(
      splitSubtitleText("有的人是在守住工作和生活的边界", null),
    ).toEqual(["有的人是在守住工作和生活的边界"]);
    expect(
      splitSubtitleText(
        "有的人是在守住工作和生活的边界，有的人却是在挑战团队协作的基本规则。",
        null,
      ),
    ).toEqual([
      "有的人是在守住工作和生活的边界",
      "有的人却是在挑战团队协作的基本规则",
    ]);
  });

  it("creates one punctuation-free cue for every punctuation-delimited clause", () => {
    expect(
      splitSubtitleText(
        "这是一段特别长的字幕，需要在逗号附近拆开，并且不能让单条字幕占满整个画面。",
        12,
      ),
    ).toEqual([
      "这是一段特别长的字幕",
      "需要在逗号附近拆开",
      "并且不能让单条字幕占满",
      "整个画面",
    ]);
  });

  it("turns an overlong clause into consecutive single-line cues", () => {
    expect(splitSubtitleText("一二三四五六七八九十", 4)).toEqual([
      "一二三四",
      "五六七八",
      "九十",
    ]);
  });

  it("keeps every generated cue within the configured single-line limit", () => {
    const cues = splitSubtitleText(
      "公司却在为一批高高在上却不解决问题的管理层支付着远超他们贡献的成本。",
      12,
    );

    expect(cues).toEqual([
      "公司却在为一批高高在上",
      "却不解决问题的管理层",
      "支付着远超他们贡献的成本",
    ]);
    expect(cues.every((cue) => Array.from(cue).length <= 12)).toBe(true);
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

  it("merges one-to-three-character fragments into a neighboring cue", () => {
    expect(
      splitSubtitleText(
        "当然，规则也不是只约束年轻人。一个团队如果总是默认早到、晚走、随时回复消息才算认真。",
        12,
      ),
    ).toEqual([
      "当然规则也不是",
      "只约束年轻人",
      "一个团队如果总是默认早到",
      "晚走随时回复消息才算认真",
    ]);
  });
});
