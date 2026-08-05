import sharp from "sharp";

import { getKnowledgeBoardLayout } from "@stickmotion/shared";

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
  const fitted = Math.floor((width * 0.84) / (characters * 0.92));
  return Math.max(18, Math.min(preferredSize, fitted));
}

export async function createKnowledgeBoardFrame(input: {
  source: Uint8Array;
  width: number;
  height: number;
  headerText: string;
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
  const dividerHeight = Math.max(3, Math.round(input.height * 0.0025));
  const background = Buffer.from(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}">`,
      "<defs>",
      '<radialGradient id="paper" cx="50%" cy="38%" r="78%">',
      '<stop offset="0%" stop-color="#ffffff"/>',
      '<stop offset="72%" stop-color="#fdfdfc"/>',
      '<stop offset="100%" stop-color="#f7f7f5"/>',
      "</radialGradient>",
      "</defs>",
      `<rect width="${input.width}" height="${input.height}" fill="url(#paper)"/>`,
      input.headerText
        ? `<text x="${Math.round(input.width / 2)}" y="${Math.round(
            layout.header.top + layout.header.height * 0.68,
          )}" text-anchor="middle" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="${headerFontSize}" font-weight="800" letter-spacing="${Math.max(
            2,
            Math.round(headerFontSize * 0.16),
          )}" fill="#090909">${escapeXml(input.headerText)}</text>`
        : "",
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
  const normalized = await sharp(source)
    .rotate()
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const original = await sharp(normalized).metadata();
  if (!original.width || !original.height) {
    throw new Error("KNOWLEDGE_BOARD_IMAGE_DIMENSIONS_MISSING");
  }

  let trimmed: { data: Buffer; info: { width: number; height: number } };
  try {
    trimmed = await sharp(normalized)
      .trim({ background: "#ffffff", threshold: 18 })
      .png()
      .toBuffer({ resolveWithObject: true });
  } catch {
    return normalized;
  }

  const originalArea = original.width * original.height;
  const trimmedArea = trimmed.info.width * trimmed.info.height;
  const removedRatio = 1 - trimmedArea / originalArea;
  if (
    removedRatio < 0.04 ||
    trimmed.info.width < 48 ||
    trimmed.info.height < 48
  ) {
    return normalized;
  }

  const padding = Math.max(
    8,
    Math.round(Math.max(trimmed.info.width, trimmed.info.height) * 0.045),
  );
  return sharp(trimmed.data)
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: "#ffffff",
    })
    .png()
    .toBuffer();
}
