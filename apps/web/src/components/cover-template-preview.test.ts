import { describe, expect, it } from "vitest";

import {
  characterCoverTemplateId,
  coverDownloadFileName,
  coverTextSize,
  defaultCharacterCoverTemplate,
  defaultCoverTemplate,
  officialCoverTemplates,
  parseSavedCoverTemplate,
  parseSavedCoverTemplates,
  parseStoredCoverTemplate,
} from "./cover-template";

describe("cover template", () => {
  it("accepts legacy stored data and derives the blurred layer from title", () => {
    expect(
      parseStoredCoverTemplate(
        JSON.stringify({
          backgroundText: "旧的独立模糊标题",
          title: "旧标题",
          subtitle: "旧副标题",
          account: "@旧账号",
          avatarUrl: "",
        }),
      ),
    ).toEqual({
      ...defaultCoverTemplate,
      title: "旧标题",
      subtitle: "旧副标题",
      account: "@旧账号",
    });
  });

  it("falls back safely when stored JSON does not match the schema", () => {
    expect(parseStoredCoverTemplate('{"avatarUrl":"https://bad.example"}')).toEqual(
      defaultCoverTemplate,
    );
    expect(parseStoredCoverTemplate("not-json")).toEqual(defaultCoverTemplate);
  });

  it("only treats explicitly saved data as a personal template", () => {
    expect(
      parseSavedCoverTemplate(JSON.stringify({ title: "未保存的草稿" })),
    ).toBeNull();
    expect(
      parseSavedCoverTemplate(
        JSON.stringify({
          saved: true,
          templateName: "DY",
          title: "高管成本",
          subtitle: "真正拖垮公司的不是工资",
          account: "@杰妍社进化论",
          avatarUrl: "",
        }),
      ),
    ).toEqual({
      id: "legacy-cover-template",
      name: "DY",
      templateId: "black-white-opinion",
      templateName: "账号名片",
      cover: {
        title: "高管成本",
        subtitle: "真正拖垮公司的不是工资",
        account: "@杰妍社进化论",
        footer: "",
        avatarUrl: "",
      },
    });
  });

  it("keeps the custom name separate from the template type", () => {
    expect(
      parseSavedCoverTemplates(
        JSON.stringify([
          { id: "template-1", name: "DY", cover: defaultCoverTemplate },
        ]),
      ),
    ).toEqual([
      {
        id: "template-1",
        name: "DY",
        templateId: "black-white-opinion",
        templateName: "账号名片",
        cover: defaultCoverTemplate,
      },
    ]);
  });

  it("includes the editable monochrome character template", () => {
    expect(officialCoverTemplates).toContainEqual({
      id: characterCoverTemplateId,
      name: "黑白人物职场",
      defaultCover: defaultCharacterCoverTemplate,
    });
    expect(defaultCharacterCoverTemplate).toMatchObject({
      account: "少内耗｜多思考｜快成长",
      title: "性骚扰 裁员与女性困境",
      subtitle: "公司价值观背后的职场真相",
      footer: "认知觉醒｜人生感悟｜思维升级",
    });
  });

  it("preserves every editable text field in the character template", () => {
    expect(
      parseSavedCoverTemplates(
        JSON.stringify([
          {
            id: "character-template",
            name: "职场封面",
            templateId: characterCoverTemplateId,
            templateName: "黑白人物职场",
            cover: defaultCharacterCoverTemplate,
          },
        ]),
      )[0]?.cover,
    ).toEqual(defaultCharacterCoverTemplate);
  });

  it("shrinks long editable text but keeps the preferred size for short text", () => {
    expect(coverTextSize("上班崩溃", 12.2, 89)).toBe("12.20cqw");
    expect(coverTextSize("这是一个明显更长的主标题", 12.2, 89)).toBe("7.42cqw");
  });

  it("creates a safe PNG file name from the editable title", () => {
    expect(coverDownloadFileName(" 上班/崩溃:*? ")).toBe("上班崩溃.png");
    expect(coverDownloadFileName("   ")).toBe("封面.png");
  });
});
