import sharp from "sharp";

import {
  getKnowledgeBoardHeaderDecorationLayout,
  getKnowledgeBoardLayout,
  KNOWLEDGE_BOARD_HEADER_LETTER_SPACING_EM,
  KNOWLEDGE_BOARD_IMAGE_SIZE,
} from "@stickmotion/shared";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fittedHeaderFontSize(
  headerText: string,
  width: number,
  preferredSize: number,
): number {
  const characters = Math.max(1, Array.from(headerText).length);
  const fitted = Math.floor(
    (width * 0.84) /
      (characters * 0.92 +
        Math.max(0, characters - 1) * KNOWLEDGE_BOARD_HEADER_LETTER_SPACING_EM),
  );
  return Math.max(18, Math.min(preferredSize, fitted));
}

function fittedTitleFontSize(
  titleText: string,
  width: number,
  preferredSize: number,
): number {
  const characters = Math.max(1, Array.from(titleText).length);
  const fitted = Math.floor((width * 0.72) / (characters * 0.95));
  return Math.max(28, Math.min(preferredSize, fitted));
}

function verticalTextSvg(input: {
  value: string;
  x: number;
  centerY: number;
  fontSize: number;
  color: string;
}): string {
  const groups = input.value
    .trim()
    .split(/\r?\n\s*\r?\n/u)
    .map((group) => Array.from(group.replace(/\r?\n/gu, "").trim()))
    .filter((group) => group.length > 0);
  if (groups.length === 0) return "";

  const characterStep = input.fontSize * 1.25;
  const groupGap = input.fontSize * 1.15;
  const totalHeight =
    groups.reduce(
      (height, group) => height + Math.max(1, group.length) * characterStep,
      0,
    ) +
    Math.max(0, groups.length - 1) * groupGap;
  let y = input.centerY - totalHeight / 2 + input.fontSize * 0.82;
  const nodes: string[] = [];
  for (const [groupIndex, group] of groups.entries()) {
    for (const character of group) {
      nodes.push(
        `<text x="${input.x}" y="${Math.round(y)}" text-anchor="middle" font-family="DouyinSansBold, Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="${input.fontSize}" font-weight="700" fill="${input.color}">${escapeXml(character)}</text>`,
      );
      y += characterStep;
    }
    if (groupIndex < groups.length - 1) y += groupGap;
  }
  return nodes.join("");
}

export async function createKnowledgeBoardCleanFrame(input: {
  source: Uint8Array;
  width: number;
  height: number;
  sourceIsPrepared?: boolean;
}): Promise<Buffer> {
  const layout = getKnowledgeBoardLayout(input.width, input.height);
  const preparedSource = input.sourceIsPrepared
    ? Buffer.from(input.source)
    : await prepareKnowledgeBoardImage(input.source);
  const image = await sharp(preparedSource)
    .resize(layout.image.width, layout.image.height, {
      fit: "contain",
      position: "centre",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  const background = Buffer.from(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}">`,
      `<rect width="${input.width}" height="${input.height}" fill="#FFFFFF"/>`,
      "</svg>",
    ].join(""),
  );
  return sharp(background)
    .composite([
      {
        input: image,
        left: layout.image.left,
        top: layout.image.top,
      },
    ])
    .png()
    .toBuffer();
}

export async function createKnowledgeBoardFrame(input: {
  source: Uint8Array;
  width: number;
  height: number;
  headerText: string;
  mainTitle?: string;
  leftVerticalText?: string;
  rightVerticalText?: string;
  sourceIsPrepared?: boolean;
}): Promise<Buffer> {
  const layout = getKnowledgeBoardLayout(input.width, input.height);
  const preparedSource = input.sourceIsPrepared
    ? Buffer.from(input.source)
    : await prepareKnowledgeBoardImage(input.source);
  const image = await sharp(preparedSource)
    .resize(layout.image.width, layout.image.height, {
      fit: "contain",
      position: "centre",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  const headerFontSize = fittedHeaderFontSize(
    input.headerText,
    input.width,
    layout.header.fontSize,
  );
  const titleText = input.mainTitle?.trim() ?? "";
  const titleFontSize = fittedTitleFontSize(
    titleText,
    input.width,
    layout.title.fontSize,
  );
  const headerDecoration = getKnowledgeBoardHeaderDecorationLayout(
    input.width,
    input.headerText,
    headerFontSize,
  );
  const dividerHeight = Math.max(3, Math.round(input.height * 0.0025));
  const dashHeight = Math.max(2, Math.round(input.height * 0.0025));
  const dashY = Math.round(layout.header.top + layout.header.height * 0.5);
  const sideTextFontSize = Math.max(16, Math.round(input.height * 0.028));
  const background = Buffer.from(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}">`,
      `<rect width="${input.width}" height="${input.height}" fill="#FFFFFF"/>`,
      titleText
        ? `<text x="${Math.round(input.width / 2)}" y="${Math.round(
            layout.title.top + layout.title.height * 0.72,
          )}" text-anchor="middle" font-family="DouyinSansBold, Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="${titleFontSize}" font-weight="800" fill="#000000">${escapeXml(titleText)}</text>`
        : "",
      input.headerText
        ? `<text x="${Math.round(input.width / 2)}" y="${Math.round(
            layout.header.top + layout.header.height * 0.68,
          )}" text-anchor="middle" font-family="DouyinSansBold, Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="${headerFontSize}" font-weight="700" letter-spacing="${Math.max(
            1,
            Math.round(
              headerFontSize * KNOWLEDGE_BOARD_HEADER_LETTER_SPACING_EM,
            ),
          )}" fill="#797979">${escapeXml(input.headerText)}</text>`
        : "",
      `<rect x="${headerDecoration.leftDashX}" y="${dashY}" width="${headerDecoration.dashWidth}" height="${dashHeight}" fill="#787878"/>`,
      `<rect x="${headerDecoration.rightDashX}" y="${dashY}" width="${headerDecoration.dashWidth}" height="${dashHeight}" fill="#787878"/>`,
      verticalTextSvg({
        value: input.leftVerticalText ?? "",
        x: Math.round(input.width * 0.03125),
        centerY: Math.round(input.height * 0.495),
        fontSize: sideTextFontSize,
        color: "#CCCCCC",
      }),
      verticalTextSvg({
        value: input.rightVerticalText ?? "",
        x: Math.round(input.width * 0.96875),
        centerY: Math.round(input.height * 0.495),
        fontSize: sideTextFontSize,
        color: "#CCCCCC",
      }),
      `<rect x="0" y="${layout.dividerY}" width="${input.width}" height="${dividerHeight}" fill="#111111"/>`,
      "</svg>",
    ].join(""),
  );

  return sharp(background)
    .composite([
      {
        input: image,
        left: layout.image.left,
        top: layout.image.top,
      },
    ])
    .png()
    .toBuffer();
}

export async function prepareKnowledgeBoardImage(
  source: Uint8Array,
): Promise<Buffer> {
  return sharp(source)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(
      KNOWLEDGE_BOARD_IMAGE_SIZE.width,
      KNOWLEDGE_BOARD_IMAGE_SIZE.height,
      {
        fit: "contain",
        position: "centre",
        background: "#ffffff",
      },
    )
    .png()
    .toBuffer();
}
