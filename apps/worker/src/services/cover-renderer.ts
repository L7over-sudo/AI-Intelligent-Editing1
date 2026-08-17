import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  coverTemplateSelectionSchema,
  type CoverCopy,
  type CoverOutputRatio,
  type CoverTemplateSelection,
} from "@stickmotion/shared";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const coverRenderLayout = {
  portrait: {
    blurX: 404,
    blurY: 196,
    blurFontSize: 105,
    blurOpacity: 0.58,
    foregroundTop: 205,
    foregroundHeight: 296,
    titleX: 384,
    titleY: 378,
    titleFontSize: 110,
    subtitleX: 384,
    subtitleY: 464,
    subtitleFontSize: 58,
    dashX: 52,
    dashY: 527,
    dashWidth: 423,
    dashStrokeWidth: 4.2,
    accountX: 50,
    accountY: 604,
    accountFontSize: 35.5,
    avatarX: 614,
    avatarY: 600,
    avatarRadius: 100,
  },
  landscape: {
    foregroundTop: 56,
    foregroundHeight: 408,
    titleX: 640,
    titleY: 204,
    titleFontSize: 182,
    subtitleX: 638,
    subtitleY: 349,
    subtitleFontSize: 96,
    dashX: 88,
    dashWidth: 704,
    dashY: 456,
    dashStrokeWidth: 4,
    accountX: 84,
    accountY: 582,
    accountFontSize: 59,
    avatarX: 1022,
    avatarY: 580,
    avatarRadius: 166,
  },
} as const;

const douyinFontPath = fileURLToPath(
  new URL("../../../../assets/fonts/DouyinSansBold.otf", import.meta.url),
);
const characterCoverImagePath = fileURLToPath(
  new URL(
    "../../../../apps/web/public/cover-templates/monochrome-career-character.png",
    import.meta.url,
  ),
);
let douyinFontPromise: Promise<string> | undefined;
let characterCoverImagePromise: Promise<string> | undefined;

function fitSingleLineFontSize(
  text: string,
  preferredSize: number,
  availableWidth: number,
  minimumSize: number,
): number {
  const glyphCount = Math.max(1, Array.from(text.trim()).length);
  return Math.max(
    minimumSize,
    Math.min(preferredSize, availableWidth / glyphCount),
  );
}

async function douyinFontDataUrl(): Promise<string> {
  douyinFontPromise ??= readFile(douyinFontPath).then(
    (bytes) => `data:font/otf;base64,${bytes.toString("base64")}`,
  );
  return douyinFontPromise;
}

async function characterCoverImageDataUrl(): Promise<string> {
  characterCoverImagePromise ??= readFile(characterCoverImagePath).then(
    (bytes) => `data:image/png;base64,${bytes.toString("base64")}`,
  );
  return characterCoverImagePromise;
}

function avatarMarkup(
  avatarBytes: Uint8Array | undefined,
  centerX = 694,
  centerY = 499,
  radius = 100,
): string {
  const stroke = Math.max(2, radius * 0.08);
  if (!avatarBytes || avatarBytes.byteLength === 0) {
    return `
      <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="#171717" stroke="#3f3f46" stroke-width="${stroke}"/>
      <circle cx="${centerX}" cy="${centerY - radius * 0.23}" r="${radius * 0.25}" fill="none" stroke="#a1a1aa" stroke-width="${stroke * 4}"/>
      <path d="M${centerX - radius * 0.48} ${centerY + radius * 0.71}c0-${radius * 0.31} ${radius * 0.21}-${radius * 0.54} ${radius * 0.48}-${radius * 0.54}s${radius * 0.48} ${radius * 0.23} ${radius * 0.48} ${radius * 0.54}" fill="none" stroke="#a1a1aa" stroke-width="${stroke * 4}" stroke-linecap="round"/>
    `;
  }

  const base64 = Buffer.from(avatarBytes).toString("base64");
  return `
    <defs>
      <clipPath id="cover-avatar-clip"><circle cx="${centerX}" cy="${centerY}" r="${radius}"/></clipPath>
    </defs>
    <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="#171717"/>
    <image href="data:image/png;base64,${base64}" x="${centerX - radius}" y="${centerY - radius}" width="${radius * 2}" height="${radius * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover-avatar-clip)"/>
    <circle cx="${centerX}" cy="${centerY}" r="${radius - stroke / 2}" fill="none" stroke="#3f3f46" stroke-width="${stroke}"/>
  `;
}

