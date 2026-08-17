import type { VideoTemplate } from "@stickmotion/shared";

export function allowsTemplateSafeFfmpegFallback(
  videoTemplate: VideoTemplate,
  fallbackSetting: string | undefined,
): boolean {
  return videoTemplate === "FULL_BLEED" && fallbackSetting !== "false";
}
