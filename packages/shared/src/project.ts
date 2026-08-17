import { z } from "zod";

import {
  backgroundMusicVolumeSchema,
  narrationVolumeSchema,
} from "./audio-mix";
import { coverTemplateSelectionSchema } from "./cover-template";
import { videoTemplateSchema } from "./video-template";

export const aspectRatioSchema = z.enum(["PORTRAIT", "LANDSCAPE"]);
export const visualModeSchema = z.enum(["TEMPLATE", "AI_IMAGE"]);
export const backgroundMusicSchema = z.union([
  z.literal("NONE"),
  z.literal("AUTO_MATCH"),
  z.literal("BUILTIN"),
  z.literal("UPLOAD"),
  z
    .string()
    .startsWith("AUTO_MATCH:", "自动匹配音乐必须以 AUTO_MATCH: 开头")
    .max(220, "音乐文件名过长")
    .refine(
      (value) => {
        const fileName = value.slice("AUTO_MATCH:".length);
        return (
          fileName.length > 0 &&
          !fileName.includes("/") &&
          !fileName.includes("\\") &&
          !fileName.includes("..")
        );
      },
      "音乐文件名不能包含路径或目录跳转",
    ),
]);
export const imageSizePresetSchema = z.enum([
  "AUTO",
  "9:16",
  "16:9",
  "3:2",
  "21:9",
  "1024x1024",
  "1040x832",
  "720x1280",
  "1280x720",
  "1024x768",
  "1008x672",
  "832x1040",
  "768x1024",
  "672x1008",
  "1344x576",
]);
export type ImageSizePreset = z.infer<typeof imageSizePresetSchema>;

export function shortProjectTitle(source: string, maxLength = 12): string {
  const firstLine = source
    .trim()
    .split(/\r?\n/u)
    .find((line) => line.trim());
  const cleaned = (firstLine ?? source)
    .replace(/[。！？!?；;…]+$/u, "")
    .trim();
  const firstClause = cleaned.split(/[，,。.!！?？；;]/u)[0]?.trim() || cleaned;
  const characters = Array.from(firstClause);
  if (characters.length <= maxLength) return firstClause || "未命名视频";
  return `${characters.slice(0, maxLength).join("")}…`;
}

function withoutLegacyVisualEffects(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const style = { ...(value as Record<string, unknown>) };
  delete style.colorLutId;
  delete style.transitionMaskId;
  return style;
}

export const subtitleStyleSchema = z.preprocess(
  withoutLegacyVisualEffects,
  z
    .object({
      mode: z.enum(["CHINESE", "BILINGUAL"]),
      fontSize: z.number().int().min(28).max(96),
      position: z.enum(["TOP", "CENTER", "BOTTOM"]),
      outline: z.boolean(),
      shadow: z.boolean(),
      keywordHighlight: z.boolean(),
      templateId: z
        .union([z.literal("BUILTIN"), z.string().regex(/^stpl_[a-f0-9]{20}$/u)])
        .default("BUILTIN"),
      videoTemplate: videoTemplateSchema.default("FULL_BLEED"),
      headerText: z.string().trim().max(120).default(""),
      mainTitle: z.string().trim().max(60).default(""),
      leftVerticalText: z.string().trim().max(120).default(""),
      rightVerticalText: z.string().trim().max(160).default(""),
      transitionsEnabled: z.boolean().default(true),
      customTitle: z.boolean().default(true),
      imageSize: imageSizePresetSchema.default("AUTO"),
      coverTemplate: coverTemplateSelectionSchema.optional(),
    })
    .strict(),
);

export const createProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    sourceText: z.string().trim().min(2).max(30_000),
    sourceKind: z.enum(["TOPIC", "FULL_TEXT"]),
    aspectRatio: aspectRatioSchema,
    language: z.string().trim().min(2).max(20),
    voiceStyle: z.string().trim().min(1).max(80),
    voiceProfileId: z.string().min(1).nullable().optional(),
    characterProfileId: z.string().min(1).nullable().optional(),
    subtitleStyle: subtitleStyleSchema,
    accentColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, "强调色必须是六位十六进制颜色"),
    visualMode: visualModeSchema.default("TEMPLATE"),
    imagePrompt: z.string().trim().min(1),
    includeNarration: z.boolean().default(true),
    includeSubtitles: z.boolean().default(true),
    includeSoundEffects: z.boolean().default(true),
    narrationVolume: narrationVolumeSchema,
    backgroundMusicVolume: backgroundMusicVolumeSchema,
    backgroundMusic: backgroundMusicSchema.default("NONE"),
  })
  .strict()
  .superRefine((project, context) => {
    if (
      project.subtitleStyle.videoTemplate === "KNOWLEDGE_BOARD" &&
      project.aspectRatio !== "LANDSCAPE"
    ) {
      context.addIssue({
        code: "custom",
        path: ["aspectRatio"],
        message: "知识板项目固定使用 21:9 图片比例",
      });
    }
  });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
