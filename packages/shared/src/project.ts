import { z } from "zod";

import { videoTemplateSchema } from "./video-template";

export const aspectRatioSchema = z.enum(["PORTRAIT", "LANDSCAPE"]);
export const visualModeSchema = z.enum(["TEMPLATE", "AI_IMAGE"]);
export const backgroundMusicSchema = z.enum(["NONE", "BUILTIN", "UPLOAD"]);

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
        .union([
          z.literal("BUILTIN"),
          z.string().regex(/^stpl_[a-f0-9]{20}$/u),
        ])
        .default("BUILTIN"),
      videoTemplate: videoTemplateSchema.default("FULL_BLEED"),
      headerText: z.string().trim().max(120).default(""),
      leftVerticalText: z.string().trim().max(120).default(""),
      rightVerticalText: z.string().trim().max(160).default(""),
      transitionsEnabled: z.boolean().default(true),
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
    useTextOpeningTemplate: z.boolean().default(false),
    backgroundMusic: backgroundMusicSchema.default("NONE"),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
