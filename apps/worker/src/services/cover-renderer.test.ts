import { describe, expect, it } from "vitest";

import sharp from "sharp";

import { coverRenderLayout, renderCoverPng } from "./cover-renderer";

describe("cover renderer", () => {
  it("keeps the accepted reference positions for portrait and landscape", () => {
    expect(coverRenderLayout.portrait).toMatchObject({
      titleX: 384,
      blurX: 404,
      blurY: 196,
      titleY: 378,
      titleFontSize: 110,
      subtitleY: 464,
      subtitleFontSize: 58,
      dashY: 527,
      accountY: 604,
      accountFontSize: 35.5,
      avatarX: 614,
      avatarY: 600,
      avatarRadius: 100,
    });
    expect(coverRenderLayout.landscape).toMatchObject({
      titleX: 640,
      titleY: 204,
      titleFontSize: 182,
      foregroundTop: 56,
      subtitleX: 638,
      subtitleY: 349,
      subtitleFontSize: 96,
      dashY: 456,
      dashStrokeWidth: 4,
      accountY: 582,
      accountFontSize: 59,
      avatarX: 1022,
      avatarY: 580,
      avatarRadius: 166,
    });
  });

  it("renders the selected account-card template as a 3:4 PNG", async () => {
    const bytes = await renderCoverPng({
      template: {
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
      },
      copy: { title: "高管成本", subtitle: "工资不是最大成本" },
    });

    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(768);
    expect(metadata.height).toBe(1024);
  });

  it("renders a 16:9 download variant from the same template", async () => {
    const bytes = await renderCoverPng({
      template: {
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
      },
      copy: { title: "高管成本", subtitle: "工资不是最大成本" },
      ratio: "16:9",
    });

    const metadata = await sharp(bytes).metadata();
    expect(metadata.width).toBe(1280);
    expect(metadata.height).toBe(720);
  });

  it("keeps the landscape header black without a blurred title layer", async () => {
    const bytes = await renderCoverPng({
      template: {
        id: "saved-cover-1",
        name: "DY",
        templateId: "black-white-opinion",
        templateName: "账号名片",
        cover: {
          title: "上班崩溃",
          subtitle: "没边界的工作最让人崩溃",
          account: "@账号",
          avatarUrl: "",
        },
      },
      copy: { title: "上班崩溃", subtitle: "没边界的工作最让人崩溃" },
      ratio: "16:9",
    });

    const topPixels = await sharp(bytes)
      .extract({ left: 420, top: 0, width: 440, height: 45 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect(topPixels.every((value) => value === 0)).toBe(true);
  });

  it("renders the official character template with replaceable text", async () => {
    const bytes = await renderCoverPng({
      template: {
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
      },
      copy: { title: "测试标题", subtitle: "测试副标题" },
    });

    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(768);
    expect(metadata.height).toBe(1024);
  });
});
