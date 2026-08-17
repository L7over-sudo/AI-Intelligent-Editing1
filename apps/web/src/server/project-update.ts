import { z } from "zod";

import { projectAudioMixSchema } from "@stickmotion/shared";

const renameProjectInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
  })
  .strict();

const clonedVoiceInputSchema = z
  .object({
    voiceStyle: z.enum(["indextts2"]),
    voiceProfileId: z.string().trim().min(1).max(100),
  })
  .strict();

export const projectUpdateInputSchema = z.union([
  renameProjectInputSchema,
  projectAudioMixSchema,
  clonedVoiceInputSchema,
]);

export type ProjectUpdateInput = z.infer<typeof projectUpdateInputSchema>;