function createPortraitSvg(
  template: CoverTemplateSelection,
  copy: CoverCopy,
  fontDataUrl: string,
  avatarBytes?: Uint8Array,
): string {
  const layout = coverRenderLayout.portrait;
  const title = escapeXml(copy.title);
  const subtitle = escapeXml(copy.subtitle);
  const account = escapeXml(template.cover.account || "@账号");
  const titleFontSize = fitSingleLineFontSize(
    copy.title,
    layout.titleFontSize,
    680,
    68,
  );
  const subtitleFontSize = fitSingleLineFontSize(
    copy.subtitle,
    layout.subtitleFontSize,
    680,
    34,
  );
  const blurFontSize = fitSingleLineFontSize(
    copy.title,
    layout.blurFontSize,
    680,
    64,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024">
  <defs>
    <style>@font-face{font-family:'DouyinSansBold';src:url('${fontDataUrl}') format('opentype');}text{font-family:'DouyinSansBold','Microsoft YaHei','PingFang SC',sans-serif;}</style>
    <filter id="cover-title-blur" x="-35%" y="-80%" width="170%" height="260%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="28" result="wide"/>
      <feGaussianBlur in="SourceGraphic" stdDeviation="13" result="tight"/>
      <feMerge>
        <feMergeNode in="wide"/>
        <feMergeNode in="tight"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="768" height="1024" fill="#000000"/>
  <text x="${layout.blurX}" y="${layout.blurY}" fill="#ffffff" opacity="${layout.blurOpacity}" text-anchor="middle" font-size="${blurFontSize}" font-weight="900" filter="url(#cover-title-blur)">${title}</text>
  <rect x="0" y="${layout.foregroundTop}" width="768" height="${layout.foregroundHeight}" fill="#000000"/>
  <text x="${layout.titleX}" y="${layout.titleY}" fill="#ffffff" text-anchor="middle" font-size="${titleFontSize}" font-weight="900" letter-spacing="-2" transform="translate(${layout.titleX} ${layout.titleY - 91}) scale(1.004 .971) translate(${-layout.titleX} ${-(layout.titleY - 91)})">${title}</text>
  <text x="${layout.subtitleX - 2}" y="${layout.subtitleY}" fill="#ffffff" text-anchor="middle" font-size="${subtitleFontSize}" font-weight="900" letter-spacing="-1" transform="translate(${layout.subtitleX - 2} ${layout.subtitleY}) scale(1.015 1) translate(${-(layout.subtitleX - 2)} ${-layout.subtitleY})">${subtitle}</text>
  <path d="M${layout.dashX} ${layout.dashY}h${layout.dashWidth}" stroke="#ffffff" stroke-width="${layout.dashStrokeWidth}" stroke-dasharray="22 15" opacity="0.72"/>
  <text x="${layout.accountX}" y="${layout.accountY}" fill="#ffffff" opacity="0.84" font-size="${layout.accountFontSize}" font-weight="900">${account}</text>
  ${avatarMarkup(avatarBytes, layout.avatarX, layout.avatarY, layout.avatarRadius)}
</svg>`;
}

function createLandscapeSvg(
  template: CoverTemplateSelection,
  copy: CoverCopy,
  fontDataUrl: string,
  avatarBytes?: Uint8Array,
): string {
  const layout = coverRenderLayout.landscape;
  const title = escapeXml(copy.title);
  const subtitle = escapeXml(copy.subtitle);
  const account = escapeXml(template.cover.account || "@账号");
  const titleFontSize = fitSingleLineFontSize(
    copy.title,
    layout.titleFontSize,
    1_120,
    108,
  );
  const subtitleFontSize = fitSingleLineFontSize(
    copy.subtitle,
    layout.subtitleFontSize,
    1_100,
    56,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <style>@font-face{font-family:'DouyinSansBold';src:url('${fontDataUrl}') format('opentype');}text{font-family:'DouyinSansBold','Microsoft YaHei','PingFang SC',sans-serif;}</style>
  </defs>
  <rect width="1280" height="720" fill="#000000"/>
  <rect x="0" y="${layout.foregroundTop}" width="1280" height="${layout.foregroundHeight}" fill="#000000"/>
  <text x="${layout.titleX}" y="${layout.titleY}" fill="#ffffff" text-anchor="middle" font-size="${titleFontSize}" font-weight="900" letter-spacing="-2" transform="translate(${layout.titleX} ${layout.titleY}) scale(1.006 .976) translate(${-layout.titleX} ${-layout.titleY})">${title}</text>
  <text x="${layout.subtitleX}" y="${layout.subtitleY}" fill="#ffffff" text-anchor="middle" font-size="${subtitleFontSize}" font-weight="900" letter-spacing="-1" transform="translate(${layout.subtitleX} ${layout.subtitleY}) scale(1.012 .965) translate(${-layout.subtitleX} ${-layout.subtitleY})">${subtitle}</text>
  <path d="M${layout.dashX} ${layout.dashY}h${layout.dashWidth}" stroke="#ffffff" stroke-width="${layout.dashStrokeWidth}" stroke-dasharray="22 15" opacity="0.72"/>
  <text x="${layout.accountX}" y="${layout.accountY}" fill="#ffffff" opacity="0.84" font-size="${layout.accountFontSize}" font-weight="900">${account}</text>
  ${avatarMarkup(avatarBytes, layout.avatarX, layout.avatarY, layout.avatarRadius)}
</svg>`;
}

function createCharacterSvg(
  template: CoverTemplateSelection,
  copy: CoverCopy,
  fontDataUrl: string,
  imageDataUrl: string,
  ratio: CoverOutputRatio,
): string {
  const isPortrait = ratio === "3:4";
  const width = isPortrait ? 768 : 1280;
  const height = isPortrait ? 1024 : 720;
  const topText = escapeXml(template.cover.account || "");
  const title = escapeXml(copy.title);
  const subtitle = escapeXml(copy.subtitle);
  const footer = escapeXml(template.cover.footer || "");
  const titleY = isPortrait ? 752 : 515;
  const subtitleY = isPortrait ? 850 : 620;
  const footerY = isPortrait ? 989 : 698;
  const topY = isPortrait ? 84 : 66;
  const titleSize = fitSingleLineFontSize(
    copy.title,
    isPortrait ? 58 : 72,
    width * 0.9,
    isPortrait ? 36 : 46,
  );
  const subtitleSize = fitSingleLineFontSize(
    copy.subtitle,
    isPortrait ? 58 : 72,
    width * 0.9,
    isPortrait ? 32 : 42,
  );
  const topSize = isPortrait ? 30 : 38;
  const footerSize = isPortrait ? 28 : 34;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>@font-face{font-family:'DouyinSansBold';src:url('${fontDataUrl}') format('opentype');}text{font-family:'DouyinSansBold','Microsoft YaHei','PingFang SC',sans-serif;}</style>
    <linearGradient id="character-text-shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.72" stop-color="#000000" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.7"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="#000000"/>
  <image href="${imageDataUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${width}" height="${height}" fill="url(#character-text-shade)"/>
  <text x="${width / 2}" y="${topY}" fill="#ffffff" opacity="0.9" text-anchor="middle" font-size="${topSize}" font-weight="900" letter-spacing="7">${topText}</text>
  <text x="${width / 2}" y="${titleY}" fill="#ffffff" text-anchor="middle" font-size="${titleSize}" font-weight="900" font-style="italic" letter-spacing="-2" stroke="#000000" stroke-opacity="0.28" stroke-width="2" paint-order="stroke">${title}</text>
  <text x="${width / 2}" y="${subtitleY}" fill="#ffffff" text-anchor="middle" font-size="${subtitleSize}" font-weight="900" font-style="italic" letter-spacing="-2" stroke="#000000" stroke-opacity="0.28" stroke-width="2" paint-order="stroke">${subtitle}</text>
  <text x="${width / 2}" y="${footerY}" fill="#ffffff" opacity="0.9" text-anchor="middle" font-size="${footerSize}" font-weight="900" letter-spacing="6">${footer}</text>
</svg>`;
}

export async function renderCoverPng(input: {
  template: CoverTemplateSelection;
  copy: CoverCopy;
  ratio?: CoverOutputRatio;
  avatarBytes?: Uint8Array;
}): Promise<Uint8Array> {
  const template = coverTemplateSelectionSchema.parse(input.template);
  const copy = input.copy;
  const ratio = input.ratio ?? "3:4";
  const fontDataUrl = await douyinFontDataUrl();
  let svg: string;
  if (template.templateId === "monochrome-career-character") {
    const imageDataUrl = await characterCoverImageDataUrl();
    svg = createCharacterSvg(template, copy, fontDataUrl, imageDataUrl, ratio);
  } else {
    svg =
      ratio === "16:9"
        ? createLandscapeSvg(template, copy, fontDataUrl, input.avatarBytes)
        : createPortraitSvg(template, copy, fontDataUrl, input.avatarBytes);
  }
  return sharp(Buffer.from(svg)).png().toBuffer();
}
