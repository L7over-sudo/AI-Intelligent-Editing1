import { describe, expect, it } from "vitest";

import {
  coverCopySchema,
  coverTemplateSelectionSchema,
  normalizeCoverCopy,
} from "./cover-template";

describe("cover template shared contract", () => {
  it("normalizes generated copy to the cover limits", () => {
    const copy = normalizeCoverCopy({
      title: "公司最大的成本不是员工工资",
      subtitle: "真正拖垮公司的不是工资，而是管理层",
      sourceText: "公司最大的成本不是员工工资，而是管理层。",
    });

    expect(copy).toEqual({
      title: "成本真相",
      subtitle: "管理问题正在拖垮公司",
    });
    expect(Array.from(copy.title)).toHaveLength(4);
    expect(Array.from(copy.subtitle).length).toBeGreaterThanOrEqual(10);
    expect(Array.from(copy.subtitle).length).toBeLessThanOrEqual(12);
  });

  it("derives a meaningful account-card copy instead of slicing a question lead-in", () => {
    const copy = normalizeCoverCopy({
      sourceText:
        "你有没有发现，越重要的事情，我们越容易拖延？这并不是因为懒，而是大脑在回避不确定性。",
    });

    expect(copy.title).toBe("重要拖延");
    expect(copy.subtitle).toBe("越重要的事越容易拖延");
    expect(Array.from(copy.title)).toHaveLength(4);
    expect(Array.from(copy.subtitle).length).toBeGreaterThanOrEqual(10);
    expect(Array.from(copy.subtitle).length).toBeLessThanOrEqual(12);
  });

  it("keeps complete model wording instead of cutting through words", () => {
    const copy = normalizeCoverCopy({
      title: "职场发疯",
      subtitle: "你的共鸣来自长期压抑后的集中爆发",
      sourceText: "年轻人在职场长期压抑后集中爆发。",
    });

    expect(copy).toEqual({
      title: "职场发疯",
      subtitle: "看懂事情背后的真正原因",
    });
  });

  it("turns mixed digit copy into a complete four-character title", () => {
    expect(
      normalizeCoverCopy({
        title: "00后员工",
        subtitle: "年轻员工正在重写职场规则",
        sourceText: "00后员工正在用自己的方式重新定义职场规则。",
      }),
    ).toEqual({
      title: "职场新规",
      subtitle: "年轻员工正在重写职场规则",
    });
  });

  it("summarizes the current workplace-outburst copy without slicing its opening", () => {
    expect(
      normalizeCoverCopy({
        sourceText:
          "00后员工怒怼老板引发职场共鸣。真正成熟的职场表达，不是隐忍到极限后的爆发，而是更早清晰地表达边界。",
      }),
    ).toEqual({
      title: "表达边界",
      subtitle: "真正成熟的表达要趁早",
    });
  });

  it("keeps storyboard cover copy valid for a speaking-skills article", () => {
    const copy = normalizeCoverCopy({
      sourceText:
        "会说话是优势，会回话才是职场本事。真正成熟的人懂得回应。",
    });

    expect(copy).toEqual({
      title: "回话本事",
      subtitle: "会回话才是职场真本事",
    });
    expect(Array.from(copy.title)).toHaveLength(4);
    expect(Array.from(copy.subtitle).length).toBeGreaterThanOrEqual(10);
    expect(Array.from(copy.subtitle).length).toBeLessThanOrEqual(12);
  });

  it("rejects cover copy whose subtitle is shorter than ten characters", () => {
    expect(
      coverCopySchema.safeParse({
        title: "回话本事",
        subtitle: "会回话才是本事",
      }).success,
    ).toBe(false);
    expect(
      coverCopySchema.safeParse({
        title: "回话本事",
        subtitle: "会回话才是职场真本事",
      }).success,
    ).toBe(true);
  });

  it("accepts only the trusted current template id", () => {
    expect(
      coverTemplateSelectionSchema.safeParse({
        id: "saved-cover-1",
        name: "DY",
        templateId: "black-white-opinion",
        templateName: "账号名片",
        cover: {
          title: "高管成本",
          subtitle: "工资不是最大成本",
          account: "@账号",
          avatarUrl: "",
        },
      }).success,
    ).toBe(true);
    expect(
      coverTemplateSelectionSchema.safeParse({
        id: "saved-cover-1",
        name: "DY",
        templateId: "untrusted-template",
        templateName: "未知模板",
        cover: {
          title: "高管成本",
          subtitle: "工资不是最大成本",
          account: "@账号",
          avatarUrl: "",
        },
      }).success,
    ).toBe(false);
  });

  it("accepts the official character template and its optional footer", () => {
    expect(
      coverTemplateSelectionSchema.safeParse({
        id: "saved-cover-character",
        name: "职场人物",
        templateId: "monochrome-career-character",
        templateName: "黑白人物职场",
        cover: {
          title: "职场真相",
          subtitle: "公司价值观背后的职场真相",
          account: "认知觉醒｜人生感悟｜思维升级",
          footer: "认知觉醒｜人生感悟｜思维升级",
          avatarUrl: "",
        },
      }).success,
    ).toBe(true);
  });
});
