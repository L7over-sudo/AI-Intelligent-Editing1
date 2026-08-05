import {
  templateElementSchema,
  type StoryboardScene,
} from "@stickmotion/shared";

import { SVG_ASSETS } from "./assets";

type TemplateElement = StoryboardScene["templateElements"][number];

export interface RenderSceneInput {
  width: number;
  height: number;
  accentColor: string;
  elements: TemplateElement[];
  subtitle?: string;
  background?: string;
}

export function escapeXml(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}

export function renderSvgScene(input: RenderSceneInput): string {
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height)) {
    throw new Error("SVG_DIMENSIONS_MUST_BE_INTEGERS");
  }
  if (input.width < 320 || input.height < 320) {
    throw new Error("SVG_DIMENSIONS_TOO_SMALL");
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(input.accentColor)) {
    throw new Error("SVG_ACCENT_COLOR_INVALID");
  }

  const elements = input.elements.map((raw) => templateElementSchema.parse(raw));
  const content = elements
    .map((element) => renderElement(element, input))
    .join("");
  const subtitle = input.subtitle
    ? `<g transform="translate(${input.width / 2} ${input.height - 80})"><rect x="-${input.width * 0.38}" y="-38" width="${input.width * 0.76}" height="70" rx="16" fill="white" fill-opacity=".94"/><text x="0" y="9" text-anchor="middle" font-family="sans-serif" font-size="${Math.max(28, Math.round(input.width / 28))}" font-weight="800" fill="#171717">${escapeXml(input.subtitle)}</text></g>`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}" role="img">`,
    `<rect width="100%" height="100%" fill="${input.background ?? "#F7F5EF"}"/>`,
    `<g color="#171717">${content}</g>`,
    subtitle,
    "</svg>",
  ].join("");
}

function renderElement(
  element: TemplateElement,
  input: RenderSceneInput,
): string {
  const renderer = SVG_ASSETS[element.assetId];
  if (!renderer) {
    throw new Error(`SVG_ASSET_NOT_FOUND:${element.assetId}`);
  }

  const x = Math.round(element.x * input.width);
  const y = Math.round(element.y * input.height);
  const baseScale = Math.min(input.width, input.height) / 700;
  const svg = renderer({
    accentColor: input.accentColor,
    emphasis: element.emphasis,
    label: escapeXml(element.label),
  });
  return `<g transform="translate(${x} ${y}) rotate(${element.rotation}) scale(${(element.scale * baseScale).toFixed(4)})">${svg}</g>`;
}

