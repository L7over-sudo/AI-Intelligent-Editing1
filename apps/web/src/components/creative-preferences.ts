import { z } from "zod";

import { backgroundMusicSchema } from "@stickmotion/shared";

const creativePreferencesSchema = z
  .object({
    videoTemplate: z.enum(["FULL_BLEED", "KNOWLEDGE_BOARD"]).optional(),
    imageSize: z
      .enum([
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
      ])
      .optional(),
    aspectRatio: z.enum(["PORTRAIT", "LANDSCAPE"]).optional(),
    templateHeader: z.string().max(120).optional(),
    mainTitle: z.string().max(60).optional(),
    leftVerticalText: z.string().max(120).optional(),
    rightVerticalText: z.string().max(160).optional(),
    transitionsEnabled: z.boolean().optional(),
    outputMode: z.enum(["NARRATED", "VISUAL_ONLY"]).optional(),
    voiceStyle: z.string().min(1).max(120).optional(),
    selectedVoiceProfileId: z.string().max(200).optional(),
    music: backgroundMusicSchema.optional(),
    selectedCoverTemplateId: z.string().max(100).optional(),
  })
  .strict();

export type CreativePreferences = z.infer<typeof creativePreferencesSchema>;

export const creativePreferencesStorageKey =
  "stickmotion:creative-preferences:v1";

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function parseStoredCreativePreferences(
  value: string | null,
): CreativePreferences | undefined {
  const parsed = creativePreferencesSchema.safeParse(parseJson(value));
  return parsed.success ? parsed.data : undefined;
}

export function serializeCreativePreferences(value: unknown): string {
  return JSON.stringify(creativePreferencesSchema.parse(value));
}
